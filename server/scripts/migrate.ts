import { pool } from '../src/db.js';
import { runMigrations } from '../src/migrate.js';

await runMigrations(pool);
console.log('[migrate] up to date');
await pool.end();
