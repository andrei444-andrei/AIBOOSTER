/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Включаем папку apify-runner/ в бандл серверных функций —
  // их содержимое читает lib/apify-provisioner.ts при автодеплое
  // runner-актера на Apify. Без этого на Vercel-serverless fs.readFileSync
  // не найдёт файлы.
  outputFileTracingIncludes: {
    "/api/scraper/**/*": ["./apify-runner/**/*"],
  },
};

export default nextConfig;
