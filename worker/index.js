// Главный цикл воркера.
//
// Поллит /api/worker/claim каждые POLL_INTERVAL_MS, при наличии job выполняет
// пайплайн: yt-dlp → Whisper (aimlapi) → LLM-перевод (aimlapi) → ElevenLabs
// (aimlapi) → склейка ffmpeg → загрузка mp3 в Cloudflare R2 → /api/worker/update.
//
// Конституция:
//   - AI только через aimlapi.com (AIMLAPI_KEY).
//   - Ошибки шлём в /api/worker/update с error{message,stack} — там они
//     попадают в единую app_errors.

import { hostname } from "node:os";
import { runJob } from "./pipeline.js";

const API_BASE = required("API_BASE"); // e.g. https://aibooster.vercel.app
const WORKER_SECRET = required("WORKER_SECRET");
// Опционально: токен для обхода Vercel Deployment Protection на превью.
// Берётся в Vercel → Settings → Deployment Protection → Protection Bypass for
// Automation. Когда задан — шлём header x-vercel-protection-bypass.
const VERCEL_BYPASS = process.env.VERCEL_AUTOMATION_BYPASS_SECRET || "";

const POLL_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL_MS || "5000", 10);
const WORKER_ID = `${hostname()}-${process.pid}`;

function required(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`[worker] ${name} is required`);
    process.exit(1);
  }
  return v;
}

function buildHeaders() {
  const h = {
    "content-type": "application/json",
    authorization: `Bearer ${WORKER_SECRET}`,
  };
  if (VERCEL_BYPASS) {
    h["x-vercel-protection-bypass"] = VERCEL_BYPASS;
    h["x-vercel-set-bypass-cookie"] = "samesitenone";
  }
  return h;
}

async function claim() {
  const res = await fetch(`${API_BASE}/api/worker/claim`, {
    method: "POST",
    headers: buildHeaders(),
    body: JSON.stringify({ worker_id: WORKER_ID }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`claim failed ${res.status}: ${text.slice(0, 200)}`);
  }
  const data = await res.json();
  return data.job ?? null;
}

export async function postUpdate(jobId, payload) {
  const res = await fetch(`${API_BASE}/api/worker/update`, {
    method: "POST",
    headers: buildHeaders(),
    body: JSON.stringify({ job_id: jobId, ...payload }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.error(`[worker] update failed ${res.status}: ${text.slice(0, 200)}`);
  }
}

async function loop() {
  console.log(
    `[worker] starting, id=${WORKER_ID}, api=${API_BASE}, bypass=${VERCEL_BYPASS ? "on" : "off"}`,
  );
  while (true) {
    let job = null;
    try {
      job = await claim();
    } catch (err) {
      console.error("[worker] claim error", err.message);
    }
    if (!job) {
      await sleep(POLL_INTERVAL_MS);
      continue;
    }
    console.log(`[worker] picked job ${job.id} (${job.video_id} → ${job.target_lang})`);
    try {
      await runJob(job, postUpdate);
      console.log(`[worker] job ${job.id} done`);
    } catch (err) {
      console.error(`[worker] job ${job.id} failed:`, err.message);
      await postUpdate(job.id, {
        error: { message: err.message, stack: err.stack },
      });
    }
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

loop().catch((err) => {
  console.error("[worker] fatal", err);
  process.exit(1);
});
