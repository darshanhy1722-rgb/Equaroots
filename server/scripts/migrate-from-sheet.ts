/**
 * One-time migration from the old Google Sheet.
 *
 * Export each tab as CSV (File → Download → CSV) into one folder named:
 *   Doctors.csv, Medicines.csv, "Booking Data.csv", Consultations.csv
 * then run:
 *   npm run migrate:sheet -- ./path/to/export-folder
 *
 * Existing patient IDs / New-Existing flags are preserved as-is.
 */
import fs from 'node:fs';
import path from 'node:path';
import { withTransaction, pool } from '../src/db.js';
import { runMigrations } from '../src/migrate.js';
import { formatSummary, importSheetData } from '../src/services/sheetImport.js';

const dir = process.argv[2];
if (!dir) {
  console.error('usage: npm run migrate:sheet -- <folder-with-csv-exports>');
  process.exit(1);
}

function read(...names: string[]): string | undefined {
  const files = fs.readdirSync(dir);
  for (const n of names) {
    const f = files.find((x) => x.toLowerCase().replace(/[^a-z]/g, '').includes(n));
    if (f) {
      console.log(`  using ${f} for ${n}`);
      return fs.readFileSync(path.join(dir, f), 'utf8');
    }
  }
  return undefined;
}

await runMigrations(pool);
const csv = {
  doctors: read('doctors'),
  medicines: read('medicines'),
  bookings: read('bookingdata', 'bookings'),
  consultations: read('consultations'),
};
const summary = await withTransaction((c) => importSheetData(c, csv));
console.log('\nMigration summary\n' + formatSummary(summary));
await pool.end();
