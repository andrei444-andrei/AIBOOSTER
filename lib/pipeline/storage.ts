// Загрузка готового mp3 в Cloudflare R2 (S3-совместимый API).
//
// Env:
//   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET
//   R2_PUBLIC_BASE — публичный домен бакета (без trailing slash).

import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is required`);
  return v;
}

let _client: S3Client | null = null;
function client(): S3Client {
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

export async function uploadMp3(key: string, body: Buffer): Promise<string> {
  const bucket = required("R2_BUCKET");
  const accountId = required("R2_ACCOUNT_ID");
  const publicBase = required("R2_PUBLIC_BASE").replace(/\/+$/, "");
  const accessKey = required("R2_ACCESS_KEY_ID");

  try {
    await client().send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: body,
        ContentType: "audio/mpeg",
        CacheControl: "public, max-age=31536000, immutable",
      }),
    );
  } catch (err) {
    // Прикладываем неконфиденциальную часть конфига, чтобы было видно
    // что Vercel-функция ВИДИТ как env: имя бакета, начало account_id,
    // начало access_key_id. Сравни с тем что в Cloudflare UI.
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(
      `R2 upload failed: ${msg} ` +
        `[bucket="${bucket}" account=${accountId.slice(0, 8)}… access_key=${accessKey.slice(0, 6)}…${accessKey.slice(-4)} len=${accessKey.length}]`,
    );
  }
  return `${publicBase}/${key}`;
}

// Забирает объект обратно из R2. Нужен на стадии mux: чанки озвучивались
// в предыдущих тиках крона и лежат в R2, а /tmp у той функции давно стёрт.
// Читаем через S3 API, а не по публичному URL — чтобы не зависеть от
// кеша CDN на свежезалитых объектах.
export async function downloadObject(key: string): Promise<Buffer> {
  const bucket = required("R2_BUCKET");
  const res = await client().send(
    new GetObjectCommand({ Bucket: bucket, Key: key }),
  );
  if (!res.Body) throw new Error(`R2 download failed: empty body for ${key}`);
  const bytes = await res.Body.transformToByteArray();
  return Buffer.from(bytes);
}
