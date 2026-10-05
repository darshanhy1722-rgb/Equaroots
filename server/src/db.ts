import pg from 'pg';
import { config } from './config.js';

function wantsSsl(url: string): boolean {
  if (process.env.DATABASE_SSL) return process.env.DATABASE_SSL === 'true';
  if (/sslmode=(require|verify)/.test(url)) return true;
  return /\.(render\.com|neon\.tech|supabase\.co)\b/.test(url);
}

export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  // Railway's private URL (*.railway.internal) is plain TCP; public proxy URLs and most
  // managed hosts want TLS. Override with DATABASE_SSL=true|false.
  ssl: wantsSsl(config.databaseUrl) ? { rejectUnauthorized: false } : undefined,
  connectionTimeoutMillis: 10000,
});

export type Queryable = Pick<pg.Pool, 'query'> | pg.PoolClient;

export async function withTransaction<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const out = await fn(client);
    await client.query('commit');
    return out;
  } catch (e) {
    await client.query('rollback');
    throw e;
  } finally {
    client.release();
  }
}
