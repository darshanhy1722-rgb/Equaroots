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
  const name = normalizeName(hint.name);
  if (email) {
    const byEmail = doctors.filter((d) => normalizeEmail(d.email) === email);
    if (byEmail.length === 1) return byEmail[0];
    // Shared mailbox (e.g. hello@equaroots.com hosts several doctors): the name decides.
    if (byEmail.length > 1) return (name && byEmail.find((d) => normalizeName(d.display_name) === name)) || null;
  }
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

export interface DoctorInput {
  display_name: string;
  role: string | null;
  reg_no: string | null;
  email: string;
}

/** Insert or update a doctor, matched on normalised name (emails can be shared). */
export async function upsertDoctorByName(db: Queryable, d: DoctorInput): Promise<'inserted' | 'updated'> {
  const upd = await db.query(
    `update doctors set display_name=$1, role=$2, reg_no=$3, email=$4
      where regexp_replace(lower(display_name), '[^a-z0-9]', '', 'g') = $5`,
    [d.display_name, d.role, d.reg_no, d.email.toLowerCase(), normalizeName(d.display_name)],
  );
  if (upd.rowCount) return 'updated';
  await db.query('insert into doctors(display_name, role, reg_no, email) values ($1,$2,$3,$4)', [
    d.display_name, d.role, d.reg_no, d.email.toLowerCase(),
  ]);
  return 'inserted';
}

const SIGNATURE_RE = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;
export const MAX_SIGNATURE_CHARS = 400_000;

export function validateSignature(v: unknown): string | null {
  if (v == null || v === '') return null;
  const s = String(v);
  if (s.length > MAX_SIGNATURE_CHARS) throw new Error('Signature image is too large (max ~300 KB).');
  if (!SIGNATURE_RE.test(s)) throw new Error('Signature must be a PNG, JPEG or WebP image.');
  return s;
}
