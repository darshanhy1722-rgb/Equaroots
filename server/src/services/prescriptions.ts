import type { Viewer } from '../auth.js';
import { pool, withTransaction, type Queryable } from '../db.js';
import { generatePrescriptionId } from '../lib/normalize.js';
import { HttpError, loadBookingForViewer, type BookingRow } from './access.js';
import { resolveActingDoctor, type Doctor } from './doctors.js';
import { sendEmail } from './email.js';
import { htmlToPdf } from './pdf.js';
import { clinicQrSvg, renderPrescriptionHtml, type MedicineLine } from './prescriptionTemplate.js';
import { putPdf, signedPdfUrl } from './storage.js';

export interface PrescriptionInput {
  impression: string;
  progression: string;
  advice: string;
  medicines: MedicineLine[];
}

export interface ConsultationRow {
  id: number;
  booking_id: number;
  prescription_id: string;
  impression: string | null;
  progression: string | null;
  advice: string | null;
  medicines_json: MedicineLine[] | null;
  status: string;
  pdf_url: string | null;
  approved_at: Date | null;
  created_at: Date;
  updated_at: Date;
  doctor_id: number | null;
}

const clip = (v: unknown, n: number) => String(v ?? '').slice(0, n);

export function sanitizeInput(body: any): PrescriptionInput {
  const meds = Array.isArray(body?.medicines) ? body.medicines : [];
  return {
    impression: clip(body?.impression, 8000).trim(),
    progression: clip(body?.progression, 8000).trim(),
    advice: clip(body?.advice, 8000).trim(),
    medicines: meds.slice(0, 50).map((m: any) => ({
      name: clip(m?.name, 200).trim(),
      dosage: clip(m?.dosage, 200).trim(),
      frequency: clip(m?.frequency, 200).trim(),
      duration: clip(m?.duration, 200).trim(),
      notes: clip(m?.notes, 500).trim(),
    })).filter((m: MedicineLine) => m.name || m.dosage || m.frequency || m.duration || m.notes),
  };
}

export async function latestConsultation(db: Queryable, bookingId: number): Promise<ConsultationRow | null> {
  const { rows } = await db.query<ConsultationRow>(
    'select * from consultations where booking_id=$1 order by updated_at desc, id desc limit 1',
    [bookingId],
  );
  return rows[0] ?? null;
}

async function actingDoctorOrThrow(db: Queryable, b: BookingRow): Promise<Doctor> {
  const d = await resolveActingDoctor(db, b);
  if (!d) {
    throw new HttpError(
      422,
      `Can't resolve the treating doctor for this booking ("${b.doctor_name_raw ?? 'unknown'}"). Add them to the doctors table first.`,
    );
  }
  return d;
}

async function buildPdfHtml(b: BookingRow, doctor: Doctor, input: PrescriptionInput, prescriptionId: string) {
  return renderPrescriptionHtml({
    qrSvg: await clinicQrSvg(),
    prescriptionId,
    date: new Date(),
    doctor,
    patient: {
      name: b.patient_name,
      patientId: b.patient_id,
      age: b.age,
      gender: b.gender,
      phone: b.patient_phone,
      email: b.patient_email,
      consultationAt: b.start_time ? new Date(b.start_time) : null,
    },
    ...input,
  });
}

async function upsertConsultation(
  db: Queryable,
  b: BookingRow,
  doctor: Doctor,
  input: PrescriptionInput,
  status: 'Draft' | 'Sent',
  existing: ConsultationRow | null,
  pdfKey: string | null,
): Promise<ConsultationRow> {
  const common = [
    b.patient_name, b.age, b.gender, b.patient_email, b.patient_phone, b.patient_id, doctor.id,
    input.impression, input.advice, JSON.stringify(input.medicines), status, input.progression,
  ];
  if (existing) {
    const { rows } = await db.query<ConsultationRow>(
      `update consultations set patient_name=$1, age=$2, gender=$3, email=$4, phone=$5, patient_uid=$6, doctor_id=$7,
         impression=$8, advice=$9, medicines_json=$10, status=$11, progression=$12,
         pdf_url=coalesce($13, pdf_url),
         approved_at=case when $11='Sent' then now() else approved_at end,
         updated_at=now()
       where id=$14 returning *`,
      [...common, pdfKey, existing.id],
    );
    return rows[0];
  }
  // prescription_id is minted once, on first save, and never regenerated.
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const { rows } = await db.query<ConsultationRow>(
        `insert into consultations(patient_name, age, gender, email, phone, patient_uid, doctor_id, impression, advice,
           medicines_json, status, progression, pdf_url, approved_at, booking_id, prescription_id)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13, case when $11='Sent' then now() end, $14, $15) returning *`,
        [...common, pdfKey, b.id, generatePrescriptionId()],
      );
      return rows[0];
    } catch (e: any) {
      if (e?.code !== '23505') throw e; // retry only on prescription_id collision
    }
  }
  throw new Error('could not allocate a unique prescription id');
}

export async function saveDraft(viewer: Viewer, bookingId: number, input: PrescriptionInput) {
  return withTransaction(async (c) => {
    const b = await loadBookingForViewer(c, viewer, bookingId);
    const doctor = await actingDoctorOrThrow(c, b);
    await c.query('select pg_advisory_xact_lock(4242002, $1)', [b.id]);
    const existing = await latestConsultation(c, b.id);
    // Saving a draft over an already-sent Rx keeps it Sent-tracked; the new edits become a new draft.
    return upsertConsultation(c, b, doctor, input, 'Draft', existing, null);
  });
}

/** Renders the PDF for the current form contents. Writes nothing. */
export async function previewPdf(viewer: Viewer, bookingId: number, input: PrescriptionInput | null) {
  const b = await loadBookingForViewer(pool, viewer, bookingId);
  const doctor = await actingDoctorOrThrow(pool, b);
  const existing = await latestConsultation(pool, b.id);
  const data: PrescriptionInput = input ?? {
    impression: existing?.impression ?? '',
    progression: existing?.progression ?? '',
    advice: existing?.advice ?? '',
    medicines: existing?.medicines_json ?? [],
  };
  const rxId = existing?.prescription_id ?? 'RX-PREVIEW';
  return { pdf: await htmlToPdf(await buildPdfHtml(b, doctor, data, rxId)), prescriptionId: rxId };
}

/**
 * Approve & send: render → upload → consultation Sent → email → booking
 * 'Prescription Sent'. The PDF and email always carry the treating doctor's
 * identity (resolved from the booking), even when an admin presses Send.
 */
export async function approveAndSend(viewer: Viewer, bookingId: number, input: PrescriptionInput) {
  const b = await loadBookingForViewer(pool, viewer, bookingId);
  if (!b.patient_email) throw new HttpError(422, 'This booking has no patient email to send to.');
  if (!input.impression && !input.progression && !input.advice && !input.medicines.length) {
    throw new HttpError(422, 'Prescription is empty.');
  }
  const doctor = await actingDoctorOrThrow(pool, b);

  // Reserve/obtain the prescription id first (so the PDF shows the final number).
  const consult = await withTransaction(async (c) => {
    await c.query('select pg_advisory_xact_lock(4242002, $1)', [b.id]);
    const existing = await latestConsultation(c, b.id);
    return upsertConsultation(c, b, doctor, input, 'Draft', existing, null);
  });

  const pdf = await htmlToPdf(await buildPdfHtml(b, doctor, input, consult.prescription_id));
  const key = `prescriptions/${(b.patient_id ?? 'unassigned').replace(/[^A-Za-z0-9-]+/g, '-')}/${consult.prescription_id}.pdf`;
  await putPdf(key, pdf);

  const sent = await upsertConsultation(pool, b, doctor, input, 'Sent', consult, key);

  const firstName = b.patient_name.split(/\s+/)[0] ?? b.patient_name;
  const when = consultationWhen(b.start_time, b.end_time);
  try {
    await sendEmail({
      to: b.patient_email,
      subject: `Your prescription from ${doctor.display_name}${when ? ` — consultation on ${when.date}` : ''} · EquaRoots`,
      html: `<p>Dear ${escapeHtml(firstName)},</p>
<p>Thank you for consulting with <b>${escapeHtml(doctor.display_name)}</b>${doctor.role ? ` (${escapeHtml(doctor.role)})` : ''} at EquaRoots.
Your prescription is attached as a PDF.</p>
<table cellpadding="6" cellspacing="0" style="border-collapse:collapse;border:1px solid #dfe8dc;font-size:14px;margin:8px 0 14px">
  ${when ? `<tr><td style="color:#5f6f63;border-bottom:1px solid #eef3ec">Consultation</td><td style="border-bottom:1px solid #eef3ec"><b>${when.date}</b>, ${when.time} (IST)</td></tr>` : ''}
  <tr><td style="color:#5f6f63;border-bottom:1px solid #eef3ec">Doctor</td><td style="border-bottom:1px solid #eef3ec">${escapeHtml(doctor.display_name)}</td></tr>
  ${b.patient_id ? `<tr><td style="color:#5f6f63;border-bottom:1px solid #eef3ec">Patient ID</td><td style="border-bottom:1px solid #eef3ec">${escapeHtml(b.patient_id)}</td></tr>` : ''}
  <tr><td style="color:#5f6f63">Prescription</td><td>${sent.prescription_id}</td></tr>
</table>
<p>If you have any questions, simply reply to this email.</p>
<p>Warm regards,<br>${escapeHtml(doctor.display_name)}<br>EquaRoots</p>`,
      attachment: { filename: `${sent.prescription_id}.pdf`, content: pdf },
    });
  } catch (e: any) {
    // Email failed: don't claim it was sent. Leave it as a draft so the doctor can retry.
    await pool.query(`update consultations set status='Draft', approved_at=null, updated_at=now() where id=$1`, [sent.id]);
    throw new HttpError(502, `PDF saved but email failed: ${e?.message ?? e}`);
  }

  await pool.query(`update bookings set status='Prescription Sent', pdf_url=$2, updated_at=now() where id=$1`, [b.id, key]);
  return { consultation: sent, pdfUrl: await signedPdfUrl(key) };
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

/** "Tue, 6 Oct 2026" + "4:00 pm – 5:00 pm" in India time, from the booking's appointment slot. */
export function consultationWhen(start: Date | string | null, end: Date | string | null): { date: string; time: string } | null {
  if (!start) return null;
  const s = new Date(start);
  if (Number.isNaN(s.getTime())) return null;
  const tz = { timeZone: 'Asia/Kolkata' } as const;
  const date = s.toLocaleDateString('en-GB', { ...tz, weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  const hm = (d: Date) => d.toLocaleTimeString('en-US', { ...tz, hour: 'numeric', minute: '2-digit' }).toLowerCase();
  const e = end ? new Date(end) : null;
  return { date, time: e && !Number.isNaN(e.getTime()) ? `${hm(s)} – ${hm(e)}` : hm(s) };
}
