import type { Queryable } from '../db.js';
import { formatPatientId, normalizeEmail, normalizePhone, parsePatientId, patientIdYear } from '../lib/normalize.js';

export interface AssignableBooking {
  id: number;
  patient_id: string | null;
  patient_email: string | null;
  patient_phone: string | null;
  status: string;
  start_time: Date | string | null;
  created_at: Date | string;
  patient_name?: string | null;
}

/** A patient already in the clinic's register (the master list of ER IDs). */
export interface KnownPatient {
  patient_id: string;
  email: string | null;
}

export interface Assignment {
  id: number;
  patient_id: string;
  patient_type: 'New' | 'Existing';
}

function ts(v: Date | string | null): number {
  if (!v) return Number.POSITIVE_INFINITY;
  const t = new Date(v).getTime();
  return Number.isNaN(t) ? Number.POSITIVE_INFINITY : t;
}

/**
 * Pure core of assignPatientIdsAndFlags(): given every booking, decide IDs for
 * ACCEPTED bookings that don't have one yet. Bookings that already carry a
 * patient_id are never touched (idempotent). Processing is oldest-first so a
 * returning patient's earlier booking always claims the ID.
 */
export function computePatientAssignments(
  all: AssignableBooking[],
  known: KnownPatient[] = [],
  now: Date = new Date(),
): Assignment[] {
  const byPhone = new Map<string, string>();
  const byEmail = new Map<string, string>();
  const year = patientIdYear(now);
  let maxN = 0;
  const seeId = (id: string) => {
    const p = parsePatientId(id);
    if (p && p.year === year) maxN = Math.max(maxN, p.n);
  };

  // The register first: a returning patient keeps their clinic ID even if this is their first booking here.
  for (const k of known) {
    seeId(k.patient_id);
    const e = normalizeEmail(k.email);
    if (e && !byEmail.has(e)) byEmail.set(e, k.patient_id);
  }
  for (const b of all) {
    if (!b.patient_id) continue;
    seeId(b.patient_id);
    const p = normalizePhone(b.patient_phone);
    const e = normalizeEmail(b.patient_email);
    if (p && !byPhone.has(p)) byPhone.set(p, b.patient_id);
    if (e && !byEmail.has(e)) byEmail.set(e, b.patient_id);
  }

  const pending = all
    .filter((b) => !b.patient_id && b.status === 'ACCEPTED')
    .sort((a, b) => ts(a.start_time) - ts(b.start_time) || ts(a.created_at) - ts(b.created_at) || a.id - b.id);

  const out: Assignment[] = [];
  for (const b of pending) {
    const p = normalizePhone(b.patient_phone);
    const e = normalizeEmail(b.patient_email);
    const existing = (p && byPhone.get(p)) || (e && byEmail.get(e)) || null;
    let patientId: string;
    let type: 'New' | 'Existing';
    if (existing) {
      patientId = existing;
      type = 'Existing';
    } else {
      patientId = formatPatientId(++maxN, year);
      type = 'New';
    }
    if (p && !byPhone.has(p)) byPhone.set(p, patientId);
    if (e && !byEmail.has(e)) byEmail.set(e, patientId);
    out.push({ id: b.id, patient_id: patientId, patient_type: type });
  }
  return out;
}

/**
 * DB wrapper. Serialised with an advisory lock so concurrent webhooks can't mint duplicate IDs.
 * New IDs are also added to the patient register so they stay reserved.
 */
export async function assignPatientIdsAndFlags(db: Queryable): Promise<Assignment[]> {
  await db.query('select pg_advisory_xact_lock(4242001)');
  const { rows } = await db.query<AssignableBooking>(
    'select id, patient_id, patient_email, patient_phone, patient_name, status, start_time, created_at from bookings',
  );
  const known = (await db.query<KnownPatient>('select patient_id, email from patients')).rows;
  const assignments = computePatientAssignments(rows, known);
  const byId = new Map(rows.map((r) => [r.id, r]));
  for (const a of assignments) {
    await db.query('update bookings set patient_id=$2, patient_type=$3, updated_at=now() where id=$1', [
      a.id,
      a.patient_id,
      a.patient_type,
    ]);
    if (a.patient_type === 'New') {
      const b = byId.get(a.id);
      await db.query(
        `insert into patients(patient_id, name, email, source) values ($1,$2,$3,'auto') on conflict (patient_id) do nothing`,
        [a.patient_id, b?.patient_name ?? null, normalizeEmail(b?.patient_email) || null],
      );
    }
  }
  return assignments;
}
