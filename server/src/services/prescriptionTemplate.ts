import type { Doctor } from './doctors.js';

export interface MedicineLine {
  name: string;
  dosage?: string;
  frequency?: string;
  duration?: string;
  notes?: string;
}

export interface PrescriptionView {
  prescriptionId: string;
  date: Date;
  doctor: Pick<Doctor, 'display_name' | 'role' | 'reg_no' | 'signature_url'>;
  patient: {
    name: string;
    patientId: string | null;
    age: string | null;
    gender: string | null;
    phone: string | null;
    email: string | null;
    consultationAt: Date | null;
  };
  impression: string;
  advice: string;
  medicines: MedicineLine[];
}

const esc = (v: unknown) =>
  String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const multiline = (v: string) => esc(v).replace(/\n/g, '<br>');

const fmtDate = (d: Date | null) =>
  d ? d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }) : '—';

/** Branded A4 prescription. Identity always comes from the treating doctor passed in, never the viewer. */
export function renderPrescriptionHtml(v: PrescriptionView): string {
  const ageGender = [v.patient.age, v.patient.gender].filter(Boolean).join(' / ') || '—';
  const meds = v.medicines.filter((m) => m.name?.trim());
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${esc(v.prescriptionId)}</title>
<style>
  @page { size: A4; margin: 0; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: 'Helvetica Neue', Arial, sans-serif; color: #1f2a2e; font-size: 12.5px; }
  .page { width: 210mm; min-height: 297mm; padding: 0 0 18mm; position: relative; }
  .band { background: linear-gradient(120deg, #0f5c56, #1b8a7a); color: #fff; padding: 22px 34px 20px; display: flex; justify-content: space-between; align-items: flex-end; }
  .brand { font-size: 26px; font-weight: 700; letter-spacing: .5px; }
  .brand small { display: block; font-size: 11px; font-weight: 400; opacity: .85; letter-spacing: 1.5px; text-transform: uppercase; margin-top: 3px; }
  .rxmeta { text-align: right; font-size: 11.5px; line-height: 1.6; }
  .rxmeta b { font-size: 13px; }
  .body { padding: 22px 34px 0; }
  .doc { display: flex; justify-content: space-between; border-bottom: 2px solid #e3eeec; padding-bottom: 12px; }
  .doc .name { font-size: 17px; font-weight: 700; color: #0f5c56; }
  .doc .sub { color: #51666a; margin-top: 2px; }
  .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px 18px; background: #f4f9f8; border-radius: 8px; padding: 12px 16px; margin: 16px 0 6px; }
  .grid .k { font-size: 10px; text-transform: uppercase; letter-spacing: 1px; color: #6b8084; }
  .grid .v { font-weight: 600; margin-top: 1px; word-break: break-word; }
  h3 { font-size: 12px; text-transform: uppercase; letter-spacing: 1.4px; color: #0f5c56; margin: 20px 0 8px; }
  .rx { font-family: Georgia, serif; font-size: 30px; color: #1b8a7a; margin: 18px 0 -6px; }
  .text { line-height: 1.55; white-space: normal; }
  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; font-size: 10.5px; text-transform: uppercase; letter-spacing: .8px; color: #51666a; border-bottom: 1.5px solid #cfe0dd; padding: 7px 6px; }
  td { padding: 8px 6px; border-bottom: 1px solid #edf3f2; vertical-align: top; }
  td.n { color: #8aa0a3; width: 22px; }
  td.med { font-weight: 600; }
  .sign { margin-top: 40px; display: flex; justify-content: flex-end; }
  .sign .box { text-align: center; min-width: 220px; }
  .sign img { max-height: 56px; max-width: 200px; display: block; margin: 0 auto 4px; }
  .sign .line { border-top: 1px solid #9fb3b5; padding-top: 6px; font-weight: 700; }
  .sign .sub { color: #51666a; font-size: 11px; }
  .sign .dsig { margin-top: 5px; font-size: 9.5px; color: #1b8a7a; letter-spacing: .4px; }
  .foot { position: absolute; left: 34px; right: 34px; bottom: 8mm; border-top: 1px solid #e3eeec; padding-top: 8px; font-size: 9.5px; color: #7d9195; display: flex; justify-content: space-between; }
</style></head>
<body><div class="page">
  <div class="band">
    <div class="brand">EquaRoots<small>Psychiatry &amp; Mental Wellness · Telehealth</small></div>
    <div class="rxmeta"><b>${esc(v.prescriptionId)}</b><br>Date: ${fmtDate(v.date)}</div>
  </div>
  <div class="body">
    <div class="doc">
      <div>
        <div class="name">${esc(v.doctor.display_name)}</div>
        <div class="sub">${esc(v.doctor.role ?? '')}</div>
      </div>
      <div class="sub" style="text-align:right">${esc(v.doctor.reg_no ?? '')}</div>
    </div>
    <div class="grid">
      <div><div class="k">Patient</div><div class="v">${esc(v.patient.name)}</div></div>
      <div><div class="k">Patient ID</div><div class="v">${esc(v.patient.patientId ?? '—')}</div></div>
      <div><div class="k">Age / Gender</div><div class="v">${esc(ageGender)}</div></div>
      <div><div class="k">Phone</div><div class="v">${esc(v.patient.phone ?? '—')}</div></div>
      <div><div class="k">Email</div><div class="v">${esc(v.patient.email ?? '—')}</div></div>
      <div><div class="k">Consultation</div><div class="v">${fmtDate(v.patient.consultationAt)}</div></div>
    </div>

    <h3>Clinical Impression</h3>
    <div class="text">${v.impression ? multiline(v.impression) : '—'}</div>

    <div class="rx">℞</div>
    <h3>Medicines</h3>
    ${
      meds.length
        ? `<table><thead><tr><th></th><th>Medicine</th><th>Dosage</th><th>Frequency</th><th>Duration</th><th>Notes</th></tr></thead><tbody>
      ${meds
        .map(
          (m, i) => `<tr><td class="n">${i + 1}</td><td class="med">${esc(m.name)}</td><td>${esc(m.dosage)}</td><td>${esc(
            m.frequency,
          )}</td><td>${esc(m.duration)}</td><td>${esc(m.notes)}</td></tr>`,
        )
        .join('')}
      </tbody></table>`
        : '<div class="text">No medicines prescribed.</div>'
    }

    <h3>Advice</h3>
    <div class="text">${v.advice ? multiline(v.advice) : '—'}</div>

    <div class="sign"><div class="box">
      ${v.doctor.signature_url ? `<img src="${esc(v.doctor.signature_url)}" alt="">` : '<div style="height:40px"></div>'}
      <div class="line">${esc(v.doctor.display_name)}</div>
      <div class="sub">${esc(v.doctor.role ?? '')}</div>
      <div class="sub">${esc(v.doctor.reg_no ?? '')}</div>
      ${v.doctor.signature_url ? `<div class="dsig">Digitally signed · ${fmtDate(v.date)}</div>` : ''}
    </div></div>
  </div>
  <div class="foot">
    <span>This is a digitally generated prescription issued after a telehealth consultation.</span>
    <span>${esc(v.prescriptionId)}</span>
  </div>
</div></body></html>`;
}
