/** Last 10 digits of a phone number ("+91 98450-12345" -> "9845012345"). */
export function normalizePhone(v: unknown): string {
  const digits = String(v ?? '').replace(/\D/g, '');
  return digits.length > 10 ? digits.slice(-10) : digits;
}

/** Lowercased, trimmed email. */
export function normalizeEmail(v: unknown): string {
  return String(v ?? '').trim().toLowerCase();
}

/**
 * Doctor-name key: strip every non-alphanumeric char and lowercase, so
 * "Dr. Radha Dangaich" and "Dr Radha Dangaich" compare equal.
 */
export function normalizeName(v: unknown): string {
  return String(v ?? '').replace(/[^a-z0-9]/gi, '').toLowerCase();
}

/** Two-digit year in India time, e.g. "26". */
export function patientIdYear(d: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', year: '2-digit' }).format(d);
}

/** Clinic patient IDs: ER/<yy>/<nn>, e.g. ER/26/07, ER/26/151. Numbering restarts each year. */
export function formatPatientId(n: number, year = patientIdYear()): string {
  return `ER/${year}/${String(n).padStart(2, '0')}`;
}

/** { year: "26", n: 7 } for "ER/26/07" (also tolerates "PID ER/26/07", "er / 26 / 7"). */
export function parsePatientId(id: string | null | undefined): { year: string; n: number } | null {
  const m = /^(?:PID\s*)?ER\s*\/\s*(\d{2})\s*\/\s*(\d+)$/i.exec(String(id ?? '').trim());
  return m ? { year: m[1], n: Number(m[2]) } : null;
}

/** Canonical form of a register ID ("PID ER/26/146" → "ER/26/146"), or null if it isn't one. */
export function normalizePatientId(id: string | null | undefined): string | null {
  const p = parsePatientId(id);
  return p ? formatPatientId(p.n, p.year) : null;
}

/** "RX-" + 10 random digits, e.g. RX-1786422062. */
export function generatePrescriptionId(rand: () => number = Math.random): string {
  let s = String(1 + Math.floor(rand() * 9)); // no leading zero
  for (let i = 0; i < 9; i++) s += String(Math.floor(rand() * 10));
  return `RX-${s}`;
}
