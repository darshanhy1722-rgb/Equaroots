import { describe, expect, it } from 'vitest';
import { formatPatientId, generatePrescriptionId, normalizeEmail, normalizeName, normalizePatientId, normalizePhone, patientIdYear } from '../src/lib/normalize.js';

const Y = patientIdYear();
import { computePatientAssignments, type AssignableBooking } from '../src/services/patientIds.js';
import { matchDoctor, type Doctor } from '../src/services/doctors.js';
import { signBody, verifyCalSignature } from '../src/lib/signature.js';
import { mapCalPayload } from '../src/services/calPayload.js';
import { medicineSentence, renderPrescriptionHtml } from '../src/services/prescriptionTemplate.js';
import { calExportTimes } from '../src/services/sheetImport.js';

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

describe('clinic patient IDs (ER/yy/nn)', () => {
  it('formats and normalises register IDs', () => {
    expect(formatPatientId(7, '26')).toBe('ER/26/07');
    expect(formatPatientId(151, '26')).toBe('ER/26/151');
    expect(normalizePatientId('PID ER/26/146')).toBe('ER/26/146');
    expect(normalizePatientId(' er / 26 / 5 ')).toBe('ER/26/05');
    expect(normalizePatientId('PAT-001')).toBeNull();
  });
  it('register patients keep their ID; new ones continue after the highest this year', () => {
    const out = computePatientAssignments(
      [b(1, { patient_email: 'Known@x.com' }), b(2, { patient_email: 'new@x.com' }), b(3, { patient_id: 'PAT-001', patient_email: 'old@x.com' })],
      [{ patient_id: `ER/${Y}/150`, email: 'known@x.com' }, { patient_id: 'ER/20/999', email: 'ancient@x.com' }],
    );
    expect(out).toEqual([
      { id: 1, patient_id: `ER/${Y}/150`, patient_type: 'Existing' },
      { id: 2, patient_id: `ER/${Y}/151`, patient_type: 'New' },
    ]);
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
      { id: 1, patient_id: `ER/${Y}/01`, patient_type: 'New' },
      { id: 2, patient_id: `ER/${Y}/02`, patient_type: 'New' },
      { id: 3, patient_id: `ER/${Y}/01`, patient_type: 'Existing' },
      { id: 4, patient_id: `ER/${Y}/01`, patient_type: 'Existing' },
    ]);
  });
  it('is idempotent and continues numbering after existing IDs', () => {
    const rows = [
      b(1, { patient_id: `ER/${Y}/07`, patient_email: 'old@x.com' }),
      b(2, { patient_email: 'old@x.com' }),
      b(3, { patient_email: 'new@x.com' }),
    ];
    const out = computePatientAssignments(rows);
    expect(out).toEqual([
      { id: 2, patient_id: `ER/${Y}/07`, patient_type: 'Existing' },
      { id: 3, patient_id: `ER/${Y}/08`, patient_type: 'New' },
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

describe('letterhead template', () => {
  it('writes medicines the way the doctors do', () => {
    expect(medicineSentence({ name: 'T. Mirtazapine', dosage: '7.5mg', frequency: '0-0-1', duration: '7 days then stop' }))
      .toBe('T. Mirtazapine 7.5mg 0-0-1 for 7 days then stop');
    expect(medicineSentence({ name: 'T. Etifoxine', dosage: '50mg', frequency: '1-1-1' })).toBe('T. Etifoxine 50mg 1-1-1');
    expect(medicineSentence({ name: 'Vit D3', duration: 'for 8 weeks', notes: 'after food' })).toBe('Vit D3 for 8 weeks (after food)');
  });
  it('numbers medicines then advice lines, prints letterhead lines and escapes input', () => {
    const html = renderPrescriptionHtml({
      layout: 'classic',
      prescriptionId: 'RX-1234567890', date: new Date('2026-07-15T06:00:00Z'),
      doctor: { display_name: 'Dr Radha Dangaich', role: 'MD Psychiatry (NIMHANS)', reg_no: 'Reg No DMC/R/25251', signature_url: null,
        designation: 'Consultant Neuropsychiatrist', highlight: 'Co-founder Equaroots' },
      patient: { name: 'Name <b>Surname</b>', patientId: 'PAT-001', age: '30', gender: 'Male', phone: null, email: null, consultationAt: null },
      impression: 'GAD', progression: 'Improvement in sleep', advice: '1) Review after 20 days\n- Walk daily',
      medicines: [{ name: 'T. Etifoxine', dosage: '50mg', frequency: '1-1-1' }],
    });
    expect(html).toContain('Date- 15/07/2026');
    expect(html).toContain('Patient Details- Name &lt;b&gt;Surname&lt;/b&gt;, 30 year old male');
    expect(html).toContain('Progression- Improvement in sleep');
    expect(html).toMatch(/<li>T\. Etifoxine 50mg 1-1-1<\/li><li>Review after 20 days<\/li><li>Walk daily<\/li>/);
    expect(html).toContain('Consultant Neuropsychiatrist');
    expect(html).toContain('class="hl">Co-founder Equaroots');
    expect(html).toContain('class="brand-logo"');
  });
});

describe('letterhead layouts', () => {
  const base = {
    prescriptionId: 'RX-1234567890', date: new Date('2026-07-15T06:00:00Z'),
    patient: { name: 'Pat <x>', patientId: 'PAT-009', age: '30', gender: 'Male', phone: null, email: null, consultationAt: null },
    impression: 'GAD', progression: '', advice: 'Walk daily\nReview after 20 days',
    medicines: [{ name: 'T. Etifoxine', dosage: '50mg', frequency: '1-1-1' }],
  };
  const doctor = (letterhead_layout?: string) => ({ display_name: 'Dr X', role: 'MD', reg_no: 'R1', signature_url: null, letterhead_layout });
  it("uses the treating doctor's layout, modern by default", () => {
    expect(renderPrescriptionHtml({ ...base, doctor: doctor() })).toContain('class="card"');
    expect(renderPrescriptionHtml({ ...base, doctor: doctor('sidebar') })).toContain('class="side"');
    expect(renderPrescriptionHtml({ ...base, doctor: doctor('classic') })).toContain('Patient Details-');
    expect(renderPrescriptionHtml({ ...base, doctor: doctor('bogus') })).toContain('class="card"');
    expect(renderPrescriptionHtml({ ...base, doctor: doctor('classic'), layout: 'sidebar' })).toContain('class="side"');
  });
  it('modern: escaped patient, chip doses, follow-up pulled out, empty columns hidden', () => {
    const html = renderPrescriptionHtml({ ...base, doctor: doctor('modern') });
    expect(html).toContain('Pat &lt;x&gt;');
    expect(html).toContain('<span class="dose">1-1-1</span>');
    expect(html).toContain('↻ Review after 20 days');
    expect(html).toContain('<li>Walk daily</li>');
    expect(html).not.toContain('<th>Notes</th>');
    expect(html).toContain('class="brand-logo"');
  });
});

describe('Cal.id export dates (India time)', () => {
  const now = new Date('2026-10-06T06:00:00Z');
  it('reads full dates', () => {
    expect(calExportTimes('15 July 2026', '5:00pm to 5:30pm', now)).toEqual({
      start: '2026-07-15T11:30:00.000Z', end: '2026-07-15T12:00:00.000Z',
    });
  });
  it('reads year-less upcoming dates as the nearest one', () => {
    expect(calExportTimes('Tue, 6 Oct', '4:00pm to 5:00pm', now)?.start).toBe('2026-10-06T10:30:00.000Z');
    expect(calExportTimes('Sun, 18 Oct', '11:00am to 11:30am', now)?.start).toBe('2026-10-18T05:30:00.000Z');
    expect(calExportTimes('Mon, 4 Jan', '12:00pm to 12:30pm', now)?.start).toBe('2027-01-04T06:30:00.000Z');
  });
  it('handles 12am/12pm and midnight crossings', () => {
    expect(calExportTimes('1 Aug 2026', '12:00am to 12:30am', now)?.start).toBe('2026-07-31T18:30:00.000Z');
    expect(calExportTimes('1 Aug 2026', '11:30pm to 12:15am', now)?.end).toBe('2026-08-01T18:45:00.000Z');
  });
  it('returns null for unreadable dates', () => expect(calExportTimes('someday', '5pm to 6pm', now)).toBeNull());
});
