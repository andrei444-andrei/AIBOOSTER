# Воркер для перевода YouTube-видео.
#
# Тянет yt-dlp + ffmpeg как системные бинарники: на Vercel serverless их
# положить нельзя (50MB лимит, нет долгих процессов), поэтому весь "тяжёлый"
# пайплайн живёт в этом контейнере. Деплоится отдельно на Railway/Fly/Cloud Run.

FROM node:22-slim

# Зависимости системы:
#   - ffmpeg — конкатенация и нормализация аудио
#   - python3, ca-certificates, curl — для установки yt-dlp
#   - yt-dlp — скачивание аудиодорожки YT
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
