import fs from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { pool } from '../src/db.js';
import { signBody } from '../src/lib/signature.js';
import { runMigrations } from '../src/migrate.js';
import { closeBrowser } from '../src/services/pdf.js';

const app = createApp();
const SECRET = 'test-secret';

async function agentFor(email: string) {
  const a = request.agent(app);
  await a.post('/api/auth/dev-login').send({ email }).expect(200);
  return a;
}

function calEvent(trigger: string, payload: Record<string, unknown>) {
  const raw = JSON.stringify({ triggerEvent: trigger, createdAt: new Date().toISOString(), payload });
  return request(app)
    .post('/api/webhooks/cal')
    .set('Content-Type', 'application/json')
    .set('X-Cal-Signature-256', signBody(raw, SECRET))
    .send(raw);
}

const booking = (uid: string, name: string, email: string, phone: string, organizer: { name: string; email?: string }, day: number) => ({
  uid,
  status: 'ACCEPTED',
  startTime: `2026-03-${String(day).padStart(2, '0')}T05:00:00Z`,
  endTime: `2026-03-${String(day).padStart(2, '0')}T05:30:00Z`,
  attendees: [{ name, email, timeZone: 'Asia/Kolkata' }],
  organizer,
  responses: { data: { attendeePhoneNumber: { value: phone }, age: { value: '30' }, gender: { value: 'Female' } } },
  metadata: { videoCallUrl: 'https://meet.google.com/abc' },
});

beforeAll(async () => {
  await pool.query('drop schema public cascade; create schema public;');
  await runMigrations(pool, () => {});
  // Migration 002 seeds the live roster; verify it, then use our own fixtures.
  const roster = (await pool.query('select display_name, email from doctors order by id')).rows;
  expect(roster.map((r) => r.display_name)).toEqual(['Dr Radha Dangaich', 'Dr Kshitij Srivastava', 'Dr. Abhinav Pandey']);
  await pool.query('delete from doctors');
  await pool.query(`insert into doctors(display_name, role, reg_no, email) values
    ('Dr Radha Dangaich', 'MD Psychiatry (NIMHANS)', 'Reg No DMC/R/25251', 'radha@equaroots.com'),
    ('Dr Arjun Menon', 'MD Psychiatry', 'Reg No KMC/1', 'arjun@equaroots.com')`);
  await pool.query(`insert into medicines(name) values ('Escitalopram 10mg')`);
  fs.rmSync('./data/test-pdfs', { recursive: true, force: true });
});

afterAll(async () => {
  await closeBrowser();
  await pool.end();
});

describe('Cal.id webhook', () => {
  it('rejects bad signatures with 401 and logs them', async () => {
    const raw = JSON.stringify({ triggerEvent: 'BOOKING_CREATED', payload: { uid: 'evil' } });
    await request(app).post('/api/webhooks/cal').set('X-Cal-Signature-256', 'deadbeef').send(raw).expect(401);
    await request(app).post('/api/webhooks/cal').send(raw).expect(401);
    const { rows } = await pool.query('select ok, note from webhook_logs order by id');
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.ok === false)).toBe(true);
    expect((await pool.query("select 1 from bookings where cal_uid='evil'")).rowCount).toBe(0);
  });

  it('creates bookings, assigns PAT ids, flags returning patients, and resolves "Dr." names', async () => {
    await calEvent('BOOKING_CREATED', booking('c1', 'Asha Rao', 'asha@x.com', '+91 90000 11111', { name: 'Dr. Radha Dangaich', email: 'radha@cal.id' }, 1)).expect(200);
    await calEvent('BOOKING_CREATED', booking('c2', 'Ben', 'ben@x.com', '9888877777', { name: 'Dr Arjun Menon', email: 'arjun@equaroots.com' }, 2)).expect(200);
    await calEvent('BOOKING_CREATED', booking('c3', 'Asha R', 'other@x.com', '090000 11111', { name: 'Dr Radha Dangaich', email: 'radha@equaroots.com' }, 3)).expect(200);
    const { rows } = await pool.query(
      'select cal_uid, patient_id, patient_type, d.email as doc from bookings b join doctors d on d.id=b.doctor_id order by b.id',
    );
    expect(rows).toEqual([
      { cal_uid: 'c1', patient_id: 'PAT-001', patient_type: 'New', doc: 'radha@equaroots.com' },
      { cal_uid: 'c2', patient_id: 'PAT-002', patient_type: 'New', doc: 'arjun@equaroots.com' },
      { cal_uid: 'c3', patient_id: 'PAT-001', patient_type: 'Existing', doc: 'radha@equaroots.com' },
    ]);
  });

  it('reschedule updates the same row (new uid), cancel sets CANCELLED, PING is logged only', async () => {
    const p = { ...booking('c2b', 'Ben', 'ben@x.com', '9888877777', { name: 'Dr Arjun Menon', email: 'arjun@equaroots.com' }, 9), rescheduleUid: 'c2' };
    await calEvent('BOOKING_RESCHEDULED', p).expect(200);
    const r = await pool.query("select cal_uid, patient_id, start_time from bookings where patient_name='Ben'");
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({ cal_uid: 'c2b', patient_id: 'PAT-002' });
    await calEvent('BOOKING_CANCELLED', { uid: 'c2b' }).expect(200);
    expect((await pool.query("select status from bookings where cal_uid='c2b'")).rows[0].status).toBe('CANCELLED');
    await calEvent('PING', {}).expect(200);
    const last = await pool.query('select ok, trigger_event from webhook_logs order by id desc limit 1');
    expect(last.rows[0]).toEqual({ ok: true, trigger_event: 'PING' });
  });
});

describe('auth + visibility', () => {
  it('requires a session', async () => {
    await request(app).get('/api/patients').expect(401);
  });

  it('unknown emails get authorized:false and 403 on data', async () => {
    const a = await agentFor('stranger@x.com');
    const boot = await a.get('/api/bootstrap').expect(200);
    expect(boot.body).toMatchObject({ authorized: false, email: 'stranger@x.com' });
    await a.get('/api/patients').expect(403);
  });

  it('doctors only see their own patients; admins see all + can filter', async () => {
    const radha = await agentFor('radha@equaroots.com');
    const mine = (await radha.get('/api/patients').expect(200)).body.patients;
    expect(mine.map((p: any) => p.calUid).sort()).toEqual(['c1', 'c3']);
    // doctor_id filter is ignored for non-admins
    const arjunId = (await pool.query("select id from doctors where email='arjun@equaroots.com'")).rows[0].id;
    expect((await radha.get(`/api/patients?doctor_id=${arjunId}`)).body.patients).toHaveLength(2);

    const admin = await agentFor('admin@example.com');
    const boot = (await admin.get('/api/bootstrap')).body;
    expect(boot).toMatchObject({ authorized: true, isAdmin: true });
    expect(boot.doctors).toHaveLength(2);
    expect((await admin.get('/api/patients')).body.patients).toHaveLength(3);
    const filtered = (await admin.get(`/api/patients?doctor_id=${arjunId}`)).body.patients;
    expect(filtered.map((p: any) => p.calUid)).toEqual(['c2b']);
  });
});

describe('prescriptions', () => {
  let c1: number;
  let c2: number;
  beforeAll(async () => {
    c1 = (await pool.query("select id from bookings where cal_uid='c1'")).rows[0].id;
    c2 = (await pool.query("select id from bookings where cal_uid='c2b'")).rows[0].id;
  });

  it("blocks a doctor from another doctor's booking", async () => {
    const arjun = await agentFor('arjun@equaroots.com');
    await arjun.get(`/api/bookings/${c1}/draft`).expect(403);
    await arjun.post('/api/prescriptions?action=draft').send({ bookingId: c1, impression: 'x' }).expect(403);
  });

  it('draft save mints RX id once and keeps it on later edits', async () => {
    const radha = await agentFor('radha@equaroots.com');
    const first = (await radha.post('/api/prescriptions?action=draft').send({
      bookingId: c1, impression: 'GAD', advice: 'Sleep', medicines: [{ name: 'Escitalopram 10mg', dosage: '1 tab', frequency: 'OD', duration: '4 weeks' }],
    }).expect(200)).body;
    expect(first.prescriptionId).toMatch(/^RX-\d{10}$/);
    const second = (await radha.post('/api/prescriptions?action=draft').send({ bookingId: c1, impression: 'GAD, moderate' }).expect(200)).body;
    expect(second.prescriptionId).toBe(first.prescriptionId);
    const d = (await radha.get(`/api/bookings/${c1}/draft`).expect(200)).body.draft;
    expect(d).toMatchObject({ status: 'Draft', impression: 'GAD, moderate', prescriptionId: first.prescriptionId });
    expect((await pool.query('select count(*)::int as n from consultations where booking_id=$1', [c1])).rows[0].n).toBe(1);
  });

  it('preview returns a PDF and writes nothing', async () => {
    const radha = await agentFor('radha@equaroots.com');
    const before = (await pool.query('select updated_at from consultations where booking_id=$1', [c1])).rows[0];
    const res = await radha.post(`/api/prescriptions/${c1}/preview`).send({ impression: 'Preview only' }).buffer(true)
      .parse((r, cb) => { const chunks: Buffer[] = []; r.on('data', (c: Buffer) => chunks.push(c)); r.on('end', () => cb(null, Buffer.concat(chunks))); })
      .expect(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect((res.body as Buffer).subarray(0, 4).toString()).toBe('%PDF');
    const after = (await pool.query('select updated_at, impression from consultations where booking_id=$1', [c1])).rows[0];
    expect(after.updated_at).toEqual(before.updated_at);
    expect(after.impression).toBe('GAD, moderate');
  });

  it('admin send is issued under the treating doctor, emails the patient and marks the booking', async () => {
    const admin = await agentFor('admin@example.com');
    const rx = (await pool.query('select prescription_id from consultations where booking_id=$1', [c1])).rows[0].prescription_id;
    const out = (await admin.post('/api/prescriptions?action=send').send({
      bookingId: c1, impression: 'GAD', advice: 'Follow up in 4 weeks', medicines: [{ name: 'Escitalopram 10mg', dosage: '1 tab' }],
    }).expect(200)).body;
    expect(out).toMatchObject({ status: 'Sent', prescriptionId: rx });

    const c = (await pool.query(
      'select c.status, c.approved_at, c.pdf_url, d.email from consultations c join doctors d on d.id=c.doctor_id where booking_id=$1', [c1],
    )).rows[0];
    expect(c.status).toBe('Sent');
    expect(c.approved_at).not.toBeNull();
    expect(c.email).toBe('radha@equaroots.com'); // treating doctor, never the admin
    const b = (await pool.query('select status, pdf_url from bookings where id=$1', [c1])).rows[0];
    expect(b).toEqual({ status: 'Prescription Sent', pdf_url: c.pdf_url });
    expect(fs.existsSync(path.resolve('./data/test-pdfs', c.pdf_url))).toBe(true);

    const outbox = path.resolve('data/outbox');
    const mail = fs.readdirSync(outbox).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(fs.readFileSync(path.join(outbox, f), 'utf8')));
    const sent = mail.find((m) => m.to === 'asha@x.com');
    expect(sent.subject).toContain('Dr Radha Dangaich');

    // signed PDF link works; tampered one does not
    const url = new URL(out.pdfUrl);
    await request(app).get(url.pathname + url.search).expect(200).expect('Content-Type', 'application/pdf');
    await request(app).get(url.pathname + url.search.replace(/sig=./, 'sig=0')).expect(403);
  });

  it('history excludes the current booking', async () => {
    const radha = await agentFor('radha@equaroots.com');
    const c3 = (await pool.query("select id from bookings where cal_uid='c3'")).rows[0].id;
    const h = (await radha.get(`/api/patients/PAT-001/history?exclude_booking_id=${c3}`).expect(200)).body.history;
    expect(h).toHaveLength(1);
    expect(h[0]).toMatchObject({ bookingId: c1, status: 'Sent', doctorName: 'Dr Radha Dangaich' });
    expect((await radha.get(`/api/patients/PAT-001/history?exclude_booking_id=${c1}`)).body.history).toHaveLength(0);
    const arjun = await agentFor('arjun@equaroots.com');
    await arjun.get('/api/patients/PAT-001/history').expect(403);
    void c2;
  });
});

describe('admin endpoints', () => {
  it('rotates the webhook secret (old one stops working)', async () => {
    const radha = await agentFor('radha@equaroots.com');
    await radha.post('/api/admin/reassign-token').expect(403);
    const admin = await agentFor('admin@example.com');
    const { secret } = (await admin.post('/api/admin/reassign-token').expect(200)).body;
    expect(secret).toMatch(/^[0-9a-f]{64}$/);
    await calEvent('PING', {}).expect(401);
    const raw = JSON.stringify({ triggerEvent: 'PING', payload: {} });
    await request(app).post('/api/webhooks/cal').set('X-Cal-Signature-256', signBody(raw, secret)).send(raw).expect(200);
    await pool.query('delete from app_settings');
  });

  it('imports sheet CSVs preserving patient ids', async () => {
    const admin = await agentFor('admin@example.com');
    const res = (await admin.post('/api/admin/import-csv').send({
      doctors: 'Name,Role,Reg No,Email\nDr Kavya Rao,MD Psychiatry,Reg 9,kavya@equaroots.com\n',
      medicines: 'Name,Notes\nSertraline 50mg,SSRI\nEscitalopram 10mg,dup\n',
      bookings: 'Booking UID,Patient ID,Patient Type,Name,Email,Phone,Doctor,Start Time,Status\nold-1,PAT-050,Existing,Old Patient,old@x.com,9111122222,Dr. Kavya Rao,2025-06-01T10:00:00Z,Prescription Sent\n',
      consultations: 'Prescription ID,Booking UID,Patient Name,Impression,Advice,Medicines JSON,Status\nRX-1786422062,old-1,Old Patient,Insomnia,Rest,"[{""name"":""Melatonin""}]",Sent\n',
    }).expect(200)).body;
    expect(res.summary.doctors.inserted).toBe(1);
    expect(res.summary.medicines).toMatchObject({ inserted: 1 });
    expect(res.summary.bookings.inserted).toBe(1);
    expect(res.summary.consultations.inserted).toBe(1);
    const b = (await pool.query("select patient_id, patient_type, d.email from bookings b join doctors d on d.id=b.doctor_id where cal_uid='old-1'")).rows[0];
    expect(b).toEqual({ patient_id: 'PAT-050', patient_type: 'Existing', email: 'kavya@equaroots.com' });
  });
});

describe('shared doctor emails + digital signatures', () => {
  const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

  it('admin can add doctors sharing an email; webhook resolves them by name', async () => {
    const admin = await agentFor('admin@example.com');
    await admin.post('/api/admin/doctors').send({ display_name: 'Dr Asha One', role: 'MD', reg_no: 'R1', email: 'hello@clinic.com' }).expect(200);
    await admin.post('/api/admin/doctors').send({ display_name: 'Dr. Bina Two', role: 'MD', reg_no: 'R2', email: 'hello@clinic.com' }).expect(200);
    await admin.post('/api/admin/doctors').send({ display_name: 'Dr Asha One', email: 'x@y.com' }).expect(409);
    await admin.post('/api/admin/doctors').send({ display_name: '', email: 'x@y.com' }).expect(400);

    await calEvent('BOOKING_CREATED', booking('s1', 'Pat A', 'pa@x.com', '9000000001', { name: 'Dr Bina Two', email: 'hello@clinic.com' }, 11)).expect(200);
    await calEvent('BOOKING_CREATED', booking('s2', 'Pat B', 'pb@x.com', '9000000002', { name: 'Dr. Asha One', email: 'hello@clinic.com' }, 12)).expect(200);
    const r = (await pool.query("select b.cal_uid, d.display_name from bookings b join doctors d on d.id=b.doctor_id where cal_uid in ('s1','s2') order by cal_uid")).rows;
    expect(r).toEqual([{ cal_uid: 's1', display_name: 'Dr. Bina Two' }, { cal_uid: 's2', display_name: 'Dr Asha One' }]);

    // the shared login sees both doctors' patients
    const shared = await agentFor('hello@clinic.com');
    const boot = (await shared.get('/api/bootstrap').expect(200)).body;
    expect(boot.myDoctors.map((d: any) => d.display_name).sort()).toEqual(['Dr Asha One', 'Dr. Bina Two']);
    const pts = (await shared.get('/api/patients')).body.patients.map((p: any) => p.calUid).sort();
    expect(pts).toEqual(['s1', 's2']);
  });

  it('doctor sets own signature; others cannot; PDF shows it', async () => {
    const radhaId = (await pool.query("select id from doctors where email='radha@equaroots.com'")).rows[0].id;
    const arjun = await agentFor('arjun@equaroots.com');
    await arjun.put(`/api/doctors/${radhaId}/signature`).send({ signature: PNG }).expect(403);
    const radha = await agentFor('radha@equaroots.com');
    await radha.put(`/api/doctors/${radhaId}/signature`).send({ signature: 'javascript:alert(1)' }).expect(400);
    await radha.put(`/api/doctors/${radhaId}/signature`).send({ signature: PNG }).expect(200);
    expect((await radha.get(`/api/doctors/${radhaId}/signature`).expect(200)).body.signature).toBe(PNG);
    const boot = (await radha.get('/api/bootstrap')).body;
    expect(boot.doctor.hasSignature).toBe(true);
    expect(boot.doctor.signature_url).toBeUndefined();

    const { renderPrescriptionHtml } = await import('../src/services/prescriptionTemplate.js');
    const html = renderPrescriptionHtml({
      prescriptionId: 'RX-1', date: new Date(), impression: '', advice: '', medicines: [],
      doctor: { display_name: 'Dr X', role: null, reg_no: null, signature_url: PNG },
      patient: { name: 'P', patientId: null, age: null, gender: null, phone: null, email: null, consultationAt: null },
    });
    expect(html).toContain(PNG);
    expect(html).toContain('Digitally signed');
  });

  it('admin edits a doctor and cannot delete one with bookings', async () => {
    const admin = await agentFor('admin@example.com');
    const docs = (await admin.get('/api/admin/doctors').expect(200)).body.doctors;
    const asha = docs.find((d: any) => d.display_name === 'Dr Asha One');
    await admin.put(`/api/admin/doctors/${asha.id}`).send({ ...asha, reg_no: 'Reg No DMC/R/99999' }).expect(200);
    expect((await pool.query('select reg_no from doctors where id=$1', [asha.id])).rows[0].reg_no).toBe('Reg No DMC/R/99999');
    await admin.delete(`/api/admin/doctors/${asha.id}`).expect(409);
    const radha = await agentFor('radha@equaroots.com');
    await radha.get('/api/admin/doctors').expect(403);
  });
});
