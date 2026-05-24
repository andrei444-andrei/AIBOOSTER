# aibooster-worker

Воркер для модуля «Перевод YouTube-видео». Живёт отдельным контейнером,
потому что Vercel serverless не подходит (нет yt-dlp/ffmpeg, нет долгих
процессов).

## Что делает

Поллит `POST {API_BASE}/api/worker/claim` (раз в `POLL_INTERVAL_MS`,
по умолчанию 5 сек). Получив job, выполняет пайплайн:

1. `yt-dlp` скачивает аудиодорожку YouTube → mp3.
2. Whisper через aimlapi.com → сегменты с таймкодами.
3. LLM-перевод через aimlapi.com (GPT/Claude) — батчем, с сохранением idx.
4. ElevenLabs `eleven_multilingual_v2` через aimlapi.com → mp3 на сегмент.
5. `ffmpeg` подгоняет длительность каждого сегмента под исходный таймкод
   (atempo) и микширует всё в один трек, выровненный по времени.
6. Готовый mp3 → Cloudflare R2.
7. На каждом шаге шлёт `POST /api/worker/update` для прогресса.

## Переменные окружения

См. `.env.example`. Минимум:
- `API_BASE` — URL Vercel-приложения.
- `WORKER_SECRET` — секрет (должен совпадать с переменной в Vercel).
- `AIMLAPI_KEY` — ключ aimlapi.com.
- `R2_*` — доступы и публичный домен Cloudflare R2.

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

- **Whisper**: aimlapi отдаёт `whisper-1` (OpenAI-совместимый ответ
  `verbose_json` с `segments`). Если будут проблемы с языками — можно
  переключить на `whisper-large-v3`.
- **Переводчик**: дефолт `gpt-4o`. Меняется через параметр `model` в
  `translateBatch` (`aimlapi.js`). Claude через aimlapi тоже доступен.
- **TTS**: `eleven_multilingual_v2`. Голос по умолчанию `Rachel`. В v1 голос
  фиксированный, в v1.2 добавим выбор.

## Граничные случаи

- Видео длиннее 60 мин → ошибка наверх в `error_message`, пользователь видит
  в UI понятный текст.
- Пустой ASR (видео без речи) → ошибка «не удалось распознать речь».
- Пустой перевод фразы → в итоговый mp3 кладём тишину нужной длины.
- Соотношение длины TTS/оригинала вне [0.5..2.0] → строится цепочка atempo
  (см. `pipeline.js: buildAtempoChain`).
