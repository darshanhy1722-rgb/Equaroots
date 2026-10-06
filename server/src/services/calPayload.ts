/**
 * Maps a Cal.id / Cal.com webhook payload onto booking columns.
 * Cal's shapes vary: attendees[] is [{name,email,timeZone,...}], organizer is
 * an object, and form answers live in payload.responses (sometimes nested
 * under responses.data), each either a raw value or { label, value }.
 */

type Json = Record<string, any>;

export interface MappedBooking {
  cal_uid: string | null;
  reschedule_from_uid: string | null;
  /** Cal's numeric booking ids — rows imported from a Cal.id export are keyed by these. */
  booking_ids: string[];
  patient_name: string;
  patient_email: string | null;
  patient_phone: string | null;
  age: string | null;
  gender: string | null;
  doctor_name_raw: string | null;
  doctor_email_raw: string | null;
  start_time: string | null;
  end_time: string | null;
  meet_link: string | null;
  description: string | null;
  status: string;
}

function unwrap(v: any): any {
  if (v && typeof v === 'object' && !Array.isArray(v) && 'value' in v) return unwrap(v.value);
  return v;
}

function str(v: any): string | null {
  v = unwrap(v);
  if (v == null) return null;
  if (typeof v === 'object') {
    // phone fields sometimes arrive as { value: '+91...' } or { phone: ... }
    const inner = v.phone ?? v.number ?? v.name ?? null;
    return inner == null ? null : str(inner);
  }
  const s = String(v).trim();
  return s ? s : null;
}

function responsesOf(p: Json): Json {
  const r = p.responses ?? {};
  const data = r && typeof r === 'object' && r.data && typeof r.data === 'object' ? r.data : {};
  return { ...data, ...r, ...(p.userFieldsResponses ?? {}) };
}

function pick(obj: Json, keys: string[]): string | null {
  const lower = new Map(Object.keys(obj).map((k) => [k.toLowerCase(), k]));
  for (const k of keys) {
    const real = lower.get(k.toLowerCase());
    if (real != null) {
      const v = str(obj[real]);
      if (v) return v;
    }
  }
  return null;
}

export function mapCalPayload(body: Json): MappedBooking {
  const p: Json = body?.payload ?? {};
  const att: Json = Array.isArray(p.attendees) && p.attendees.length ? p.attendees[0] : {};
  const org: Json = p.organizer ?? {};
  const resp = responsesOf(p);

  const phone =
    pick(resp, ['attendeePhoneNumber', 'phone', 'phoneNumber', 'phone_number', 'mobile', 'mobileNumber', 'whatsapp', 'contact']) ??
    str(att.phoneNumber) ??
    str(p.smsReminderNumber);

  const status = String(p.status ?? '').toUpperCase() || 'ACCEPTED';

  return {
    cal_uid: str(p.uid) ?? str(p.bookingUid) ?? (p.bookingId != null ? String(p.bookingId) : null),
    reschedule_from_uid: str(p.rescheduleUid) ?? str(p.fromReschedule) ?? str(p.rescheduledFromUid),
    booking_ids: [p.bookingId, p.id, p.rescheduleId, p.fromRescheduleId]
      .filter((x) => x != null && /^\d+$/.test(String(x)))
      .map(String),
    patient_name: str(att.name) ?? pick(resp, ['name', 'fullName']) ?? 'Unknown patient',
    patient_email: str(att.email) ?? pick(resp, ['email']),
    patient_phone: phone,
    age: pick(resp, ['age', 'patientAge', 'patient_age']),
    gender: pick(resp, ['gender', 'sex', 'patientGender']),
    doctor_name_raw: str(org.name),
    doctor_email_raw: str(org.email),
    start_time: str(p.startTime),
    end_time: str(p.endTime),
    meet_link: str(p.metadata?.videoCallUrl) ?? str(p.videoCallData?.url) ?? (/^https?:/.test(String(p.location ?? '')) ? String(p.location) : null),
    description: str(p.description) ?? pick(resp, ['notes', 'additionalNotes', 'reason']) ?? str(p.additionalNotes),
    status,
  };
}
