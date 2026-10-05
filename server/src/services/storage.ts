import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { config } from '../config.js';

/**
 * Private PDF storage. With STORAGE_BUCKET set, uses any S3-compatible bucket
 * (S3 / R2 / Supabase) and hands out short-lived presigned URLs. Without it,
 * falls back to local disk, served through an HMAC-signed, expiring URL.
 * Either way the stored reference is a "key", never a public URL.
 */

const s3 = config.storage.bucket
  ? new S3Client({
      region: config.storage.region,
      endpoint: config.storage.endpoint || undefined,
      forcePathStyle: !!config.storage.endpoint,
      credentials: config.storage.accessKey
        ? { accessKeyId: config.storage.accessKey, secretAccessKey: config.storage.secretKey }
        : undefined,
    })
  : null;

export const SIGNED_URL_TTL_S = 15 * 60;

export async function putPdf(key: string, pdf: Buffer): Promise<string> {
  if (s3) {
    await s3.send(
      new PutObjectCommand({ Bucket: config.storage.bucket, Key: key, Body: pdf, ContentType: 'application/pdf' }),
    );
  } else {
    const file = localPath(key);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, pdf);
  }
  return key;
}

function localPath(key: string): string {
  const root = path.resolve(config.storage.localDir);
  const file = path.resolve(root, key);
  if (!file.startsWith(root + path.sep)) throw new Error('invalid storage key');
  return file;
}

function localSig(key: string, exp: number) {
  return crypto.createHmac('sha256', config.sessionSecret).update(`${key}:${exp}`).digest('hex');
}

export async function signedPdfUrl(key: string): Promise<string> {
  if (s3) {
    return getSignedUrl(s3, new GetObjectCommand({ Bucket: config.storage.bucket, Key: key }), {
      expiresIn: SIGNED_URL_TTL_S,
    });
  }
  const exp = Math.floor(Date.now() / 1000) + SIGNED_URL_TTL_S;
  return `${config.appBaseUrl}/files/${encodeURI(key)}?exp=${exp}&sig=${localSig(key, exp)}`;
}

/** Validates a local signed URL and returns the file bytes, or null. */
export async function readLocalSigned(key: string, exp: string, sig: string): Promise<Buffer | null> {
  const e = Number(exp);
  if (!e || e < Date.now() / 1000) return null;
  const expected = localSig(key, e);
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    return await fs.readFile(localPath(key));
  } catch {
    return null;
  }
}
