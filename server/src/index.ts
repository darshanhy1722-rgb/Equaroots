import { createApp } from './app.js';
import { config } from './config.js';
import { pool } from './db.js';
import { runMigrations } from './migrate.js';
import { closeBrowser } from './services/pdf.js';

await runMigrations(pool);
const server = createApp().listen(config.port, () => {
  console.log(`EquaRoots dashboard listening on :${config.port} (${config.appBaseUrl})`);
});

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, async () => {
    server.close();
    await closeBrowser();
    await pool.end();
    process.exit(0);
  });
}
