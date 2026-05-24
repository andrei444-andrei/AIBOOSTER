// Обёртки над ffmpeg/ffprobe. Бинарники едут с npm-пакетами
// @ffmpeg-installer/ffmpeg + @ffprobe-installer/ffprobe — статические сборки
// для текущей платформы (на Vercel это linux-x64). Бандлятся в функцию через
// outputFileTracingIncludes в next.config.mjs.

import { spawn } from "node:child_process";
import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";
import ffprobeInstaller from "@ffprobe-installer/ffprobe";

const FFMPEG = ffmpegInstaller.path;
const FFPROBE = ffprobeInstaller.path;

function run(
  cmd: string,
  args: string[],
  opts: { maxBuffer?: number } = {},
): Promise<Buffer> {
  const maxBuffer = opts.maxBuffer ?? 20 * 1024 * 1024;
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    let outLen = 0;
    p.stdout.on("data", (d: Buffer) => {
      outLen += d.length;
      if (outLen <= maxBuffer) out.push(d);
    });
    p.stderr.on("data", (d: Buffer) => err.push(d));
    p.on("error", reject);
    p.on("close", (code, signal) => {
      if (code === 0) resolve(Buffer.concat(out));
      else {
        const stderrStr = Buffer.concat(err).toString();
        const stdoutStr = Buffer.concat(out).toString();
        // ffmpeg печатает baseline-баннер ~500 байт перед любой реальной ошибкой,
        // поэтому берём ХВОСТ stderr. Если ffmpeg грохнули сигналом (SIGKILL=OOM)
        // — добавляем явный маркер. На случай если ошибка ушла не в stderr,
        // прикладываем последние 500 байт stdout.
        const errTail = stderrStr.slice(-1800).trim();
        const outTail = stdoutStr.slice(-500).trim();
        const signalNote = signal ? ` [signal=${signal}]` : "";
        const stdoutNote = outTail ? `\n--- stdout tail: ${outTail}` : "";
        reject(
          new Error(
            `${cmd} exited code=${code}${signalNote} stderr.len=${stderrStr.length}:\n${errTail}${stdoutNote}`,
          ),
        );
      }
    });
  });
}

export async function ffprobeDuration(file: string): Promise<number> {
  const out = await run(FFPROBE, [
    "-v", "error",
    "-show_entries", "format=duration",
    "-of", "default=noprint_wrappers=1:nokey=1",
    file,
  ]);
  const v = parseFloat(out.toString().trim());
  if (!Number.isFinite(v) || v <= 0) throw new Error("ffprobe failed to read duration");
  return v;
}

export async function ffmpegSilence(outPath: string, durSec: number): Promise<void> {
  await run(FFMPEG, [
    "-y",
    "-f", "lavfi",
    "-i", "anullsrc=r=44100:cl=mono",
    "-t", String(durSec),
    "-q:a", "9",
    "-acodec", "libmp3lame",
    outPath,
  ]);
}

// Подгонка длительности через atempo. atempo поддерживает 0.5..2.0, при сильном
// несовпадении строим цепочку.
function buildAtempoChain(ratio: number): string | null {
  if (ratio >= 0.95 && ratio <= 1.05) return null;
  const chain: number[] = [];
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

export async function ffmpegFit(
  inFile: string,
  outFile: string,
  rawSec: number,
  targetSec: number,
): Promise<void> {
  const ratio = rawSec / targetSec;
  const chain = buildAtempoChain(ratio);
  const args = ["-y", "-i", inFile];
  if (chain) args.push("-filter:a", chain);
  args.push("-acodec", "libmp3lame", "-q:a", "4", outFile);
  await run(FFMPEG, args);
}

// Каждый TTS-сегмент позиционируется по своему start_ms через adelay и
// микшируется через amix. На больших видео (>50 сегментов) гигантский
// amix-граф становится медленным и упирается в Vercel 300с-таймаут,
// поэтому процессим батчами: групп по 50 → промежуточные mp3 (каждый
// уже с правильной адресацией внутри своего временного окна) → финальный
// amix всех батчей. Каждый батч-микс маленький и быстрый, финал тоже.
export async function ffmpegConcatTimed(
  segments: Array<{ file: string; start_ms: number }>,
  outFile: string,
  totalDurSec: number | null,
): Promise<void> {
  if (segments.length === 0) {
    await ffmpegSilence(outFile, 1);
    return;
  }
  const BATCH = 50;
  if (segments.length <= BATCH) {
    await mixWithDelays(segments, outFile, totalDurSec);
    return;
  }

  // Многобатчевая стратегия: каждый батч → промежуточный mp3,
  // потом финальный микс всех батчей (каждый стартует с 0).
  const workDir = outFile.substring(0, outFile.lastIndexOf("/"));
  const batchFiles: string[] = [];
  for (let i = 0; i < segments.length; i += BATCH) {
    const batch = segments.slice(i, i + BATCH);
    const batchOut = `${workDir}/batch-${Math.floor(i / BATCH)}.mp3`;
    await mixWithDelays(batch, batchOut, null);
    batchFiles.push(batchOut);
  }
  await mixFiles(batchFiles, outFile, totalDurSec);
}

// Один amix-проход: позиционирует каждый input через adelay и микширует.
async function mixWithDelays(
  segments: Array<{ file: string; start_ms: number }>,
  outFile: string,
  totalDurSec: number | null,
): Promise<void> {
  const args = ["-y"];
  for (const s of segments) args.push("-i", s.file);

  const labels: string[] = [];
  const parts: string[] = [];
  segments.forEach((s, i) => {
    const lbl = `s${i}`;
    parts.push(`[${i}:a]adelay=${s.start_ms}|${s.start_ms},aresample=44100[${lbl}]`);
    labels.push(`[${lbl}]`);
  });
  // amix у @ffmpeg-installer (статическая сборка 2018) не знает normalize=0.
  // Компенсируем громкость через volume=N (умножаем на число входов), чтобы
  // amix не делил signal/N и тише не становилось.
  const mix =
    `${labels.join("")}amix=inputs=${segments.length}:duration=longest,` +
    `volume=${segments.length}[out]`;
  args.push("-filter_complex", [...parts, mix].join(";"));
  args.push("-map", "[out]");
  if (totalDurSec) args.push("-t", String(totalDurSec));
  args.push("-acodec", "libmp3lame", "-q:a", "4", outFile);
  await run(FFMPEG, args);
}

// Финальный микс готовых батч-mp3 без adelay — внутри батчей уже всё
// расставлено по таймкодам. Просто amix N → N inputs.
async function mixFiles(
  files: string[],
  outFile: string,
  totalDurSec: number | null,
): Promise<void> {
  if (files.length === 1) {
    // Один батч — не нужно микшировать, можно просто перекодировать.
    const args = ["-y", "-i", files[0]];
    if (totalDurSec) args.push("-t", String(totalDurSec));
    args.push("-acodec", "libmp3lame", "-q:a", "4", outFile);
    await run(FFMPEG, args);
    return;
  }
  const args = ["-y"];
  for (const f of files) args.push("-i", f);
  const labels = files.map((_, i) => `[${i}:a]`).join("");
  const mix =
    `${labels}amix=inputs=${files.length}:duration=longest,` +
    `volume=${files.length}[out]`;
  args.push("-filter_complex", mix);
  args.push("-map", "[out]");
  if (totalDurSec) args.push("-t", String(totalDurSec));
  args.push("-acodec", "libmp3lame", "-q:a", "4", outFile);
  await run(FFMPEG, args);
}
