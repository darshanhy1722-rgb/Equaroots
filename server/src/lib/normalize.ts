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

export function formatPatientId(n: number): string {
  return `PAT-${String(n).padStart(3, '0')}`;
}

export function parsePatientIdNumber(id: string | null | undefined): number {
  const m = /^PAT-(\d+)$/i.exec(String(id ?? '').trim());
  return m ? Number(m[1]) : 0;
}

/** "RX-" + 10 random digits, e.g. RX-1786422062. */
export function generatePrescriptionId(rand: () => number = Math.random): string {
  let s = String(1 + Math.floor(rand() * 9)); // no leading zero
  for (let i = 0; i < 9; i++) s += String(Math.floor(rand() * 10));
  return `RX-${s}`;
}
