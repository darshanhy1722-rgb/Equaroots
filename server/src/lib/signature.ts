import crypto from 'node:crypto';

export function signBody(raw: Buffer | string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(raw).digest('hex');
}

/** Constant-time check of Cal's X-Cal-Signature-256 (hex HMAC-SHA256 of the raw body). */
export function verifyCalSignature(raw: Buffer, header: string | undefined, secret: string): boolean {
  if (!secret || !header) return false;
  const given = header.trim().replace(/^sha256=/i, '').toLowerCase();
  const expected = signBody(raw, secret);
  if (!/^[0-9a-f]+$/.test(given) || given.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(given, 'hex'), Buffer.from(expected, 'hex'));
}
