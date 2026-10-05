import crypto from 'node:crypto';
import { config } from '../config.js';
import type { Queryable } from '../db.js';

const CAL_SECRET_KEY = 'cal_webhook_secret';

/** Rotated secret (DB) wins over the env var, so /api/admin/reassign-token takes effect without a redeploy. */
export async function getCalWebhookSecret(db: Queryable): Promise<string> {
  const { rows } = await db.query<{ value: string }>('select value from app_settings where key=$1', [CAL_SECRET_KEY]);
  return rows[0]?.value || config.calWebhookSecret;
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
