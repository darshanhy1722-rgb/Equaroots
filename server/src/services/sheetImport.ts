import { parse } from 'csv-parse/sync';
import type { Queryable } from '../db.js';
import { generatePrescriptionId, normalizeName } from '../lib/normalize.js';
import { listDoctors, matchDoctor, upsertDoctorByName } from './doctors.js';
import { assignPatientIdsAndFlags } from './patientIds.js';

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
  bookings: { inserted: number; updated: number; skipped: string[]; assigned?: number };
  consultations: { inserted: number; updated: number; skipped: string[] };
}

type Row = Record<string, string>;
const key = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

function rows(csv: string | undefined): Row[] {
  if (!csv?.trim()) return [];
  // Duplicate headers that differ only by case/punctuation (the Booking Data tab has both Cal's
  // "status" and a manual "Status" column) are kept apart as "status", "status 2", ...
  const columns = (header: string[]) => {
    const seen = new Map<string, number>();
    return header.map((h) => {
      const n = (seen.get(key(h)) ?? 0) + 1;
      seen.set(key(h), n);
      return n === 1 ? h : `${h} ${n}`;
    });
  };
  const recs = parse(csv, { columns, skip_empty_lines: true, bom: true, relax_column_count: true, trim: true }) as Row[];
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

/** Lower-cased string fields of Cal's "responses" JSON column ({ value } objects unwrapped). */
function responsesJson(v: string | null): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  if (!v) return out;
  try {
    let o = JSON.parse(v);
    // The Cal.id export wraps answers as {"data": {...}}.
    if (o && typeof o === 'object' && o.data && typeof o.data === 'object' && !Array.isArray(o.data)) o = { ...o.data };
    for (const [k, raw] of Object.entries(o ?? {})) {
      const val = raw && typeof raw === 'object' && 'value' in (raw as any) ? (raw as any).value : raw;
      if (typeof val === 'string' || typeof val === 'number') out[k.toLowerCase()] = String(val).trim() || null;
    }
  } catch {
    /* not JSON — ignore */
  }
  return out;
}

/** Export statuses (Past/Upcoming/Cancelled/Unconfirmed) and Cal's own (ACCEPTED/CANCELLED/...). */
function normaliseStatus(v: string | null): string | null {
  if (!v) return null;
  const u = v.trim().toUpperCase();
  if (/^(CANCELL?ED|REJECTED)$/.test(u)) return 'CANCELLED';
  if (/^(PAST|UPCOMING|ACCEPTED|CONFIRMED)$/.test(u)) return 'ACCEPTED';
  if (/^(UNCONFIRMED|PENDING|AWAITING_HOST)$/.test(u)) return 'PENDING';
  return u;
}

/** UTC offset the Cal.id export's local times are in (India by default). */
const EXPORT_UTC_OFFSET = process.env.CAL_EXPORT_UTC_OFFSET ?? '+05:30';

const MONTHS = ['january','february','march','april','may','june','july','august','september','october','november','december'];

/**
 * "15 July 2026" / "Tue, 6 Oct" + "5:00pm to 5:30pm" → ISO start/end in EXPORT_UTC_OFFSET.
 * Upcoming rows in the Cal.id export omit the year; it's taken as the nearest such date
 * (this year, or next year if that would be more than 60 days ago).
 */
export function calExportTimes(day: string | null, interval: string, now = new Date()): { start: string; end: string | null } | null {
  const d = /^(?:[a-z]{3,9},?\s+)?(\d{1,2})\s+([a-z]+)(?:,?\s+(\d{4}))?$/i.exec((day ?? '').trim());
  if (!d) return null;
  const month = MONTHS.findIndex((m) => m.startsWith(d[2].toLowerCase().slice(0, 3)));
  if (month < 0) return null;
  if (!d[3]) {
    let y = now.getUTCFullYear();
    if (Date.UTC(y, month, Number(d[1])) < now.getTime() - 60 * 864e5) y += 1;
    d[3] = String(y);
  }
  const toIso = (t: string | undefined, plusDay = 0): string | null => {
    const m = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i.exec((t ?? '').trim());
    if (!m) return null;
    let h = Number(m[1]) % 12;
    if ((m[3] ?? '').toLowerCase() === 'pm') h += 12;
    if (!m[3] && Number(m[1]) === 12) h = 12;
    const base = new Date(Date.UTC(Number(d[3]), month, Number(d[1]) + plusDay));
    const ymd = base.toISOString().slice(0, 10);
    return new Date(`${ymd}T${String(h).padStart(2, '0')}:${m[2] ?? '00'}:00${EXPORT_UTC_OFFSET}`).toISOString();
  };
  const [a, b] = interval.split(/\s+to\s+|\s*[-–]\s*/i);
  const start = toIso(a);
  if (!start) return null;
  let end = toIso(b);
  if (end && end < start) end = toIso(b, 1); // runs past midnight
  return { start, end };
}

const cleanDescription = (v: string | null) => (v && !/^(na|n\/a|none|-)$/i.test(v.trim()) ? v : null);

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
    const sig = get(r, 'signature url', 'signature');
    const how = await upsertDoctorByName(db, {
      display_name: name,
      role: get(r, 'role', 'qualification', 'degree'),
      reg_no: get(r, 'reg no', 'registration', 'reg'),
      email,
    });
    if (sig) await db.query('update doctors set signature_url=$1 where regexp_replace(lower(display_name),\'[^a-z0-9]\',\'\',\'g\')=$2', [sig, normalizeName(name)]);
    how === 'inserted' ? s.doctors.inserted++ : s.doctors.updated++;
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
    // Cal's raw "responses" JSON (name/email/phone/age/gender) backs up the hand-filled columns.
    const rawResponses = get(r, 'responses');
    if (rawResponses?.trimStart().startsWith('[')) {
      // Seated/group events (webinars, fireside chats) carry an array of attendees, not one patient.
      let n = 0;
      try {
        n = JSON.parse(rawResponses).length;
      } catch {
        /* ignore */
      }
      s.bookings.skipped.push(`row ${i + 2}: group event with ${n || 'several'} attendees — not a 1:1 consultation, skipped`);
      continue;
    }
    const resp = responsesJson(rawResponses);
    const name = get(r, 'patient name', 'name', 'attendee name', 'patient') ?? resp.name;
    if (!name) {
      s.bookings.skipped.push(`row ${i + 2}: missing patient name`);
      continue;
    }
    const calUid = get(r, 'booking uid', 'uid', 'cal uid', 'booking id', 'bookingid', 'id');
    const host = get(r, 'host');
    const doctorName = get(r, 'dr name', 'doctor', 'doctor name', 'dr', 'organizer', 'organizer name') ?? host;
    const doctorEmail = get(r, 'dr email', 'doctor email', 'organizer email', 'host email');
    const doctor = matchDoctor(doctors, { email: doctorEmail, name: doctorName });
    if (host && !doctor) {
      // Cal.id export rows hosted by non-doctors (e.g. Cal.id onboarding calls) aren't patients.
      s.bookings.skipped.push(`row ${i + 2}: host "${host}" isn't in the doctors list — skipped (add the doctor and re-import to include)`);
      continue;
    }
    // Cal.id's bookings export has "Date" (15 July 2026) + "Interval" (5:00pm to 5:30pm) in local time.
    const interval = get(r, 'interval');
    const exportTimes = interval ? calExportTimes(get(r, 'date'), interval) : null;
    const start = interval
      ? exportTimes?.start ?? null
      : date(get(r, 'start time', 'starttime', 'start', 'date', 'booking date', 'appointment'));
    const end = interval ? exportTimes?.end ?? null : date(get(r, 'end time', 'endtime', 'end'));
    if (interval && !start) s.bookings.skipped.push(`row ${i + 2}: couldn't read date "${get(r, 'date') ?? ''} ${interval}" — imported without a date`);
    // "status" is Cal's ACCEPTED/CANCELLED (or the export's Past/Upcoming/Cancelled);
    // a second "Status" column in the Sheet records "Prescription Sent".
    const calStatus = normaliseStatus(get(r, 'status'));
    const sheetStatus = get(r, 'status 2');
    const status = calStatus === 'CANCELLED' ? 'CANCELLED' : sheetStatus || calStatus || 'ACCEPTED';
    const attendeeEmail = get(r, 'attendees')?.split(/[;,]/)[0]?.trim() || null;
    const vals = [
      calUid, get(r, 'patient id', 'patientid', 'pat id'), get(r, 'patient type', 'type', 'new/existing'), name,
      get(r, 'age') ?? resp.age, get(r, 'gender', 'sex') ?? resp.gender,
      get(r, 'patient email', 'patient emial', 'email', 'attendee email') ?? resp.email ?? attendeeEmail,
      get(r, 'patient ph no', 'patient phone', 'phone', 'phone number', 'ph no', 'mobile') ?? resp.attendeephonenumber ?? resp.phone,
      doctor?.id ?? null, doctorName, doctorEmail,
      start, end, get(r, 'meet link', 'video link', 'meeting link', 'meet'),
      cleanDescription(get(r, 'description', 'notes') ?? resp.notes), status,
      get(r, 'drive link', 'pdf url', 'pdf link', 'prescription link'),
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
      // Merge: a later file fills gaps (e.g. the Cal.id export adds dates to Sheet rows) but never
      // wipes what's already there, and never downgrades "Prescription Sent" except to CANCELLED.
      await db.query(
        `update bookings set cal_uid=$1, patient_id=coalesce($2, patient_id), patient_type=coalesce($3, patient_type),
           patient_name=$4, age=coalesce($5, age), gender=coalesce($6, gender), patient_email=coalesce($7, patient_email),
           patient_phone=coalesce($8, patient_phone), doctor_id=coalesce($9, doctor_id), doctor_name_raw=coalesce($10, doctor_name_raw),
           doctor_email_raw=coalesce($11, doctor_email_raw), start_time=coalesce($12, start_time), end_time=coalesce($13, end_time),
           meet_link=coalesce($14, meet_link), description=coalesce($15, description),
           status=case when $16 = 'CANCELLED' then 'CANCELLED' when status = 'Prescription Sent' then status else $16 end,
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

  // Bookings that arrived without a patient ID (new rows from a Cal.id export) get one, exactly as a
  // webhook would: existing IDs are never changed, new ones continue the ER/<yy>/<nn> sequence.
  if (csv.bookings?.trim()) s.bookings.assigned = (await assignPatientIdsAndFlags(db)).length;

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
    `Bookings:      ${s.bookings.inserted} inserted, ${s.bookings.updated} updated, ${s.bookings.skipped.length} notes` +
      (s.bookings.assigned ? `, ${s.bookings.assigned} given new patient IDs` : ''),
    `Consultations: ${s.consultations.inserted} inserted, ${s.consultations.updated} updated, ${s.consultations.skipped.length} skipped`,
  ];
  for (const [k, v] of Object.entries(s)) for (const msg of v.skipped) lines.push(`  [${k}] ${msg}`);
  return lines.join('\n');
}
