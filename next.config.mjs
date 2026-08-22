/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // ffmpeg/ffprobe — npm-пакеты со статическими бинарниками. Не даём webpack
  // их бандлить (он спотыкается на динамическом require внутри пакета),
  // а грузим из node_modules в рантайме. outputFileTracingIncludes ниже
  // вкладывает нужный linux-x64 бинарник в lambda-бандл функции пайплайна.
  serverExternalPackages: [
    "@ffmpeg-installer/ffmpeg",
    "@ffprobe-installer/ffprobe",
  ],
  outputFileTracingIncludes: {
    // Модуль AI Scraper: рантайм-актер деплоится из этой папки.
    "/api/scraper/**/*": ["./apify-runner/**/*"],
    // Модуль YouTube-translate: ffmpeg/ffprobe binaries.
    "/api/cron/process-jobs": [
      "./node_modules/@ffmpeg-installer/linux-x64/**",
      "./node_modules/@ffprobe-installer/linux-x64/**",
    ],
    // Модуль «Английский»: тот же ffmpeg/ffprobe для склейки озвучки.
    "/api/cron/process-english": [
      "./node_modules/@ffmpeg-installer/linux-x64/**",
      "./node_modules/@ffprobe-installer/linux-x64/**",
    ],
  },
};

export default nextConfig;
