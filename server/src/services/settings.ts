import crypto from 'node:crypto';
import { config } from '../config.js';
import type { Queryable } from '../db.js';

const CAL_SECRET_KEY = 'cal_webhook_secret';

/**
 * Every secret a Cal.id webhook may be signed with: CAL_WEBHOOK_SECRET, which may
 * list several comma-separated values (e.g. one per Cal.id account or team
 * webhook), or, once rotated via /api/admin/reassign-token, only the rotated one.
 */
export async function getCalWebhookSecrets(db: Queryable): Promise<string[]> {
  const { rows } = await db.query<{ value: string }>('select value from app_settings where key=$1', [CAL_SECRET_KEY]);
  // A rotated secret replaces the env ones, so rotating really retires the old secret.
  if (rows[0]?.value) return [rows[0].value];
  return [...new Set(config.calWebhookSecret.split(',').map((s) => s.trim()).filter(Boolean))];
}

/** Safe hint for the webhook log: first 4 characters + length, never the whole secret. */
export function secretHint(secret: string): string {
  return `"${secret.slice(0, 4)}…" (${secret.length} chars)`;
}

export async function rotateCalWebhookSecret(db: Queryable): Promise<string> {
  const secret = crypto.randomBytes(32).toString('hex');
  await db.query(
    `insert into app_settings(key, value) values ($1,$2)
     on conflict (key) do update set value=excluded.value, updated_at=now()`,
    [CAL_SECRET_KEY, secret],
  );
  return secret;
}
