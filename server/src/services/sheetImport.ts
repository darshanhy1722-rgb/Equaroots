import { parse } from 'csv-parse/sync';
import type { Queryable } from '../db.js';
import { generatePrescriptionId, normalizeName } from '../lib/normalize.js';
import { listDoctors, matchDoctor } from './doctors.js';

/**
 * Imports the old Google Sheet tabs (exported as CSV). Header names are matched
 * loosely (case/spacing/punctuation-insensitive, with aliases) because the
 * sheet's column titles drifted over time. Existing patient_id/patient_type
 * values are preserved verbatim — assignment logic is NOT re-run on history.
 */

export interface SheetCsvs {
  doctors?: string;
  medicines?: string;
  bookings?: string;
  consultations?: string;
}

export interface ImportSummary {
  doctors: { inserted: number; updated: number; skipped: string[] };
  medicines: { inserted: number; skipped: string[] };
  bookings: { inserted: number; updated: number; skipped: string[] };
  consultations: { inserted: number; updated: number; skipped: string[] };
}

type Row = Record<string, string>;
const key = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

function rows(csv: string | undefined): Row[] {
  if (!csv?.trim()) return [];
  const recs = parse(csv, { columns: true, skip_empty_lines: true, bom: true, relax_column_count: true, trim: true }) as Row[];
  return recs.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [key(k), String(v ?? '').trim()])));
}

function get(r: Row, ...aliases: string[]): string | null {
  for (const a of aliases) {
    const v = r[key(a)];
    if (v) return v;
  }
  return null;
}

function date(v: string | null): string | null {
  if (!v) return null;
  const d = new Date(v);
  if (!Number.isNaN(d.getTime())) return d.toISOString();
  // dd/mm/yyyy[ hh:mm[:ss]]
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(v);
  if (m) {
    const [, dd, mm, yyyy, h = '0', mi = '0', s = '0'] = m;
    return new Date(Date.UTC(+yyyy, +mm - 1, +dd, +h, +mi, +s)).toISOString();
  }
  return null;
}

function json(v: string | null): unknown {
  if (!v) return [];
  try {
    return JSON.parse(v);
  } catch {
    return [];
  }
}

export async function importSheetData(db: Queryable, csv: SheetCsvs): Promise<ImportSummary> {
  const s: ImportSummary = {
    doctors: { inserted: 0, updated: 0, skipped: [] },
    medicines: { inserted: 0, skipped: [] },
    bookings: { inserted: 0, updated: 0, skipped: [] },
    consultations: { inserted: 0, updated: 0, skipped: [] },
  };

  // 1. Doctors (first, so FKs resolve)
  for (const [i, r] of rows(csv.doctors).entries()) {
    const email = get(r, 'email', 'doctor email', 'login email')?.toLowerCase();
    const name = get(r, 'display name', 'name', 'doctor', 'doctor name');
    if (!email || !name) {
      s.doctors.skipped.push(`row ${i + 2}: missing ${!email ? 'email' : 'name'}`);
      continue;
    }
    const res = await db.query<{ inserted: boolean }>(
      `insert into doctors(display_name, role, reg_no, signature_url, email) values ($1,$2,$3,$4,$5)
       on conflict (email) do update set display_name=excluded.display_name, role=excluded.role,
         reg_no=excluded.reg_no, signature_url=coalesce(excluded.signature_url, doctors.signature_url)
       returning (xmax = 0) as inserted`,
      [name, get(r, 'role', 'qualification', 'degree'), get(r, 'reg no', 'registration', 'reg'), get(r, 'signature url', 'signature'), email],
    );
    res.rows[0].inserted ? s.doctors.inserted++ : s.doctors.updated++;
  }

  // 2. Medicines
  const { rows: existingMeds } = await db.query<{ name: string }>('select name from medicines');
  const medNames = new Set(existingMeds.map((m) => key(m.name)));
  for (const [i, r] of rows(csv.medicines).entries()) {
    const name = get(r, 'name', 'medicine', 'medicine name', 'drug');
    if (!name) {
      s.medicines.skipped.push(`row ${i + 2}: missing name`);
      continue;
    }
    if (medNames.has(key(name))) {
      s.medicines.skipped.push(`row ${i + 2}: duplicate "${name}"`);
      continue;
    }
    await db.query('insert into medicines(name, notes) values ($1,$2)', [name, get(r, 'notes', 'note', 'description')]);
    medNames.add(key(name));
    s.medicines.inserted++;
  }

  const doctors = await listDoctors(db);

  // 3. Bookings — keep patient_id/patient_type exactly as the old system assigned them.
  for (const [i, r] of rows(csv.bookings).entries()) {
    const name = get(r, 'name', 'patient name', 'attendee name', 'patient');
    if (!name) {
      s.bookings.skipped.push(`row ${i + 2}: missing patient name`);
      continue;
    }
    const calUid = get(r, 'booking uid', 'uid', 'cal uid', 'booking id', 'bookingid');
    const doctorName = get(r, 'doctor', 'doctor name', 'organizer', 'organizer name', 'host');
    const doctorEmail = get(r, 'doctor email', 'organizer email', 'host email');
    const doctor = matchDoctor(doctors, { email: doctorEmail, name: doctorName });
    const start = date(get(r, 'start time', 'start', 'date', 'booking date', 'appointment'));
    const vals = [
      calUid, get(r, 'patient id', 'patientid', 'pat id'), get(r, 'patient type', 'type', 'new/existing'), name,
      get(r, 'age'), get(r, 'gender', 'sex'), get(r, 'email', 'patient email', 'attendee email'),
      get(r, 'phone', 'patient phone', 'phone number', 'mobile'), doctor?.id ?? null, doctorName, doctorEmail,
      start, date(get(r, 'end time', 'end')), get(r, 'meet link', 'video link', 'meeting link', 'meet'),
      get(r, 'description', 'notes'), get(r, 'status') ?? 'ACCEPTED', get(r, 'drive link', 'pdf url', 'pdf link', 'prescription link'),
    ];
    let existing: number | null = null;
    if (calUid) {
      existing = (await db.query<{ id: number }>('select id from bookings where cal_uid=$1', [calUid])).rows[0]?.id ?? null;
    } else {
      existing = (
        await db.query<{ id: number }>(
          'select id from bookings where cal_uid is null and lower(patient_name)=lower($1) and start_time is not distinct from $2',
          [name, start],
        )
      ).rows[0]?.id ?? null;
    }
    if (existing) {
      await db.query(
        `update bookings set cal_uid=$1, patient_id=coalesce($2, patient_id), patient_type=coalesce($3, patient_type),
           patient_name=$4, age=$5, gender=$6, patient_email=$7, patient_phone=$8, doctor_id=$9, doctor_name_raw=$10,
           doctor_email_raw=$11, start_time=$12, end_time=$13, meet_link=$14, description=$15, status=$16,
           pdf_url=coalesce($17, pdf_url), updated_at=now() where id=$18`,
        [...vals, existing],
      );
      s.bookings.updated++;
    } else {
      await db.query(
        `insert into bookings(cal_uid, patient_id, patient_type, patient_name, age, gender, patient_email, patient_phone,
           doctor_id, doctor_name_raw, doctor_email_raw, start_time, end_time, meet_link, description, status, pdf_url)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
        vals,
      );
      s.bookings.inserted++;
    }
    if (!doctor) s.bookings.skipped.push(`row ${i + 2}: imported, but no doctor match for "${doctorName ?? ''}"`);
  }

  // 4. Consultations — link by booking uid/id, else patient name + same calendar day.
  for (const [i, r] of rows(csv.consultations).entries()) {
    const rx = get(r, 'prescription id', 'rx id', 'prescriptionid', 'rx');
    const pname = get(r, 'patient name', 'name', 'patient');
    const calUid = get(r, 'booking uid', 'booking id', 'cal uid', 'uid');
    const when = date(get(r, 'created at', 'date', 'approved at', 'timestamp'));
    let bookingId: number | null = null;
    if (calUid) {
      bookingId = (await db.query<{ id: number }>('select id from bookings where cal_uid=$1', [calUid])).rows[0]?.id ?? null;
    }
    if (!bookingId && pname) {
      bookingId = (
        await db.query<{ id: number }>(
          `select id from bookings where regexp_replace(lower(patient_name),'[^a-z0-9]','','g')=$1
             order by case when $2::timestamptz is not null and start_time::date = $2::timestamptz::date then 0 else 1 end,
                      abs(extract(epoch from (coalesce(start_time, now()) - coalesce($2::timestamptz, now()))))
             limit 1`,
          [normalizeName(pname), when],
        )
      ).rows[0]?.id ?? null;
    }
    if (!bookingId) {
      s.consultations.skipped.push(`row ${i + 2}: no matching booking for "${pname ?? ''}" ${calUid ?? ''}`);
      continue;
    }
    const doctor = matchDoctor(doctors, { email: get(r, 'doctor email'), name: get(r, 'doctor', 'doctor name') });
    const b = (await db.query<{ doctor_id: number | null; patient_id: string | null }>(
      'select doctor_id, patient_id from bookings where id=$1', [bookingId])).rows[0];
    const status = /sent|approved/i.test(get(r, 'status') ?? '') ? 'Sent' : 'Draft';
    const vals = [
      bookingId, rx ?? generatePrescriptionId(), pname, get(r, 'age'), get(r, 'gender'), get(r, 'email'), get(r, 'phone'),
      get(r, 'patient uid', 'patient id') ?? b.patient_id, doctor?.id ?? b.doctor_id, get(r, 'impression', 'diagnosis'),
      get(r, 'advice'), JSON.stringify(json(get(r, 'medicines json', 'medicines'))), status,
      get(r, 'pdf url', 'drive link', 'pdf link'), date(get(r, 'approved at')), when ?? new Date().toISOString(),
    ];
    const res = await db.query<{ inserted: boolean }>(
      `insert into consultations(booking_id, prescription_id, patient_name, age, gender, email, phone, patient_uid, doctor_id,
         impression, advice, medicines_json, status, pdf_url, approved_at, created_at, updated_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$16)
       on conflict (prescription_id) do update set booking_id=excluded.booking_id, impression=excluded.impression,
         advice=excluded.advice, medicines_json=excluded.medicines_json, status=excluded.status, pdf_url=excluded.pdf_url,
         approved_at=excluded.approved_at
       returning (xmax = 0) as inserted`,
      vals,
    );
    res.rows[0].inserted ? s.consultations.inserted++ : s.consultations.updated++;
  }

  return s;
}

export function formatSummary(s: ImportSummary): string {
  const lines = [
    `Doctors:       ${s.doctors.inserted} inserted, ${s.doctors.updated} updated, ${s.doctors.skipped.length} skipped`,
    `Medicines:     ${s.medicines.inserted} inserted, ${s.medicines.skipped.length} skipped`,
    `Bookings:      ${s.bookings.inserted} inserted, ${s.bookings.updated} updated, ${s.bookings.skipped.length} notes`,
    `Consultations: ${s.consultations.inserted} inserted, ${s.consultations.updated} updated, ${s.consultations.skipped.length} skipped`,
  ];
  for (const [k, v] of Object.entries(s)) for (const msg of v.skipped) lines.push(`  [${k}] ${msg}`);
  return lines.join('\n');
}
