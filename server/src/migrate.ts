import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Queryable } from './db.js';

const here = path.dirname(fileURLToPath(import.meta.url));

function migrationsDir(): string {
  // Works from src/ (tsx) and dist/src/ (compiled).
  for (const p of [path.resolve(here, '../migrations'), path.resolve(here, '../../migrations')]) {
    if (fs.existsSync(p)) return p;
  }
  throw new Error('migrations directory not found');
}

export async function runMigrations(db: Queryable, log = console.log): Promise<void> {
  await db.query(`create table if not exists schema_migrations (
    name text primary key, applied_at timestamptz not null default now())`);
  const dir = migrationsDir();
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  const { rows } = await db.query<{ name: string }>('select name from schema_migrations');
  const applied = new Set(rows.map((r) => r.name));
  for (const f of files) {
    if (applied.has(f)) continue;
    await db.query(fs.readFileSync(path.join(dir, f), 'utf8'));
    await db.query('insert into schema_migrations(name) values ($1)', [f]);
    log(`[migrate] applied ${f}`);
  }
}
