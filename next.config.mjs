/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // ffmpeg/ffprobe — npm-пакеты со статическими бинарниками для конкретной
  // платформы. Не даём webpack их бандлить (он спотыкается на динамическом
  // require внутри пакета), а грузим из node_modules в рантайме. На Vercel
  // outputFileTracingIncludes гарантирует, что нужный linux-x64 бинарник
  // попадёт в lambda-бандл функции пайплайна.
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
};

export default nextConfig;
