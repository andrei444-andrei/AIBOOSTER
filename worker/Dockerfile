# Воркер для перевода YouTube-видео.
#
# Источник транскрипта — Apify (см. apify.js), поэтому yt-dlp здесь больше
# не нужен. ffmpeg/ffprobe остаются — они склеивают TTS-сегменты в финальный mp3.

FROM node:22-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
      ffmpeg \
      ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY . .

ENV NODE_ENV=production
CMD ["node", "index.js"]
