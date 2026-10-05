import { createApp } from './app.js';
import { config } from './config.js';
import { pool } from './db.js';
import { runMigrations } from './migrate.js';
import { closeBrowser } from './services/pdf.js';

// Listen first so the platform healthcheck can reach us, then migrate.
// A missing/unreachable database is logged loudly instead of crash-looping.
const server = createApp().listen(config.port, '0.0.0.0', () => {
  console.log(`EquaRoots dashboard listening on 0.0.0.0:${config.port} (${config.appBaseUrl})`);
});

if (!process.env.DATABASE_URL) {
  console.error('[startup] DATABASE_URL is not set — link the Postgres service (e.g. DATABASE_URL=${{Postgres.DATABASE_URL}} on Railway).');
}

(async () => {
  for (let attempt = 1; attempt <= 10; attempt++) {
    try {
      await runMigrations(pool);
      console.log('[startup] database ready');
      return;
    } catch (e: any) {
      const host = (() => {
        try {
          return new URL(config.databaseUrl).host;
        } catch {
          return '(unparseable DATABASE_URL)';
        }
      })();
      console.error(`[startup] migration attempt ${attempt}/10 failed (db host ${host}): ${e?.message ?? e}`);
      await new Promise((r) => setTimeout(r, Math.min(30000, 2000 * attempt)));
    }
  }
  console.error('[startup] giving up on database — API calls will fail until DATABASE_URL is fixed and the service redeployed.');
})();

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, async () => {
    server.close();
    await closeBrowser();
    await pool.end();
    process.exit(0);
  });
}
