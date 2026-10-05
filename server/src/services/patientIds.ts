import type { Queryable } from '../db.js';
import { formatPatientId, normalizeEmail, normalizePhone, parsePatientIdNumber } from '../lib/normalize.js';

export interface AssignableBooking {
  id: number;
  patient_id: string | null;
  patient_email: string | null;
  patient_phone: string | null;
  status: string;
  start_time: Date | string | null;
  created_at: Date | string;
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
export function computePatientAssignments(all: AssignableBooking[]): Assignment[] {
  const byPhone = new Map<string, string>();
  const byEmail = new Map<string, string>();
  let maxN = 0;

  for (const b of all) {
    if (!b.patient_id) continue;
    maxN = Math.max(maxN, parsePatientIdNumber(b.patient_id));
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
      patientId = formatPatientId(++maxN);
      type = 'New';
    }
    if (p && !byPhone.has(p)) byPhone.set(p, patientId);
    if (e && !byEmail.has(e)) byEmail.set(e, patientId);
    out.push({ id: b.id, patient_id: patientId, patient_type: type });
  }
  return out;
}

/** DB wrapper. Serialised with an advisory lock so concurrent webhooks can't mint duplicate IDs. */
export async function assignPatientIdsAndFlags(db: Queryable): Promise<Assignment[]> {
  await db.query('select pg_advisory_xact_lock(4242001)');
  const { rows } = await db.query<AssignableBooking>(
    'select id, patient_id, patient_email, patient_phone, status, start_time, created_at from bookings',
  );
  const assignments = computePatientAssignments(rows);
  for (const a of assignments) {
    await db.query('update bookings set patient_id=$2, patient_type=$3, updated_at=now() where id=$1', [
      a.id,
      a.patient_id,
      a.patient_type,
    ]);
  }
  return assignments;
}
