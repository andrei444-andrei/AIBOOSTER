// Обёртки над ffmpeg/ffprobe. Бинарники едут с npm-пакетами
// @ffmpeg-installer/ffmpeg + @ffprobe-installer/ffprobe — статические сборки
// для текущей платформы (на Vercel это linux-x64). Бандлятся в функцию через
// outputFileTracingIncludes в next.config.mjs.

import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
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
  // Параметры должны совпадать с тем, что выдаёт ffmpegFit (TTS-сегменты):
  // libmp3lame, q:a 4, 44.1kHz mono. Иначе при concat-склейке mp3-frame
  // headers разных профилей рвут декодирование и длительность.
  await run(FFMPEG, [
    "-y",
    "-f", "lavfi",
    "-i", "anullsrc=r=44100:cl=mono",
    "-t", String(durSec),
    "-acodec", "libmp3lame",
    "-q:a", "4",
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
  // Жёстко нормализуем формат, чтобы concat demuxer склеивал чисто с
  // silence-файлами (тот же 44.1kHz mono q:a 4). ElevenLabs возвращает
  // mp3 разных частот (22/24/44.1kHz), и concat без нормализации
  // молча обрывался посередине трека.
  args.push(
    "-acodec", "libmp3lame",
    "-q:a", "4",
    "-ar", "44100",
    "-ac", "1",
    outFile,
  );
  await run(FFMPEG, args);
}

// Собирает финальный mp3 из TTS-сегментов с точным позиционированием
// по start_ms. Стратегия — concat demuxer + silence-gaps:
//
//   silence(start_ms_0)
//   seg_0
//   silence(start_ms_1 - end_ms_0)   ← если положительно
//   seg_1
//   ...
//
// ffmpeg -f concat -c copy просто склеивает байты mp3 — никакого
// adelay/amix/декодирования. Работает за миллисекунды даже для тысяч
// сегментов, не зависит от длины видео.
//
// Предусловия: каждый сегмент уже подогнан ffmpegFit() так, что его
// длительность ≈ (end_ms - start_ms) / 1000. YouTube-субтитры не
// пересекаются по времени, поэтому концепция «закрыл — открыл следующий
// после» работает корректно.
export async function ffmpegConcatTimed(
  segments: Array<{ file: string; start_ms: number; end_ms: number }>,
  outFile: string,
  totalDurSec: number | null,
): Promise<void> {
  if (segments.length === 0) {
    await ffmpegSilence(outFile, 1);
    return;
  }

  const workDir = outFile.substring(0, outFile.lastIndexOf("/"));
  const sorted = [...segments].sort((a, b) => a.start_ms - b.start_ms);

  // Сборка списка файлов-кусков (silence + segment + silence + segment + ...).
  type Piece = { kind: "silence"; durSec: number; file?: string } | { kind: "audio"; file: string };
  const pieces: Piece[] = [];
  let cursorMs = 0;
  for (const s of sorted) {
    const gapMs = s.start_ms - cursorMs;
    if (gapMs > 5) {
      pieces.push({ kind: "silence", durSec: gapMs / 1000 });
    }
    pieces.push({ kind: "audio", file: s.file });
    cursorMs = Math.max(cursorMs, s.end_ms);
  }
  // Хвост до общей длительности, если есть.
  if (totalDurSec) {
    const tailMs = totalDurSec * 1000 - cursorMs;
    if (tailMs > 50) {
      pieces.push({ kind: "silence", durSec: tailMs / 1000 });
    }
  }

  // Кешируем silence-файлы по округлённой длительности — обычно гаpов с
  // одинаковой длиной много, не хочется генерить тыщу почти одинаковых mp3.
  const silenceCache = new Map<string, string>();
  let silenceCount = 0;
  for (const p of pieces) {
    if (p.kind !== "silence") continue;
    const rounded = Math.max(0.05, Math.round(p.durSec * 100) / 100);
    const key = rounded.toFixed(2);
    let file = silenceCache.get(key);
    if (!file) {
      file = `${workDir}/silence-${silenceCount++}.mp3`;
      await ffmpegSilence(file, rounded);
      silenceCache.set(key, file);
    }
    p.file = file;
  }

  // concat demuxer требует список вида:
  //   file '/abs/path/a.mp3'
  //   file '/abs/path/b.mp3'
  const listFile = `${workDir}/concat-list.txt`;
  const lines = pieces.map((p) => {
    const path = p.kind === "silence" ? p.file! : p.file;
    // Экранируем апострофы в путях по правилам concat demuxer.
    const escaped = path.replace(/'/g, "'\\''");
    return `file '${escaped}'`;
  });
  await writeFile(listFile, lines.join("\n"));

  // Re-encode при concat (не используем -c copy): mp3-frame headers у
  // silence и TTS-сегментов могут не совпасть бит-в-бит даже при одинаковых
  // настройках кодека (VBR-блоки разной длительности). -c copy в этом
  // случае рвёт декодирование после первого блока — играется кусок
  // первого сегмента, потом «тишина» до конца. Re-encode чуть медленнее
  // но даёт чистый поток mp3 с корректной длительностью.
  const args = [
    "-y",
    "-f", "concat",
    "-safe", "0",
    "-i", listFile,
    "-acodec", "libmp3lame",
    "-q:a", "4",
    "-ar", "44100",
    "-ac", "1",
  ];
  if (totalDurSec) args.push("-t", String(totalDurSec));
  args.push(outFile);
  await run(FFMPEG, args);
}
