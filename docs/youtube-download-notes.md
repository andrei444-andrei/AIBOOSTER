# Скачивание видео с YouTube — выгрузка наработок AIBOOSTER

Документ самодостаточный: его можно отдать в другой проект целиком, без
доступа к этому репозиторию. Внутри — весь код, который был написан, все
грабли, на которые наступили, и причины, по которым от рабочего решения
пришлось отказаться.

Источник: репозиторий `andrei444-andrei/AIBOOSTER`, модуль
«Перевод YouTube-видео» (май–август 2026).

---

## 0. Главное за 30 секунд

**Рабочего скачивания видео/аудио с YouTube в проекте сейчас НЕТ.**
Было два пути, оба доведены до кода:

| Путь | Что даёт | Статус |
|------|----------|--------|
| **A. `yt-dlp` в Docker-контейнере** | Настоящие байты аудио (mp3) | Написан, работал локально, **умер в проде** — YouTube блокирует облачные IP |
| **B. Apify actor** | Только субтитры с таймкодами, медиа не качает | **Работает в проде до сих пор** |

Продакшн-пайплайн живёт на пути Б: берёт готовые субтитры YouTube, переводит
их LLM-кой и озвучивает через TTS. Исходное аудио не скачивается вообще —
итоговый mp3 синтезируется с нуля.

**Если новому проекту нужны именно байты видео/аудио** — путь Б не подойдёт,
нужно возвращаться к пути А и решать проблему блокировок (см. §3.4).

---

## 1. Парсинг и валидация YouTube-URL

Готовый, обкатанный код. Забирается в новый проект как есть.

`videoId` у YouTube — ровно 11 символов из `[A-Za-z0-9_-]`.

```ts
const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;

export function extractVideoId(input: string): string | null {
  const raw = (input ?? "").trim();
  if (!raw) return null;

  // Уже сам id?
  if (VIDEO_ID_RE.test(raw)) return raw;

  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }

  const host = u.hostname.toLowerCase().replace(/^www\./, "").replace(/^m\./, "");
  if (host === "youtu.be") {
    const id = u.pathname.split("/").filter(Boolean)[0];
    return id && VIDEO_ID_RE.test(id) ? id : null;
  }
  if (host !== "youtube.com" && host !== "music.youtube.com") {
    return null;
  }

  // /watch?v=...
  const v = u.searchParams.get("v");
  if (v && VIDEO_ID_RE.test(v)) return v;

  // /shorts/<id>, /embed/<id>, /v/<id>, /live/<id>
  const parts = u.pathname.split("/").filter(Boolean);
  if (parts.length >= 2) {
    const [prefix, id] = parts;
    if (["shorts", "embed", "v", "live"].includes(prefix) && VIDEO_ID_RE.test(id)) {
      return id;
    }
  }
  return null;
}

export function canonicalUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`;
}
```

Покрытые форматы: `watch?v=`, `youtu.be/`, `shorts/`, `embed/`, `v/`, `live/`,
`m.youtube.com`, `music.youtube.com`, голый id.

---

## 2. Метаданные и списки видео БЕЗ API-ключа

Два бесплатных трюка, которые работают и не требуют ни YouTube Data API,
ни квот, ни OAuth.

### 2.1. Название ролика через oEmbed

```
GET https://www.youtube.com/oembed?url=<encoded watch-url>&format=json
```

Отдаёт JSON с `title`, `author_name`, `thumbnail_url`. Ключ не нужен.
Возвращает не-200 для приватных/удалённых видео — удобная проверка
доступности.

```ts
export async function fetchYoutubeTitle(videoId: string): Promise<string | null> {
  const url = `https://www.youtube.com/oembed?url=${encodeURIComponent(
    canonicalUrl(videoId),
  )}&format=json`;
  try {
    const res = await fetch(url, {
      headers: { "user-agent": "Mozilla/5.0 (compatible; MetaFetcher/1.0)" },
      next: { revalidate: 3600 },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as Record<string, unknown>;
    const title = data.title;
    return typeof title === "string" && title.trim() ? title.trim() : null;
  } catch {
    return null;
  }
}
```

**Зачем:** карточка задачи сразу показывает человекочитаемое название, а не
`yt_video_id`, ещё до того как отработает основной пайплайн.

### 2.2. Список видео плейлиста/канала через RSS

```
https://www.youtube.com/feeds/videos.xml?playlist_id=<PLAYLIST_ID>
https://www.youtube.com/feeds/videos.xml?channel_id=<CHANNEL_ID>
```

Atom-фид, ключ не нужен. Каждое видео — `<entry>`, внутри `<yt:videoId>`
и `<title>`. Полноценный XML-парсер не нужен, фид плоский:

```ts
function extractEntries(xml: string): Array<{ videoId: string; title: string | null }> {
  const out: Array<{ videoId: string; title: string | null }> = [];
  const seen = new Set<string>();
  const entries = xml.match(/<entry\b[\s\S]*?<\/entry>/g) ?? [];
  for (const entry of entries) {
    const idMatch = entry.match(/<yt:videoId>([^<]+)<\/yt:videoId>/);
    if (!idMatch) continue;
    const videoId = idMatch[1].trim();
    if (!videoId || seen.has(videoId)) continue;
    const titleMatch = entry.match(/<title>([\s\S]*?)<\/title>/);
    const title = titleMatch ? decodeXmlText(titleMatch[1].trim()) : null;
    out.push({ videoId, title });
    seen.add(videoId);
  }
  return out;
}
```

**Ограничение фида:** отдаёт только последние ~15 записей. Для полного
плейлиста этого мало — но для «следи за новыми видео» (автоочередь по крону
раз в минуту) хватает с запасом.

**Грабля:** в названиях приходят HTML-entities (`&amp;`, `&quot;`, `&lt;`,
`&gt;`) без CDATA — нужен минимальный декодер, целую библиотеку тащить незачем.

---

## 3. Путь А — `yt-dlp` (единственное, что реально качает медиа)

### 3.1. Код скачивания

Вызов внешнего бинарника через `spawn`. Обёртка `run()` копит stdout/stderr
и превращает ненулевой exit-код в человекочитаемую ошибку:

```js
import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";

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

// Метаданные без скачивания: -J отдаёт весь info-json одним объектом.
async function ytDlpInfo(url) {
  const buf = await run("yt-dlp", ["-J", "--no-warnings", url]);
  const json = JSON.parse(buf.toString());
  return {
    title: json.title || null,
    duration: typeof json.duration === "number" ? Math.round(json.duration) : null,
  };
}

// Скачивание аудиодорожки в mp3 максимального качества.
async function ytDlpAudio(url, outPath) {
  await run("yt-dlp", [
    "-x",                       // extract audio
    "--audio-format", "mp3",
    "--audio-quality", "0",     // 0 = лучшее
    "-o", outPath,
    "--no-warnings",
    "--no-playlist",            // ссылка с &list= не утянет весь плейлист
    url,
  ]);
  const st = await stat(outPath).catch(() => null);
  if (!st || st.size === 0) throw new Error("yt-dlp не выдал аудио");
}
```

Важные детали, которые стоили времени:

- `-J` даёт полный info-json **без скачивания** — дешёвая проверка длительности
  и доступности до того, как тянуть мегабайты.
- `--no-playlist` обязателен: ссылка вида `watch?v=X&list=Y` иначе утягивает
  весь плейлист.
- Проверка `stat().size === 0` после скачивания — `yt-dlp` умеет выйти с
  кодом 0 и не оставить файла.
- `maxBuffer` на stdout: info-json длинного ролика легко перевалит за дефолт.

### 3.2. Dockerfile

`yt-dlp` — python-скрипт, ставится одним бинарником с GitHub Releases.
`ffmpeg` нужен ему для `-x --audio-format mp3`.

```dockerfile
FROM node:22-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
      ffmpeg \
      python3 \
      ca-certificates \
      curl \
    && curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
    && chmod a+rx /usr/local/bin/yt-dlp \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev
COPY . .
ENV NODE_ENV=production
CMD ["node", "index.js"]
```

### 3.3. Почему контейнер, а не serverless

Дословная причина из комментария в Dockerfile:

> На Vercel serverless их положить нельзя (50MB лимит, нет долгих процессов),
> поэтому весь «тяжёлый» пайплайн живёт в этом контейнере.

Три независимых блокера для serverless:
1. **Лимит размера бандла** — `yt-dlp` + `ffmpeg` в лямбду не влезают.
2. **Нет системных бинарников** — `apt-get` в лямбде не существует.
3. **Нет долгих процессов** — скачивание часового ролика не укладывается
   в окно функции.

Архитектура была: контейнер поллит `POST {API_BASE}/api/worker/claim` раз в
5 секунд, забирает job, гонит пайплайн, шлёт прогресс в `POST /api/worker/update`.
Деплой — Railway (~$5/мес за always-on) или Fly.io.

### 3.4. ⚠️ Почему путь А умер — главная находка

Дословно из коммита `32e5742` (24 мая 2026):

> **yt-dlp on cloud IPs (Railway/Fly) is heavily anti-bot-rate-limited by
> YouTube. Even popular videos intermittently fail with "Sign in to confirm
> you're not a bot". Residential proxies are the only real fix.**

Ключевое: ломается **не код**, а IP-адрес. Локально с домашнего интернета
всё работает; тот же самый бинарник с тем же набором флагов на облачном IP
Railway/Fly получает «Sign in to confirm you're not a bot» — и, что хуже
всего, **не стабильно, а плавающе**: часть роликов проходит, часть падает,
на повторе картина меняется. Отлаживать такое почти невозможно — оно не
воспроизводится.

Вывод, зафиксированный в коммите: **residential-прокси — единственное
настоящее лечение.** Не смена флагов, не user-agent, не задержки между
запросами.

**Направления, если новому проекту всё же нужны байты** (это рекомендации,
в проде AIBOOSTER они не проверялись):
- residential/мобильные прокси под `yt-dlp --proxy`;
- прокидывание cookies залогиненного аккаунта (`--cookies`), с понятным
  риском для аккаунта;
- готовый сервис-посредник, который держит прокси-инфраструктуру за тебя
  (по этой логике и выбрали Apify — см. §4);
- держать `yt-dlp` свежим: YouTube регулярно ломает извлечение, апстрим
  чинит быстро, но закреплённая старая версия протухает.

### 3.5. Что ещё умерло вместе с путём А

В том же коммите закопали ASR-ветку. Полезно знать, чтобы не повторять:

> The aimlapi.com Whisper wrapper called `POST /v1/audio/transcriptions`
> (OpenAI-compatible shape), which doesn't exist on aimlapi. The actual API
> is async two-step (`POST /v1/stt/create` → `GET /v1/stt/{id}`) and requires
> a **public URL** for the audio, not a file upload.

То есть даже если аудио скачано — отправить его в STT-шлюз файлом может не
получиться: некоторым API нужен публично доступный URL, а значит сначала
заливка в объектное хранилище. Плюс это асинхронный двухшаговый API, а не
один запрос.

Отдельно (проверено позже, актуально на август 2026): AIMLAPI не поддерживает
`/v1/audio/transcriptions` вообще. Для транскрипции в проекте пришлось завести
прямые ключи — OpenAI `gpt-4o-transcribe` для голосового ввода и Deepgram
(`nova-2`/`nova-3`) там, где важна скорость (sync ~0.3–0.5 с против ~5 с
у async-очереди AIMLAPI).

---

## 4. Путь Б — Apify (то, что работает в проде)

### 4.1. Идея

Вместо драки с анти-ботом — отдать задачу сервису, который уже держит
residential-прокси и cookies. Побочный бонус: у ~80% популярных роликов
субтитры на YouTube уже есть, значит ASR не нужен вообще — таймкоды
приезжают вместе с текстом.

Из коммита:

> Apify maintains residential proxies + cookies → no anti-bot fight.
> YouTube already has captions for ~80% of popular content, so we get
> segments with timestamps directly without ASR.

**Ограничение, которое нужно принять осознанно:** этот путь **не даёт медиа**.
Только текст с таймкодами. Для «перевести и озвучить заново» — идеально.
Для «получить файл видео» — бесполезно.

### 4.2. Конкретный actor и вызов

- Actor: `pintostudio/youtube-transcript-scraper`
- Endpoint: `POST https://api.apify.com/v2/acts/pintostudio~youtube-transcript-scraper/run-sync-get-dataset-items?token=<APIFY_TOKEN>`
- Body: `{ "videoUrl": "https://www.youtube.com/watch?v=..." }`

`run-sync-get-dataset-items` — синхронный вызов: один HTTP-запрос, ответ уже
содержит результат. Не надо поллить статус run-а.

```ts
const ENDPOINT =
  "https://api.apify.com/v2/acts/pintostudio~youtube-transcript-scraper/run-sync-get-dataset-items";

export interface TranscriptSegment {
  idx: number;
  start_ms: number;
  end_ms: number;
  text: string;
}

export interface Transcript {
  title: string | null;
  duration: number | null;
  language: string | null;
  segments: TranscriptSegment[];
}

export async function fetchTranscript(videoUrl: string): Promise<Transcript> {
  const token = process.env.APIFY_TOKEN;
  if (!token) throw new Error("APIFY_TOKEN is required");

  const url = `${ENDPOINT}?token=${encodeURIComponent(token)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ videoUrl }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(explainApifyFailure(res.status, text));
  }

  const data = (await res.json()) as unknown;
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error("у этого видео нет субтитров на YouTube — попробуй другое");
  }

  const first = (data[0] ?? {}) as Record<string, unknown>;
  const rawSegments: unknown[] = Array.isArray(first.transcript)
    ? (first.transcript as unknown[])
    : Array.isArray(first.data)
      ? (first.data as unknown[])
      : (data as unknown[]);

  const segments: TranscriptSegment[] = [];
  rawSegments.forEach((raw, idx) => {
    if (!raw || typeof raw !== "object") return;
    const r = raw as Record<string, unknown>;
    const text = String(r.text ?? r.transcript ?? "").trim();
    const start = toSeconds(r.start ?? r.offset ?? r.startTime);
    const dur = toSeconds(r.dur ?? r.duration ?? r.length);
    if (!text || !Number.isFinite(start)) return;
    const endSec = Number.isFinite(dur) && dur > 0 ? start + dur : start + 2;
    segments.push({
      idx,
      start_ms: Math.round(start * 1000),
      end_ms: Math.round(endSec * 1000),
      text,
    });
  });

  if (segments.length === 0) {
    throw new Error("Apify вернул пустой транскрипт — формат изменился");
  }

  return {
    title: (first.videoTitle as string) || (first.title as string) || null,
    duration: toSeconds(first.videoDuration ?? first.duration) || null,
    language: (first.language as string) || (first.transcriptLanguage as string) || null,
    segments,
  };
}
```

### 4.3. Защитный парсинг — важнее, чем кажется

Форма ответа стороннего актера **нестабильна**. Поэтому в коде:

- сегменты ищутся в трёх местах: `first.transcript`, `first.data`, либо сам
  корневой массив;
- текст читается из `text` **или** `transcript`;
- начало — из `start` / `offset` / `startTime`;
- длительность — из `dur` / `duration` / `length`;
- название — из `videoTitle` / `title`; язык — из `language` / `transcriptLanguage`;
- если длительности нет — конец сегмента ставится как `start + 2` секунды;
- пустой результат разбора — явная ошибка «формат изменился», а не молчаливый
  пустой транскрипт.

Числа приходят то числом, то строкой, то `hh:mm:ss` — универсальный парсер:

```ts
function toSeconds(v: unknown): number {
  if (v == null) return NaN;
  if (typeof v === "number") return v;
  const s = String(v).trim();
  if (/^\d+(\.\d+)?$/.test(s)) return parseFloat(s);
  const m = s.match(/^(?:(\d+):)?(\d+):(\d+(?:\.\d+)?)$/);
  if (m) {
    const h = m[1] ? parseInt(m[1], 10) : 0;
    const mm = parseInt(m[2], 10);
    const ss = parseFloat(m[3]);
    return h * 3600 + mm * 60 + ss;
  }
  return NaN;
}
```

### 4.4. Расшифровка отказов Apify

Сырой ответ Apify в интерфейсе бесполезен. Маппинг статуса и тела в понятный
текст (сам сырой ответ при этом уезжает в лог, для диагностики ничего не
теряется):

```ts
function explainApifyFailure(status: number, body: string): string {
  const type = /"type"\s*:\s*"([^"]+)"/.exec(body)?.[1] ?? "";
  const message = /"message"\s*:\s*"([^"]+)"/.exec(body)?.[1] ?? "";
  const tail = ` [apify ${status}${type ? ` ${type}` : ""}]`;

  if (/hard limit|usage limit|monthly usage/i.test(message) || type === "platform-feature-disabled") {
    return "у Apify закончился месячный лимит. Пополни счёт или подними лимит " +
           "в консоли Apify и нажми «Попробовать снова» — уже сделанная работа не пропадёт." + tail;
  }
  if (status === 401 || status === 403) {
    return "Apify не принял токен — проверь APIFY_TOKEN." + tail;
  }
  if (status === 429) {
    return "Apify просит подождать — слишком много запросов подряд. Попробуй через пару минут." + tail;
  }
  if (status >= 500) {
    return "Apify сейчас недоступен — это временно, нажми «Попробовать снова» позже." + tail;
  }
  return (message || "не удалось получить субтитры с YouTube") + tail;
}
```

Отдельная грабля: исчерпание месячного лимита прилетает как **403** с
`type: "platform-feature-disabled"` — по статусу не отличить от невалидного
токена, надо смотреть тело.

### 4.5. Чего этот путь не умеет

- **Нет субтитров — нет результата.** Ролики без captions отваливаются с
  внятной ошибкой. Фолбэк на «скачать + ASR» так и не сделали.
- Качество автоматических субтитров YouTube — так себе: нет пунктуации,
  бывают ошибки распознавания.
- YouTube режет речь на куски по 1–3 секунды, **часто посреди предложения** —
  см. §5.1, это оказалось важнее, чем ожидалось.

---

## 5. Инфраструктурные наработки вокруг

Это уже не про скачивание, но в новом проекте с медиа-пайплайном всплывёт
почти наверняка.

### 5.1. Чанки вместо сегментов — переводить надо абзацами

Самая неочевидная находка по качеству. Дословно из комментария к пайплайну:

> YouTube режет речь на куски по 1-3 секунды, часто посреди предложения —
> переводить такие куски пословно даёт неестественный результат. Чанк
> собирается на естественных паузах говорящего и попадает в переводчик как
> цельный абзац — модель свободно меняет порядок слов и переформулирует под
> язык. TTS читает связный текст, не отрывки.

Рабочая единица — **~3 минуты речи**, собранная на паузах говорящего, а не
отдельный субтитр.

Второе следствие — отказ от подгонки длительности. В v1 каждый сегмент TTS
растягивался/сжимался фильтром `atempo`, чтобы попасть в исходный таймкод.
Звучало плохо. Итог — «подкаст-режим»: переведённая речь идёт в натуральном
темпе, финальный mp3 короче видео (русский плотнее английского), зато
звучит естественно.

### 5.2. Резюмируемый пайплайн — длинное видео за один заход не обработать

Замер с прода: **~30 минут видео = ~195 секунд обработки при лимите 300**,
то есть примерно **10x реального времени**. Часовое видео физически не
помещалось в одну инвокацию; из 14 задач в базе 5 упали именно так.

Решение — стейт-машина поверх таблицы чанков. Каждый чанк переводится и
озвучивается независимо, mp3 чанка сразу уезжает в объектное хранилище, строка
пишется в БД. Тик крона работает **по бюджету времени** и выходит; следующий
продолжает с того же места.

```sql
CREATE TABLE IF NOT EXISTS video_translation_chunks (
  job_id TEXT NOT NULL,
  idx INTEGER NOT NULL,
  start_ms INTEGER NOT NULL,
  end_ms INTEGER NOT NULL,
  source_text TEXT NOT NULL,
  translated_text TEXT,
  utterances TEXT,
  audio_key TEXT,
  audio_url TEXT,
  audio_dur_ms INTEGER,
  attempts INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (job_id, idx)
)
```

Что это дало:
- видео любой длины обрабатывается за несколько тиков;
- падение стоит **один чанк**, а не весь прогон с уже оплаченным TTS;
- ретрай переиспользует всё, что успело сделаться.

Сопутствующие настройки: `maxDuration` 300 → **800** (потолок Vercel Pro
поверх fluid compute), параллелизм 4 → 8, окно «зависшей» задачи 30 мин → 3 мин
плюс heartbeat. Бюджет тика берётся с запасом от лимита:

```ts
export const maxDuration = 800;
const BUDGET_MS = (maxDuration - 40) * 1000; // запас, чтобы дописать прогресс в БД
```

### 5.3. ffmpeg на Vercel — можно, но с бубном

Бинарники ставятся npm-пакетами `@ffmpeg-installer/ffmpeg` и
`@ffprobe-installer/ffprobe`, но webpack спотыкается на динамическом
`require` внутри. Рабочая конфигурация:

```js
// next.config.mjs
serverExternalPackages: [
  "@ffmpeg-installer/ffmpeg",
  "@ffprobe-installer/ffprobe",
],
outputFileTracingIncludes: {
  "/api/cron/process-jobs": [
    "./node_modules/@ffmpeg-installer/linux-x64/**",
    "./node_modules/@ffprobe-installer/linux-x64/**",
  ],
},
```

`serverExternalPackages` — не бандлить, грузить из `node_modules` в рантайме.
`outputFileTracingIncludes` — вложить linux-x64 бинарник в лямбда-бандл именно
той функции, которая его дёргает.

### 5.4. Склейка сотен аудио-кусков: три итерации и два бага

Отдельная история, стоившая четырёх коммитов. Реальный тест-кейс —
ролик на 732 сегмента.

**Итерация 1 — `amix` со сдвигом `adelay`.** Каждый кусок сдвигается на свой
`start_ms`, всё микшируется одним графом. На 700+ входах функция висела на
92% до самого таймаута. Стоимость графа выглядит линейной, но инициализация
фильтрографа и планирование `amix` резко деградируют после ~150 входов,
и сверху давит память.

**Итерация 2 — батчи по 50.** Группируем куски по 50, микшируем каждую
группу, потом микшируем результаты. `adelay` использует абсолютный `start_ms`,
поэтому промежуточные файлы уже правильно позиционированы во времени.
Не помогло: `adelay` **дописывает каждому входу N минут ведущей тишины**, и
для часового ролика ffmpeg аллоцирует буферы под все эти раздутые потоки.

**Итерация 3 — `concat`-демультиплексор.** Ноль декодирования, ноль
микширования:

```
ffmpeg -f concat -safe 0 -i list.txt -c copy out.mp3
```

В `list.txt` — чередование файлов тишины и файлов озвучки в порядке
`start_ms`. Это и стало рабочим решением.

**Два бага, всплывших сразу после:**

1. *mp3 длиной час для 15-минутного видео* — нужна вменяемая обрезка
   итоговой длительности.
2. *Звук играет первые ~5 секунд, дальше тишина.* Корневая причина
   красивая: файлы тишины генерировались с `-q:a 9` (худший VBR), а куски
   озвучки после обработки — с `-q:a 4`. `concat` с `-c copy` сшивает
   mp3-фреймы **как есть**, а декодеры давятся, когда профиль фрейма
   меняется между блоками — продолжают выдавать сэмплы, но молчаливые.

   Лечение двойное: привести тишину к тому же `-q:a 4`, **и** отказаться
   от `-c copy` в пользу полного re-encode (`libmp3lame -q:a 4`, 44.1 kHz,
   моно). Пересжатие 15-минутного файла — несколько секунд, надёжность
   того стоит.

**Вывод для нового проекта:** склеиваешь много mp3 — приводи все куски к
одному профилю кодирования и не экономь на `-c copy`. И не строй
фильтрограф на сотни входов.

### 5.5. Хранилище

Готовый mp3 → Cloudflare R2 через S3-совместимый API (`@aws-sdk/client-s3`),
`region: "auto"`, endpoint `https://<account>.r2.cloudflarestorage.com`.

Тонкость резюмируемого пайплайна: на стадии склейки чанки нужно **читать
обратно из хранилища** — они озвучивались в предыдущих тиках крона, а `/tmp`
той функции давно стёрт. Читать надо через S3 API, а не по публичному
URL — чтобы не зависеть от кеша CDN на свежезалитых объектах.

### 5.6. Мелкие грабли, стоившие по коммиту каждая

- **Vercel Deployment Protection**: внешний воркер, поллящий preview-деплой,
  получает 401 с SSO-страницей на каждый запрос. Лечится заголовком
  `x-vercel-protection-bypass` со значением `VERCEL_AUTOMATION_BYPASS_SECRET`.
- **Vercel Cron и авторизация**: Vercel шлёт `Authorization: Bearer <CRON_SECRET>`
  автоматически. Если проверять fallback-ом по своему админ-токену, которого
  Vercel не знает, — ловишь 401 на каждом тике.
- **Имена моделей у шлюза**: `eleven_multilingual_v2` не принимается, нужно
  `elevenlabs/eleven_multilingual_v2` (префикс провайдера). Недокументированное
  поле `language` в теле запроса ломало вызов.
- **Длительность ролика**: если источник не отдал `duration`, поле остаётся
  `NULL` и проверка лимита длины **не срабатывает никогда**. Считать из
  таймкода последнего сегмента.
- **Атомарный claim задачи в БД** позволяет нескольким тикам крона работать
  параллельно по разным задачам без гонок.
- **Не протекай инфраструктурой в текст ошибки** для пользователя: «Vercel-функция
  не успеет за 5 минут» — это сообщение разработчику, а не пользователю.

---

## 6. Переменные окружения

Из рабочего `.env.example`, только относящееся к теме:

```env
# Apify — источник субтитров YouTube (путь Б).
# https://console.apify.com/account/integrations
# Никогда не уходит на клиент — только серверные роуты.
APIFY_TOKEN=

# Cloudflare R2 — куда складывается итоговый mp3.
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET=
R2_PUBLIC_BASE=https://media.example.com   # без trailing slash

# Секрет для Vercel Cron.
CRON_SECRET=

# Секрет для эндпоинтов внешнего воркера (путь А, legacy).
WORKER_SECRET=

# ID публичного плейлиста для автоочереди (часть URL после list=).
YOUTUBE_PLAYLIST_ID=

# Опционально: обход Vercel Deployment Protection для внешнего воркера.
VERCEL_AUTOMATION_BYPASS_SECRET=
```

Транскрипция аудио (если понадобится ASR-ветка):

```env
OPENAI_API_KEY=      # gpt-4o-transcribe; AIMLAPI /v1/audio/transcriptions НЕ поддерживает
DEEPGRAM_API_KEY=    # sync STT ~0.3–0.5 с там, где важна скорость
```

---

## 7. Рекомендации для нового проекта

Не проверено в проде AIBOOSTER — это выводы, а не факты.

**Если нужен только текст/субтитры** — бери путь Б целиком (§4). Он
работает, дёшев и не требует своей инфраструктуры. Главное — защитный
парсинг ответа (§4.3) и внятная расшифровка ошибок (§4.4).

**Если нужны байты видео/аудио:**
1. Начинай сразу с `yt-dlp` (§3.1) — код готов, ничего лучше не найдено.
2. **Сразу закладывай residential-прокси.** Это не оптимизация «на потом»,
   а условие работоспособности в облаке. На своём облачном IP оно будет
   плавающе падать, и ты потратишь дни на отладку невоспроизводимого.
3. Не пытайся впихнуть это в serverless (§3.3). Нужен контейнер: Railway,
   Fly.io, Cloud Run.
4. Проверяй длительность через `yt-dlp -J` **до** скачивания.
5. Держи `yt-dlp` свежим — обновлять при сборке образа, не пинить версию.

**Общее:**
- Разбивай работу на резюмируемые чанки с самого начала (§5.2), если ролики
  могут быть длиннее нескольких минут. Переделывать монолитный пайплайн
  в стейт-машину дороже, чем сразу так написать.
- Планируй ~10x реального времени на полный медиа-пайплайн.
- Промежуточные артефакты — сразу в объектное хранилище, `/tmp` эфемерен.

---

## 8. Карта: где что лежит в AIBOOSTER

Репозиторий `andrei444-andrei/AIBOOSTER`.

**Актуальный код (ветка `claude/youtube-translate-issue-us73wl`, свежее `main`):**

| Файл | Что внутри |
|------|-----------|
| `lib/youtube.ts` | Парсинг URL, oEmbed-заголовок, список языков, лимит длины |
| `lib/pipeline/apify.ts` | Путь Б целиком: вызов актера, разбор, расшифровка ошибок |
| `lib/pipeline/run.ts` | Оркестрация: транскрипт → перевод → TTS → склейка → R2 |
| `lib/pipeline/ffmpeg.ts` | Нормализация, тишина, `concat` с таймингами, `ffprobe` |
| `lib/pipeline/storage.ts` | Загрузка/чтение R2 через S3 API |
| `lib/chunks.ts` | Таблица чанков, статистика, резюмируемость |
| `lib/playlist.ts` | RSS-фид плейлиста → автоочередь |
| `lib/schema.ts` | DDL `video_translation_jobs` и `video_translation_chunks` |
| `app/api/cron/process-jobs/route.ts` | Тик крона по бюджету времени |
| `next.config.mjs` | Конфиг ffmpeg-бинарников для лямбды |

**Мёртвый код пути А — только в истории git:**

| Коммит | Что там |
|--------|---------|
| `fc9e1be` | Модуль v1 целиком: `worker/pipeline.js` с `ytDlpInfo`/`ytDlpAudio`, `worker/Dockerfile` с установкой yt-dlp, `worker/README.md` с инструкцией деплоя на Railway/Fly |
| `ba9e488` | Обход Vercel Deployment Protection для воркера |
| `32e5742` | **Ключевой коммит**: причина отказа от yt-dlp + переход на Apify. Читать сообщение целиком |
| `2577ec2` | Удаление воркера, перенос пайплайна в Vercel Functions + Cron |
| `1940a9d`, `13ed05d`, `49de616` | Три итерации склейки аудио и разбор двух багов (§5.4) |
| `bf36afe` | Резюмируемый пайплайн, замеры 10x, таблица чанков |
| `5c6dcae` | Человекочитаемые ошибки Apify вместо сырого JSON |

Достать удалённый код:

```bash
git show fc9e1be:worker/pipeline.js
git show fc9e1be:worker/Dockerfile
git show fc9e1be:worker/README.md
git show 32e5742          # сообщение коммита = разбор причин
```
