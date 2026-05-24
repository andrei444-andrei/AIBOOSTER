# aibooster-worker

Воркер для модуля «Перевод YouTube-видео». Живёт отдельным контейнером,
потому что Vercel serverless не подходит (нет yt-dlp/ffmpeg, нет долгих
процессов).

## Что делает

Поллит `POST {API_BASE}/api/worker/claim` (раз в `POLL_INTERVAL_MS`,
по умолчанию 5 сек). Получив job, выполняет пайплайн:

1. **Apify** (`pintostudio/youtube-transcript-scraper`) → транскрипт с
   таймкодами + метаданные. Используется вместо yt-dlp+Whisper, потому что
   YouTube агрессивно блокирует cloud-IP (Railway/Fly), а Apify держит
   residential-прокси и проходит anti-bot.
2. LLM-перевод через aimlapi.com (GPT-4o по умолчанию) — батчем, с сохранением idx.
3. ElevenLabs `elevenlabs/eleven_multilingual_v2` через aimlapi.com → mp3 на сегмент.
4. `ffmpeg` подгоняет длительность каждого сегмента под исходный таймкод
   (atempo) и микширует всё в один трек, выровненный по времени.
5. Готовый mp3 → Cloudflare R2.
6. На каждом шаге шлёт `POST /api/worker/update` для прогресса.

**Ограничение v1:** работает только с видео, у которых есть YouTube-субтитры
(автогенерёные считаются). Видео без субтитров вернут ошибку «у этого видео
нет субтитров». Fallback на download+ASR появится в v1.1, если кейс окажется
частым.

## Переменные окружения

См. `.env.example`. Минимум:
- `API_BASE` — URL Vercel-приложения.
- `WORKER_SECRET` — секрет (должен совпадать с переменной в Vercel).
- `APIFY_TOKEN` — Apify → Settings → Integrations → API tokens.
- `AIMLAPI_KEY` — ключ aimlapi.com.
- `R2_*` — доступы и публичный домен Cloudflare R2.

`VERCEL_AUTOMATION_BYPASS_SECRET` — опционально, нужен только если включена
Vercel Deployment Protection на preview. При отключённой защите — оставить пустым.

## Локально

```sh
cd worker
cp .env.example .env
# заполни переменные
docker build -t aibooster-worker .
docker run --env-file .env --rm aibooster-worker
```

## Деплой на Railway (рекомендую для MVP)

1. New project → Deploy from GitHub repo → выбрать корень репо и root directory `worker`.
2. В Variables — добавить всё из `.env.example`.
3. Railway собирает Docker автоматически, контейнер живёт постоянно.
4. Стоимость: ~$5/мес за всегда-включённый сервис.

## Деплой на Fly.io

```sh
cd worker
fly launch --no-deploy
fly secrets set AIMLAPI_KEY=... WORKER_SECRET=... R2_ACCOUNT_ID=... ...
fly deploy
```

## Замечания по моделям

- **Транскрипт**: Apify actor `pintostudio/youtube-transcript-scraper`
  ($0.01/видео). Если упрётся в лимиты — fallback на `topaz_sharingan/...`
  правится в одной строке `apify.js: ENDPOINT`.
- **Переводчик**: дефолт `gpt-4o`. Меняется через параметр `model` в
  `translateBatch` (`aimlapi.js`). Claude через aimlapi тоже доступен.
- **TTS**: `elevenlabs/eleven_multilingual_v2`. Голос по умолчанию `Rachel`.
  В v1 голос фиксированный, в v1.2 добавим выбор.

## Граничные случаи

- Видео длиннее 60 мин → ошибка наверх в `error_message`.
- Видео без субтитров → Apify вернёт пустой массив → ошибка «у этого видео
  нет субтитров».
- Пустой перевод фразы → в итоговый mp3 кладём тишину нужной длины.
- Соотношение длины TTS/оригинала вне [0.5..2.0] → строится цепочка atempo
  (см. `pipeline.js: buildAtempoChain`).
