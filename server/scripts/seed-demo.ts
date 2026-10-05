/**
 * Seeds demo doctors, medicines and bookings (through the real webhook
 * mapping + patient-ID logic) for local development and screenshots.
 */
import { pool, withTransaction } from '../src/db.js';
import { runMigrations } from '../src/migrate.js';
import { mapCalPayload } from '../src/services/calPayload.js';
import { listDoctors, matchDoctor, upsertDoctorByName } from '../src/services/doctors.js';
import { assignPatientIdsAndFlags } from '../src/services/patientIds.js';

await runMigrations(pool);

const doctors = [
  ['Dr Radha Dangaich', 'MD Psychiatry (NIMHANS)', 'Reg No DMC/R/25251', 'radha@equaroots.com'],
  ['Dr Arjun Menon', 'MD Psychiatry (AIIMS)', 'Reg No KMC/112093', 'arjun@equaroots.com'],
];
const medicines = [
  ['Escitalopram 10mg', 'SSRI'], ['Sertraline 50mg', 'SSRI'], ['Fluoxetine 20mg', 'SSRI'],
  ['Clonazepam 0.25mg', 'Benzodiazepine — short term'], ['Propranolol 10mg', 'Beta blocker'],
  ['Mirtazapine 7.5mg', 'NaSSA'], ['Quetiapine 25mg', 'Atypical antipsychotic'], ['Melatonin 3mg', 'Sleep'],
];

const day = (d: number, h: number) => {
  const t = new Date();
  t.setUTCDate(t.getUTCDate() + d);
  t.setUTCHours(h, 30, 0, 0);
  return t.toISOString();
};

const bookings = [
  ['Ananya Sharma', 'ananya.s@example.com', '+91 98450 12345', '27', 'Female', 'Dr. Radha Dangaich', 'radha@equaroots.com', -20],
  ['Rohan Kapoor', 'rohan.k@example.com', '+91 99000 54321', '34', 'Male', 'Dr. Radha Dangaich', 'radha@equaroots.com', -12],
  ['Meera Iyer', 'meera.iyer@example.com', '+91 97411 22233', '41', 'Female', 'Dr Arjun Menon', 'arjun@equaroots.com', -8],
  ['Ananya Sharma', 'ANANYA.S@example.com ', '098450 12345', '27', 'Female', 'Dr. Radha Dangaich', 'radha@equaroots.com', -1],
  ['Vikram Rao', 'vikram.rao@example.com', '+91 90080 77665', '29', 'Male', 'Dr Arjun Menon', 'arjun@equaroots.com', 0],
  ['Sneha Patil', 'sneha.p@example.com', '+91 91234 56780', '23', 'Female', 'Dr. Radha Dangaich', '', 1],
  ['Kabir Singh', 'kabir.singh@example.com', '+91 93333 44455', '38', 'Male', 'Dr Arjun Menon', 'arjun@equaroots.com', 2],
] as const;

await withTransaction(async (c) => {
  for (const [n, r, reg, e] of doctors) {
    await upsertDoctorByName(c, { display_name: n, role: r, reg_no: reg, email: e });
  }
  const { rowCount } = await c.query('select 1 from medicines limit 1');
  if (!rowCount) for (const [n, notes] of medicines) await c.query('insert into medicines(name, notes) values ($1,$2)', [n, notes]);

  const docs = await listDoctors(c);
  for (const [i, [name, email, phone, age, gender, docName, docEmail, d]] of bookings.entries()) {
    const body = {
      triggerEvent: 'BOOKING_CREATED',
      payload: {
        uid: `demo-${i + 1}`,
        status: 'ACCEPTED',
        startTime: day(d, 4 + (i % 6)),
        endTime: day(d, 5 + (i % 6)),
        attendees: [{ name, email, timeZone: 'Asia/Kolkata', language: { locale: 'en' } }],
        organizer: { name: docName, email: docEmail },
        responses: { data: { attendeePhoneNumber: { value: phone }, age: { value: age }, gender: { value: gender } } },
        metadata: { videoCallUrl: `https://meet.google.com/demo-${i + 1}` },
        description: 'Follow-up for anxiety and sleep',
      },
    };
    const m = mapCalPayload(body);
    const doctor = matchDoctor(docs, { email: m.doctor_email_raw, name: m.doctor_name_raw });
    await c.query(
      `insert into bookings(cal_uid, patient_name, age, gender, patient_email, patient_phone, doctor_id, doctor_name_raw,
         doctor_email_raw, start_time, end_time, meet_link, description, status, raw_payload)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) on conflict (cal_uid) do nothing`,
      [m.cal_uid, m.patient_name, m.age, m.gender, m.patient_email, m.patient_phone, doctor?.id ?? null, m.doctor_name_raw,
       m.doctor_email_raw, m.start_time, m.end_time, m.meet_link, m.description, m.status, JSON.stringify(body)],
    );
  }
  const a = await assignPatientIdsAndFlags(c);
  console.log(`[seed] assigned: ${a.map((x) => `${x.patient_id}/${x.patient_type}`).join(', ') || 'none (already seeded)'}`);
});
console.log('[seed] done');
await pool.end();
