import type { Queryable } from '../db.js';
import { normalizeEmail, normalizeName } from '../lib/normalize.js';

export interface Doctor {
  id: number;
  display_name: string;
  role: string | null;
  reg_no: string | null;
  signature_url: string | null;
  email: string;
}

export async function listDoctors(db: Queryable): Promise<Doctor[]> {
  const { rows } = await db.query<Doctor>(
    'select id, display_name, role, reg_no, signature_url, email from doctors order by display_name',
  );
  return rows;
}

/**
 * resolveActingDoctor_: email match first, then a normalised-name match
 * (non-alphanumerics stripped, lowercased) so "Dr. Radha Dangaich" from Cal.id
 * resolves to "Dr Radha Dangaich" in the doctors table.
 */
export function matchDoctor(
  doctors: Doctor[],
  hint: { email?: string | null; name?: string | null; id?: number | null },
): Doctor | null {
  if (hint.id != null) {
    const byId = doctors.find((d) => d.id === hint.id);
    if (byId) return byId;
  }
  const email = normalizeEmail(hint.email);
  if (email) {
    const byEmail = doctors.find((d) => normalizeEmail(d.email) === email);
    if (byEmail) return byEmail;
  }
  const name = normalizeName(hint.name);
  if (name) {
    const byName = doctors.find((d) => normalizeName(d.display_name) === name);
    if (byName) return byName;
  }
  return null;
}

/** The treating doctor for a booking — never the signed-in admin. */
export async function resolveActingDoctor(
  db: Queryable,
  booking: { doctor_id: number | null; doctor_email_raw?: string | null; doctor_name_raw: string | null },
): Promise<Doctor | null> {
  const doctors = await listDoctors(db);
  return matchDoctor(doctors, {
    id: booking.doctor_id,
    email: booking.doctor_email_raw,
    name: booking.doctor_name_raw,
  });
}
