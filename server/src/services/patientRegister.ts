import { parse } from 'csv-parse/sync';
import type { Queryable } from '../db.js';
import { formatPatientId, normalizeEmail, normalizePatientId, parsePatientId, patientIdYear } from '../lib/normalize.js';
import { assignPatientIdsAndFlags } from './patientIds.js';

/**
 * Loads the clinic's patient register (Name, Email, Patient ID, Lead Doctor) — the master
 * list of ER/<yy>/<nn> IDs — and re-keys every booking to it:
 *  - a booking whose email is in the register takes that patient's ER ID;
 *  - other bookings sharing an old ID with such a booking (same person, matched earlier by
 *    phone) follow it;
 *  - remaining old IDs (PAT-…, or auto ER IDs that clash with the register) get fresh ER IDs
 *    after the register's highest number, oldest patient first.
 * New/Existing is then recomputed per patient, and prescriptions follow their booking.
 */

export interface RegisterRow {
  name: string | null;
  email: string | null;
  patientId: string | null;
  leadDoctor: string | null;
}

export interface RegisterSummary {
  registerRows: number;
  loaded: number;
  problems: string[];
  bookingsMatched: number;
  bookingsRenumbered: number;
  newIds: number;
  registerPatientsWithoutBookings: number;
  consultationsUpdated: number;
}

const k = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Accepts a table (first row = headers) from an uploaded .xlsx, or CSV text. */
export function registerRowsFromTable(table: string[][]): RegisterRow[] {
  const [head, ...body] = table;
  if (!head) return [];
  const idx = (...names: string[]) => head.findIndex((h) => names.includes(k(String(h ?? ''))));
  const ci = {
    name: idx('name', 'patientname'),
    email: idx('email', 'emailid', 'patientemail', 'mail'),
    id: idx('patientid', 'id', 'pid', 'erid'),
    doc: idx('leaddoctor', 'doctor', 'drname'),
  };
  if (ci.id < 0) throw new Error('No "Patient ID" column found in the register');
  const cell = (r: string[], i: number) => (i >= 0 ? String(r[i] ?? '').trim() || null : null);
  return body
    .filter((r) => r.some((c) => String(c ?? '').trim()))
    .map((r) => ({ name: cell(r, ci.name), email: cell(r, ci.email), patientId: cell(r, ci.id), leadDoctor: cell(r, ci.doc) }));
}

export function registerRowsFromCsv(csv: string): RegisterRow[] {
  return registerRowsFromTable(parse(csv, { bom: true, skip_empty_lines: true, relax_column_count: true }) as string[][]);
}

/** "Simran Nigam <simrenigam@gmail.com>" → "simrenigam@gmail.com". */
function cleanEmail(v: string | null): string | null {
  if (!v) return null;
  const m = /<([^>]+@[^>]+)>/.exec(v);
  const e = normalizeEmail(m ? m[1] : v);
  return /^[^@\s]+@[^@\s]+$/.test(e) ? e : null;
}

const t = (v: Date | string | null) => (v ? new Date(v).getTime() : Number.POSITIVE_INFINITY);

export async function importPatientRegister(db: Queryable, rows: RegisterRow[]): Promise<RegisterSummary> {
  await db.query('select pg_advisory_xact_lock(4242001)'); // same lock as ID assignment
  const s: RegisterSummary = {
    registerRows: rows.length, loaded: 0, problems: [], bookingsMatched: 0, bookingsRenumbered: 0,
    newIds: 0, registerPatientsWithoutBookings: 0, consultationsUpdated: 0,
  };

  // 1. The register itself.
  const idOwner = new Map<string, string | null>(); // ER id → email
  const emailToId = new Map<string, string>();
  for (const [i, r] of rows.entries()) {
    const line = `register row ${i + 2}`;
    const id = normalizePatientId(r.patientId);
    if (!id) {
      s.problems.push(`${line}: "${r.patientId ?? ''}" isn't an ER/yy/nn ID — skipped`);
      continue;
    }
    const email = cleanEmail(r.email);
    if (idOwner.has(id)) {
      const first = idOwner.get(id);
      if (first !== email) s.problems.push(`${line}: ${id} is also given to ${first ?? '(no email)'} — kept the first, ${r.name ?? email ?? '?'} needs a new ID`);
      continue;
    }
    if (email && emailToId.has(email)) {
      s.problems.push(`${line}: ${email} already has ${emailToId.get(email)} — ${id} kept in the register but bookings use ${emailToId.get(email)}`);
    } else if (email) emailToId.set(email, id);
    idOwner.set(id, email);
    await db.query(
      `insert into patients(patient_id, name, email, lead_doctor, source) values ($1,$2,$3,$4,'register')
       on conflict (patient_id) do update set name=excluded.name, email=excluded.email, lead_doctor=excluded.lead_doctor, source='register'`,
      [id, r.name, email, r.leadDoctor],
    );
    s.loaded++;
  }
  // Auto-made IDs that clash with the register are dropped; their bookings get renumbered below.
  await db.query(`delete from patients where source='auto' and patient_id = any($1::text[])`, [[...idOwner.keys()]]);

  // 2. Re-key bookings.
  const { rows: bookings } = await db.query<{
    id: number; patient_id: string | null; patient_email: string | null; patient_name: string; status: string;
    start_time: Date | null; created_at: Date;
  }>('select id, patient_id, patient_email, patient_name, status, start_time, created_at from bookings');
  const target = new Map<number, string>(); // booking id → new patient id
  for (const b of bookings) {
    const id = emailToId.get(normalizeEmail(b.patient_email));
    if (id) target.set(b.id, id);
  }
  // Old groups follow their matched member (earliest matched booking wins).
  const groups = new Map<string, typeof bookings>();
  for (const b of bookings) if (b.patient_id) groups.set(b.patient_id, [...(groups.get(b.patient_id) ?? []), b]);
  const byTime = (a: (typeof bookings)[0], b: (typeof bookings)[0]) => t(a.start_time) - t(b.start_time) || t(a.created_at) - t(b.created_at) || a.id - b.id;
  const unmatchedGroups: { oldId: string; members: typeof bookings }[] = [];
  for (const [oldId, members] of groups) {
    members.sort(byTime);
    const anchor = members.find((m) => target.has(m.id));
    if (anchor) {
      for (const m of members) if (!target.has(m.id)) target.set(m.id, target.get(anchor.id)!);
      continue;
    }
    // Keep an ER ID that's valid and not someone else's in the register; renumber everything else.
    const owner = idOwner.get(oldId);
    const keep = parsePatientId(oldId) && (owner === undefined || owner === normalizeEmail(members[0].patient_email));
    if (keep) for (const m of members) target.set(m.id, oldId);
    else unmatchedGroups.push({ oldId, members });
  }
  // Fresh IDs after the highest number used this year (register + kept IDs).
  const year = patientIdYear();
  let maxN = 0;
  for (const id of [...idOwner.keys(), ...target.values()]) {
    const p = parsePatientId(id);
    if (p && p.year === year) maxN = Math.max(maxN, p.n);
  }
  unmatchedGroups.sort((a, b) => byTime(a.members[0], b.members[0]));
  for (const g of unmatchedGroups) {
    const id = formatPatientId(++maxN, year);
    s.newIds++;
    for (const m of g.members) target.set(m.id, id);
    await db.query(`insert into patients(patient_id, name, email, source) values ($1,$2,$3,'auto') on conflict (patient_id) do nothing`, [
      id, g.members[0].patient_name, normalizeEmail(g.members[0].patient_email) || null,
    ]);
  }

  // 3. Write IDs and recompute New/Existing (first consultation of each patient is New).
  const seen = new Set<string>();
  for (const b of [...bookings].sort(byTime)) {
    const id = target.get(b.id);
    if (!id) continue;
    const type = seen.has(id) ? 'Existing' : 'New';
    if (b.status !== 'CANCELLED') seen.add(id);
    if (b.patient_id !== id) s.bookingsRenumbered++;
    if (emailToId.get(normalizeEmail(b.patient_email))) s.bookingsMatched++;
    await db.query('update bookings set patient_id=$2, patient_type=$3, updated_at=now() where id=$1', [b.id, id, type]);
  }
  const c = await db.query(
    `update consultations c set patient_uid = b.patient_id from bookings b
      where c.booking_id = b.id and b.patient_id is not null and c.patient_uid is distinct from b.patient_id`,
  );
  s.consultationsUpdated = c.rowCount ?? 0;
  const used = new Set(target.values());
  s.registerPatientsWithoutBookings = [...idOwner.keys()].filter((id) => !used.has(id)).length;

  // 4. Anything still without an ID (e.g. new bookings) now gets one, register-aware.
  s.newIds += (await assignPatientIdsAndFlags(db)).filter((a) => a.patient_type === 'New').length;
  return s;
}

export function formatRegisterSummary(s: RegisterSummary): string {
  return [
    `Register:  ${s.loaded} of ${s.registerRows} patients loaded`,
    `Bookings:  ${s.bookingsMatched} matched to the register by email, ${s.bookingsRenumbered} given a new patient ID`,
    `New IDs:   ${s.newIds} patients not in the register got the next ER number`,
    `Prescriptions re-linked: ${s.consultationsUpdated}`,
    `Register patients with no bookings yet: ${s.registerPatientsWithoutBookings} (they keep their ID when they book)`,
    ...s.problems.map((p) => `  ! ${p}`),
  ].join('\n');
}
