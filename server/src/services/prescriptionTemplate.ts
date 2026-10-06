import QRCode from 'qrcode';
import { LOGO_SVG } from '../brand.js';
import { config } from '../config.js';
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
  doctor: Pick<Doctor, 'display_name' | 'role' | 'reg_no' | 'signature_url'> & Partial<Pick<Doctor, 'designation' | 'highlight'>>;
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
  progression?: string;
  advice: string;
  medicines: MedicineLine[];
  /** Footer QR code (SVG markup). */
  qrSvg?: string;
}

let qrCache: Promise<string> | null = null;
/** QR code for the letterhead footer (Instagram by default; CLINIC_QR_URL to change). */
export function clinicQrSvg(): Promise<string> {
  if (!config.clinic.qrUrl) return Promise.resolve('');
  qrCache ??= QRCode.toString(config.clinic.qrUrl, { type: 'svg', margin: 0, errorCorrectionLevel: 'M', color: { dark: '#1e421e', light: '#ffffff' } }).catch(
    () => '',
  );
  return qrCache;
}

const esc = (v: unknown) =>
  String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const multiline = (v: string) => esc(v).replace(/\n/g, '<br>');

const ddmmyyyy = (d: Date) =>
  d.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Asia/Kolkata' });

/** "T. Mirtazapine 7.5mg 0-0-1 for 7 days then stop — after food" */
export function medicineSentence(m: MedicineLine): string {
  const dur = (m.duration ?? '').trim();
  const parts = [m.name, m.dosage, m.frequency].map((x) => (x ?? '').trim()).filter(Boolean);
  if (dur) parts.push(/^(for|till|until|x)\b/i.test(dur) ? dur : `for ${dur}`);
  let s = parts.join(' ');
  if (m.notes?.trim()) s += ` (${m.notes.trim()})`;
  return s;
}

/** "Name Surname, 30 year old male" */
function patientLine(p: PrescriptionView['patient']): string {
  const age = (p.age ?? '').trim();
  const g = (p.gender ?? '').trim().toLowerCase();
  const desc = [age ? `${age}${/^\d+$/.test(age) ? ' year old' : ''}` : '', g].filter(Boolean).join(' ');
  return desc ? `${p.name}, ${desc}` : p.name;
}

const icon = {
  phone: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="12" fill="#fff"/><path fill="#1e421e" d="M16.6 14.2l-1.7-.8a1 1 0 00-1.1.2l-.8.8a8 8 0 01-3.4-3.4l.8-.8a1 1 0 00.2-1.1l-.8-1.7a1 1 0 00-1.2-.5L7.4 7.4A1 1 0 006.8 8.6a10.6 10.6 0 008.6 8.6 1 1 0 001.2-.6l.5-1.2a1 1 0 00-.5-1.2z"/></svg>',
  pin: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="12" fill="#fff"/><path fill="#1e421e" d="M12 5.5a4.5 4.5 0 00-4.5 4.5c0 3.4 4.5 8.5 4.5 8.5s4.5-5.1 4.5-8.5A4.5 4.5 0 0012 5.5zm0 6.2a1.7 1.7 0 110-3.4 1.7 1.7 0 010 3.4z"/></svg>',
  mail: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="12" fill="#fff"/><path fill="#1e421e" d="M6.5 8.5h11v7h-11z" opacity=".25"/><path fill="none" stroke="#1e421e" stroke-width="1.4" d="M6.5 8.5h11v7h-11zM6.5 8.5l5.5 4 5.5-4"/></svg>',
};

/**
 * EquaRoots letterhead prescription. Identity always comes from the treating
 * doctor passed in, never the signed-in viewer.
 */
export function renderPrescriptionHtml(v: PrescriptionView): string {
  const d = v.doctor;
  const c = config.clinic;
  const items = [
    ...v.medicines.filter((m) => m.name?.trim()).map(medicineSentence),
    ...v.advice.split('\n').map((l) => l.replace(/^\s*(\d+[.)]|[-•*])\s*/, '').trim()).filter(Boolean),
  ];
  const meta = [
    v.patient.patientId && `Patient ID: ${v.patient.patientId}`,
    v.patient.phone,
    v.patient.email,
  ].filter(Boolean);

  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${esc(v.prescriptionId)}</title>
<style>
  @page { size: A4; margin: 0; }
  * { box-sizing: border-box; }
  html, body { margin: 0; }
  body { font-family: Arial, 'Helvetica Neue', Helvetica, sans-serif; color: #111; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .page { width: 210mm; min-height: 297mm; display: flex; flex-direction: column; }
  .band { position: relative; background: #1e421e; height: 40mm; margin-top: 2mm; }
  .band::after { content: ''; position: absolute; left: 0; right: 0; bottom: 0; height: 4.5mm; background: #566f5a; }
  .logo { position: absolute; left: 12mm; top: -2mm; width: 54mm; height: 50mm; background: #566f5a; padding: 2.4mm; z-index: 2; }
  .logo-inner { background: #fff; width: 100%; height: 100%; display: grid; place-items: center; }
  .logo svg { width: 92%; height: auto; display: block; }
  .doc { position: absolute; right: 12mm; top: 6.5mm; text-align: right; color: #f1f3ef; line-height: 1.55; z-index: 1; }
  .doc .name { font-weight: 700; font-size: 14.5px; letter-spacing: .2px; }
  .doc .line { font-size: 13px; color: #e2e8df; }
  .doc .hl { font-size: 13px; font-weight: 700; color: #e9b84a; }
  .body { padding: 18mm 16mm 6mm 18mm; flex: 1; font-style: italic; font-weight: 700; font-size: 15.5px; line-height: 1.45; }
  .meta-row { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 9mm; font-style: normal; }
  .rxno { color: #3f8a3c; font-weight: 400; font-size: 15px; }
  .date { font-style: italic; font-size: 17px; }
  .sec { margin: 0 0 7mm; }
  .sub { font-style: normal; font-weight: 400; font-size: 11.5px; color: #555; margin-top: 1.2mm; }
  ol { margin: 1.5mm 0 0; padding-left: 0; list-style: none; counter-reset: n; }
  ol li { counter-increment: n; margin: .6mm 0; }
  ol li::before { content: counter(n) ") "; }
  .sign { display: flex; justify-content: flex-end; margin-top: 6mm; }
  .sign-box { width: 64mm; text-align: center; font-style: normal; font-weight: 400; }
  .sign-box img { max-height: 24mm; max-width: 56mm; display: block; margin: 0 auto -1mm; }
  .stamp { display: inline-block; border: 1.6px solid #1d2f6b; color: #1d2f6b; padding: 1.2mm 2.6mm; line-height: 1.25; margin-top: 1mm; }
  .stamp b { font-size: 12.5px; display: block; }
  .stamp span { font-size: 9px; font-weight: 700; display: block; }
  .dsig { font-size: 9px; color: #3f8a3c; margin-top: 1.4mm; letter-spacing: .3px; }
  .foot { background: #1e421e; color: #eef2ec; padding: 4mm 12mm 3.4mm 6mm; display: flex; align-items: center; gap: 6mm; border-top: 4.5mm solid #566f5a; }
  .qr { background: #fff; padding: 1.6mm; width: 22mm; height: 22mm; flex: none; }
  .qr svg { width: 100%; height: 100%; display: block; }
  .foot-main { flex: 1; }
  .foot-row { display: flex; justify-content: space-between; align-items: center; gap: 4mm; font-size: 12.5px; }
  .foot-row div { display: flex; align-items: center; gap: 2mm; white-space: nowrap; }
  .foot-row svg { width: 6.5mm; height: 6.5mm; flex: none; }
  .social { text-align: center; font-size: 11.5px; margin-top: 2mm; color: #dfe6dc; }
</style></head>
<body><div class="page">
  <div class="band">
    <div class="logo"><div class="logo-inner">${LOGO_SVG}</div></div>
    <div class="doc">
      <div class="name">${esc(d.display_name)}</div>
      ${d.role ? `<div class="line">${esc(d.role)}</div>` : ''}
      ${d.designation ? `<div class="line">${esc(d.designation)}</div>` : ''}
      ${d.highlight ? `<div class="hl">${esc(d.highlight)}</div>` : ''}
    </div>
  </div>

  <div class="body">
    <div class="meta-row">
      <span class="rxno">${esc(v.prescriptionId)}</span>
      <span class="date">Date- ${ddmmyyyy(v.date)}</span>
    </div>

    <div class="sec">Patient Details- ${esc(patientLine(v.patient))}
      ${meta.length ? `<div class="sub">${meta.map(esc).join(' · ')}</div>` : ''}
    </div>

    ${v.impression ? `<div class="sec">Impression- ${multiline(v.impression)}</div>` : ''}
    ${v.progression ? `<div class="sec">Progression- ${multiline(v.progression)}</div>` : ''}

    ${items.length ? `<div class="sec">Advise-<ol>${items.map((i) => `<li>${esc(i)}</li>`).join('')}</ol></div>` : ''}

    <div class="sign"><div class="sign-box">
      ${d.signature_url ? `<img src="${esc(d.signature_url)}" alt="">` : '<div style="height:16mm"></div>'}
      <div class="stamp"><b>${esc(d.display_name)}</b>${d.role ? `<span>${esc(d.role)}</span>` : ''}${d.reg_no ? `<span>${esc(d.reg_no)}</span>` : ''}</div>
      ${d.signature_url ? `<div class="dsig">Digitally signed · ${ddmmyyyy(v.date)}</div>` : ''}
    </div></div>
  </div>

  <div class="foot">
    ${v.qrSvg ? `<div class="qr">${v.qrSvg}</div>` : ''}
    <div class="foot-main">
      <div class="foot-row">
        ${c.phone ? `<div>${icon.phone}${esc(c.phone)}</div>` : ''}
        ${c.entity ? `<div>${icon.pin}${esc(c.entity)}</div>` : ''}
        ${c.email ? `<div>${icon.mail}${esc(c.email)}</div>` : ''}
      </div>
      ${c.social ? `<div class="social">${esc(c.social)}</div>` : ''}
    </div>
  </div>
</div></body></html>`;
}
