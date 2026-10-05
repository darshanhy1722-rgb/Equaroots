import { describe, expect, it } from 'vitest';
import { generatePrescriptionId, normalizeEmail, normalizeName, normalizePhone } from '../src/lib/normalize.js';
import { computePatientAssignments, type AssignableBooking } from '../src/services/patientIds.js';
import { matchDoctor, type Doctor } from '../src/services/doctors.js';
import { signBody, verifyCalSignature } from '../src/lib/signature.js';
import { mapCalPayload } from '../src/services/calPayload.js';

const b = (id: number, o: Partial<AssignableBooking>): AssignableBooking => ({
  id, patient_id: null, patient_email: null, patient_phone: null, status: 'ACCEPTED',
  start_time: `2026-01-${String(id).padStart(2, '0')}T10:00:00Z`, created_at: '2026-01-01T00:00:00Z', ...o,
});

describe('normalisation', () => {
  it('phones keep last 10 digits', () => {
    expect(normalizePhone('+91 98450-12345')).toBe('9845012345');
    expect(normalizePhone('098450 12345')).toBe('9845012345');
  });
  it('emails lowercased + trimmed', () => expect(normalizeEmail('  A.B@X.COM ')).toBe('a.b@x.com'));
  it('names strip punctuation', () => expect(normalizeName('Dr. Radha Dangaich')).toBe(normalizeName('Dr Radha Dangaich')));
  it('RX ids are RX- + 10 digits', () => {
    for (let i = 0; i < 50; i++) expect(generatePrescriptionId()).toMatch(/^RX-[1-9]\d{9}$/);
  });
});

describe('computePatientAssignments', () => {
  it('assigns oldest-first, reuses IDs by phone or email', () => {
    const out = computePatientAssignments([
      b(3, { patient_phone: '+91 98450 12345' }),
      b(1, { patient_phone: '9845012345', patient_email: 'a@x.com' }),
      b(2, { patient_email: 'b@x.com' }),
      b(4, { patient_email: ' A@X.com' }),
    ]);
    expect(out).toEqual([
      { id: 1, patient_id: 'PAT-001', patient_type: 'New' },
      { id: 2, patient_id: 'PAT-002', patient_type: 'New' },
      { id: 3, patient_id: 'PAT-001', patient_type: 'Existing' },
      { id: 4, patient_id: 'PAT-001', patient_type: 'Existing' },
    ]);
  });
  it('is idempotent and continues numbering after existing IDs', () => {
    const rows = [
      b(1, { patient_id: 'PAT-007', patient_email: 'old@x.com' }),
      b(2, { patient_email: 'old@x.com' }),
      b(3, { patient_email: 'new@x.com' }),
    ];
    const out = computePatientAssignments(rows);
    expect(out).toEqual([
      { id: 2, patient_id: 'PAT-007', patient_type: 'Existing' },
      { id: 3, patient_id: 'PAT-008', patient_type: 'New' },
    ]);
    const applied = rows.map((r) => ({ ...r, patient_id: out.find((o) => o.id === r.id)?.patient_id ?? r.patient_id }));
    expect(computePatientAssignments(applied)).toEqual([]);
  });
  it('skips non-ACCEPTED bookings', () => {
    expect(computePatientAssignments([b(1, { status: 'CANCELLED', patient_email: 'x@x.com' })])).toEqual([]);
  });
});

describe('matchDoctor (resolveActingDoctor_)', () => {
  const docs: Doctor[] = [
    { id: 1, display_name: 'Dr Radha Dangaich', role: null, reg_no: null, signature_url: null, email: 'radha@equaroots.com' },
    { id: 2, display_name: 'Dr Arjun Menon', role: null, reg_no: null, signature_url: null, email: 'arjun@equaroots.com' },
  ];
  it('matches by email first', () => expect(matchDoctor(docs, { email: 'ARJUN@equaroots.com', name: 'Dr Radha Dangaich' })?.id).toBe(2));
  it('falls back to normalised name ("Dr." vs "Dr")', () =>
    expect(matchDoctor(docs, { email: 'unknown@cal.id', name: 'Dr. Radha Dangaich' })?.id).toBe(1));
  it('shared email: name decides; ambiguous → null', () => {
    const shared: Doctor[] = [
      { ...docs[0], email: 'hello@equaroots.com' },
      { id: 3, display_name: 'Dr. Abhinav Pandey', role: null, reg_no: null, signature_url: null, email: 'hello@equaroots.com' },
    ];
    expect(matchDoctor(shared, { email: 'hello@equaroots.com', name: 'Dr Abhinav Pandey' })?.id).toBe(3);
    expect(matchDoctor(shared, { email: 'HELLO@equaroots.com', name: 'Dr. Radha Dangaich' })?.id).toBe(1);
    expect(matchDoctor(shared, { email: 'hello@equaroots.com', name: 'Someone Else' })).toBeNull();
  });
  it('returns null when nothing matches', () => expect(matchDoctor(docs, { name: 'Dr Nobody' })).toBeNull());
});

describe('Cal signature', () => {
  it('accepts a valid hex HMAC and rejects anything else', () => {
    const raw = Buffer.from('{"a":1}');
    const sig = signBody(raw, 's3cret');
    expect(verifyCalSignature(raw, sig, 's3cret')).toBe(true);
    expect(verifyCalSignature(raw, sig, 'other')).toBe(false);
    expect(verifyCalSignature(Buffer.from('{"a":2}'), sig, 's3cret')).toBe(false);
    expect(verifyCalSignature(raw, undefined, 's3cret')).toBe(false);
    expect(verifyCalSignature(raw, sig, '')).toBe(false);
  });
});

describe('mapCalPayload', () => {
  it('reads attendees[], organizer and nested responses.data', () => {
    const m = mapCalPayload({
      triggerEvent: 'BOOKING_CREATED',
      payload: {
        uid: 'u1', startTime: '2026-02-01T10:00:00Z', endTime: '2026-02-01T10:30:00Z',
        attendees: [{ name: 'Asha', email: 'asha@x.com', timeZone: 'Asia/Kolkata' }],
        organizer: { name: 'Dr. Radha Dangaich', email: 'radha@equaroots.com' },
        responses: { data: { attendeePhoneNumber: { label: 'Phone', value: '+91 90000 11111' }, age: { value: '30' }, gender: 'F' } },
        metadata: { videoCallUrl: 'https://meet.google.com/x' },
      },
    });
    expect(m).toMatchObject({
      cal_uid: 'u1', patient_name: 'Asha', patient_email: 'asha@x.com', patient_phone: '+91 90000 11111',
      age: '30', gender: 'F', doctor_name_raw: 'Dr. Radha Dangaich', meet_link: 'https://meet.google.com/x', status: 'ACCEPTED',
    });
  });
});
