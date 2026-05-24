// Пайплайн перевода одного видео.
//
// Этапы (с прогрессом, который видит пользователь):
//   download (0..30)  — Apify тянет транскрипт с таймкодами + метаданные
//   translate(30..55) — LLM-перевод сегментов с сохранением их idx
//   tts      (55..90) — ElevenLabs (multilingual v2) — синтез по сегментам с
//                       подгонкой длительности под исходный таймкод (atempo)
//   mux      (90..100)— склейка финального mp3 → загрузка в R2

import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { translateBatch, ttsSynth } from "./aimlapi.js";
import { fetchTranscript } from "./apify.js";
import { uploadMp3 } from "./storage.js";

const MAX_DURATION_SEC = 60 * 60;

export async function runJob(job, postUpdate) {
  const work = await mkdtemp(join(tmpdir(), `job-${job.id}-`));
  try {
    // 1. Транскрипт + метаданные через Apify.
    await postUpdate(job.id, { stage: "download", progress: 5 });
    const ytUrl = `https://www.youtube.com/watch?v=${job.video_id}`;
    const tx = await fetchTranscript(ytUrl);
    if (tx.duration && tx.duration > MAX_DURATION_SEC) {
      throw new Error(`видео слишком длинное: ${Math.round(tx.duration / 60)} мин (лимит 60)`);
    }
    await postUpdate(job.id, {
      title: tx.title,
      duration_sec: tx.duration,
      source_lang: tx.language,
      stage: "download",
      progress: 28,
      segments: tx.segments.map((s) => ({
        idx: s.idx,
        start_ms: s.start_ms,
        end_ms: s.end_ms,
        source_text: s.text,
      })),
    });

    // 2. Перевод.
    await postUpdate(job.id, { stage: "translate", progress: 32 });
    const translated = await translateBatch(tx.segments, {
      sourceLang: tx.language,
      targetLang: job.target_lang,
    });
    await postUpdate(job.id, {
      stage: "translate",
      progress: 55,
      segments: translated.map((s) => ({
        idx: s.idx,
        start_ms: s.start_ms,
        end_ms: s.end_ms,
        source_text: s.text,
        translated_text: s.translated_text,
      })),
    });

    // 3. TTS по сегментам + подгонка длительности.
    await postUpdate(job.id, { stage: "tts", progress: 58 });
    const segmentFiles = [];
    for (let i = 0; i < translated.length; i++) {
      const s = translated[i];
      const text = (s.translated_text || "").trim();
      if (!text) {
        const silence = join(work, `seg-${i}.mp3`);
        await ffmpegSilence(silence, Math.max(0.1, (s.end_ms - s.start_ms) / 1000));
        segmentFiles.push({ file: silence, start_ms: s.start_ms, end_ms: s.end_ms });
        continue;
      }
      const raw = await ttsSynth(text);
      const rawFile = join(work, `seg-${i}-raw.mp3`);
      await writeFile(rawFile, raw);

      const targetSec = Math.max(0.2, (s.end_ms - s.start_ms) / 1000);
      const rawSec = await ffprobeDuration(rawFile);
      const segFile = join(work, `seg-${i}.mp3`);
      await ffmpegFit(rawFile, segFile, rawSec, targetSec);
      segmentFiles.push({ file: segFile, start_ms: s.start_ms, end_ms: s.end_ms });

      const p = 58 + Math.round((32 * (i + 1)) / translated.length);
      if (i % 5 === 0 || i === translated.length - 1) {
        await postUpdate(job.id, { stage: "tts", progress: Math.min(p, 90) });
      }
    }

    // 4. Склейка по таймкодам.
    await postUpdate(job.id, { stage: "mux", progress: 92 });
    const finalMp3 = join(work, "final.mp3");
    await ffmpegConcatTimed(segmentFiles, finalMp3, tx.duration ?? null);

    // 5. Загрузка в R2.
    await postUpdate(job.id, { stage: "mux", progress: 96 });
    const data = await readFile(finalMp3);
    const key = `translations/${job.video_id}/${job.target_lang}/${job.id}.mp3`;
    const audioUrl = await uploadMp3(key, data);

    await postUpdate(job.id, { done: { audio_url: audioUrl } });
  } finally {
    await rm(work, { recursive: true, force: true }).catch(() => {});
  }
}

// ---------- внешние процессы ----------

function run(cmd, args, { input, maxBuffer = 20 * 1024 * 1024 } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ["pipe", "pipe", "pipe"] });
    const out = [];
    const err = [];
    let outLen = 0;
    p.stdout.on("data", (d) => {
      outLen += d.length;
      if (outLen <= maxBuffer) out.push(d);
    });
    p.stderr.on("data", (d) => err.push(d));
    p.on("error", reject);
    p.on("close", (code) => {
      if (code === 0) resolve(Buffer.concat(out));
      else reject(new Error(`${cmd} exited ${code}: ${Buffer.concat(err).toString().slice(0, 500)}`));
    });
    if (input) p.stdin.end(input);
    else p.stdin.end();
  });
}

async function ffprobeDuration(file) {
  const out = await run("ffprobe", [
    "-v", "error",
    "-show_entries", "format=duration",
    "-of", "default=noprint_wrappers=1:nokey=1",
    file,
  ]);
  const v = parseFloat(out.toString().trim());
  if (!Number.isFinite(v) || v <= 0) throw new Error("ffprobe failed to read duration");
  return v;
}

async function ffmpegSilence(outPath, durSec) {
  await run("ffmpeg", [
    "-y",
    "-f", "lavfi",
    "-i", `anullsrc=r=44100:cl=mono`,
    "-t", String(durSec),
    "-q:a", "9",
    "-acodec", "libmp3lame",
    outPath,
  ]);
}

// Подгонка длительности: atempo поддерживает 0.5..2.0, поэтому при сильном
// несовпадении строим цепочку atempo=2.0,atempo=...
function buildAtempoChain(ratio) {
  if (ratio >= 0.95 && ratio <= 1.05) return null;
  const chain = [];
  let r = ratio;
  while (r > 2.0) {
    chain.push(2.0);
    r /= 2.0;
  }
  while (r < 0.5) {
    chain.push(0.5);
    r /= 0.5;
  }
  chain.push(r);
  return chain.map((x) => `atempo=${x.toFixed(3)}`).join(",");
}

async function ffmpegFit(inFile, outFile, rawSec, targetSec) {
  const ratio = rawSec / targetSec;
  const chain = buildAtempoChain(ratio);
  const args = ["-y", "-i", inFile];
  if (chain) args.push("-filter:a", chain);
  args.push("-acodec", "libmp3lame", "-q:a", "4", outFile);
  await run("ffmpeg", args);
}

async function ffmpegConcatTimed(segments, outFile, totalDurSec) {
  if (segments.length === 0) {
    await ffmpegSilence(outFile, 1);
    return;
  }
  const args = ["-y"];
  for (const s of segments) args.push("-i", s.file);

  const labels = [];
  const parts = [];
  segments.forEach((s, i) => {
    const lbl = `s${i}`;
    parts.push(`[${i}:a]adelay=${s.start_ms}|${s.start_ms},aresample=44100[${lbl}]`);
    labels.push(`[${lbl}]`);
  });
  const mix = `${labels.join("")}amix=inputs=${segments.length}:duration=longest:normalize=0[out]`;
  args.push("-filter_complex", [...parts, mix].join(";"));
  args.push("-map", "[out]");
  if (totalDurSec) args.push("-t", String(totalDurSec));
  args.push("-acodec", "libmp3lame", "-q:a", "4", outFile);
  await run("ffmpeg", args);
}
