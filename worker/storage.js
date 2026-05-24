// Загрузка готового mp3 в Cloudflare R2 (S3-совместимый API).
//
// Требует переменных окружения:
//   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET
//   R2_PUBLIC_BASE — публичный домен бакета (см. R2 → Bucket → Settings → Public)
//                    например, https://media.aibooster.example
//
// Возвращает публичный URL загруженного файла.

import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

const required = (name) => {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is required`);
  return v;
};

let _client = null;
function client() {
  if (_client) return _client;
  const accountId = required("R2_ACCOUNT_ID");
  _client = new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: required("R2_ACCESS_KEY_ID"),
      secretAccessKey: required("R2_SECRET_ACCESS_KEY"),
    },
  });
  return _client;
}

export async function uploadMp3(key, body) {
  const bucket = required("R2_BUCKET");
  const publicBase = required("R2_PUBLIC_BASE").replace(/\/+$/, "");

  await client().send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: "audio/mpeg",
      CacheControl: "public, max-age=31536000, immutable",
    }),
  );
  return `${publicBase}/${key}`;
}
