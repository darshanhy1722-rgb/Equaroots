import QRCode from 'qrcode';
import { LOGO_HTML } from '../brand.js';
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
  doctor: Pick<Doctor, 'display_name' | 'role' | 'reg_no' | 'signature_url'> &
    Partial<Pick<Doctor, 'designation' | 'highlight' | 'letterhead_layout'>>;
  /** Overrides the doctor's own layout (used by the admin preview). */
  layout?: LetterheadLayout;
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

export const LETTERHEAD_LAYOUTS = ['modern', 'sidebar', 'classic'] as const;
export type LetterheadLayout = (typeof LETTERHEAD_LAYOUTS)[number];
export const isLayout = (v: unknown): v is LetterheadLayout => LETTERHEAD_LAYOUTS.includes(v as LetterheadLayout);

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

/** Classic: the clinic's original green letterhead band with the framed logo. */
function renderClassic(v: PrescriptionView): string {
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
  .logo img { width: auto; height: 100%; max-width: 100%; object-fit: contain; display: block; }
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
    <div class="logo"><div class="logo-inner">${LOGO_HTML}</div></div>
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

/**
 * Prescription PDF in the treating doctor's chosen letterhead layout. Identity
 * always comes from the treating doctor passed in, never the signed-in viewer.
 */
export function renderPrescriptionHtml(v: PrescriptionView): string {
  const layout = v.layout ?? (isLayout(v.doctor.letterhead_layout) ? v.doctor.letterhead_layout : 'modern');
  if (layout === 'classic') return renderClassic(v);
  if (layout === 'sidebar') return renderSidebar(v);
  return renderModern(v);
}

const BRAND = { green: '#1e421e', sage: '#566f5a', leaf: '#3f7a45', gold: '#e9b84a', soft: '#eef4ec', ink: '#18231b', muted: '#5f6f63' };

const SHARED_CSS = `
  @page { size: A4; margin: 0; }
  * { box-sizing: border-box; }
  html, body { margin: 0; }
  body { font-family: 'Helvetica Neue', Arial, Helvetica, sans-serif; color: ${BRAND.ink}; font-size: 12.5px; line-height: 1.5;
    -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .lbl { font-size: 9px; letter-spacing: 1.4px; text-transform: uppercase; color: ${BRAND.muted}; font-weight: 700; }
  h3 { margin: 0 0 2.4mm; font-size: 10px; letter-spacing: 1.6px; text-transform: uppercase; color: ${BRAND.leaf}; display: flex; align-items: center; gap: 2mm; }
  h3::after { content: ''; flex: 1; height: 1px; background: #dfe8dc; }
  .text { font-size: 13px; }
  .rx-sym { font-family: Georgia, serif; font-size: 26px; color: ${BRAND.leaf}; line-height: 1; margin-right: 2mm; font-weight: 700; }
  table.meds { width: 100%; border-collapse: separate; border-spacing: 0; font-size: 12px; }
  table.meds th { text-align: left; font-size: 8.5px; letter-spacing: 1.2px; text-transform: uppercase; color: ${BRAND.muted}; padding: 2mm 2.4mm; border-bottom: 1.5px solid #cfdccb; }
  table.meds td { padding: 2.4mm; border-bottom: 1px solid #e8efe6; vertical-align: top; }
  table.meds tr:nth-child(even) td { background: #f7faf6; }
  table.meds td.n { color: #9aab9c; width: 6mm; font-weight: 700; }
  table.meds td.med { font-weight: 700; }
  .dose { display: inline-block; white-space: nowrap; font-family: 'SF Mono', Menlo, Consolas, monospace; font-weight: 700; background: ${BRAND.soft}; color: ${BRAND.green}; border-radius: 3px; padding: .3mm 1.6mm; }
  ul.adv { margin: 0; padding: 0; list-style: none; }
  ul.adv li { padding: 1.2mm 0 1.2mm 5mm; position: relative; font-size: 12.5px; }
  ul.adv li::before { content: ''; position: absolute; left: 0; top: 3.1mm; width: 2mm; height: 2mm; border-radius: 50%; background: ${BRAND.gold}; }
  .followup { margin-top: 2mm; display: inline-flex; gap: 2mm; align-items: center; background: #fff6e0; border: 1px solid #f3d99a; color: #7a5410; border-radius: 6px; padding: 1.6mm 3mm; font-weight: 700; font-size: 12px; }
  .sign { display: flex; justify-content: flex-end; margin-top: 8mm; }
  .sign-box { width: 62mm; text-align: center; }
  .sign-box img { max-height: 22mm; max-width: 54mm; display: block; margin: 0 auto -1mm; }
  .sign-line { border-top: 1px solid #b9c7b6; padding-top: 1.6mm; font-weight: 700; font-size: 12.5px; }
  .sign-sub { font-size: 10px; color: ${BRAND.muted}; }
  .dsig { font-size: 8.5px; color: ${BRAND.leaf}; margin-top: 1mm; letter-spacing: .4px; }
  .qr svg { width: 100%; height: 100%; display: block; }
`;

interface Prepared {
  meds: MedicineLine[];
  advice: string[];
  followUp: string | null;
  ageSex: string;
  date: string;
}

function prepare(v: PrescriptionView): Prepared {
  const advice = v.advice.split('\n').map((l) => l.replace(/^\s*(\d+[.)]|[-•*])\s*/, '').trim()).filter(Boolean);
  // "Review after 20 days" / "Follow up in 4 weeks" gets its own highlighted line.
  const fi = advice.findIndex((l) => /^(review|follow[\s-]?up|revisit|next visit)\b/i.test(l));
  const followUp = fi >= 0 ? advice.splice(fi, 1)[0] : null;
  const age = (v.patient.age ?? '').trim();
  const g = (v.patient.gender ?? '').trim();
  return {
    meds: v.medicines.filter((m) => m.name?.trim()),
    advice,
    followUp,
    ageSex: [age && (/^\d+$/.test(age) ? `${age} yrs` : age), g].filter(Boolean).join(' · ') || '—',
    date: ddmmyyyy(v.date),
  };
}

function medsTable(meds: MedicineLine[]): string {
  if (!meds.length) return '<div class="text" style="color:#7a8a7d">No medicines prescribed.</div>';
  // Only show the columns that have something in them.
  const has = (k: keyof MedicineLine) => meds.some((m) => (m[k] ?? '').trim());
  const cols: [keyof MedicineLine, string][] = (
    [['dosage', 'Dose'], ['frequency', 'When'], ['duration', 'Duration'], ['notes', 'Notes']] as [keyof MedicineLine, string][]
  ).filter(([k]) => has(k));
  const cell = (m: MedicineLine, k: keyof MedicineLine) =>
    k === 'frequency' && m.frequency ? `<span class="dose">${esc(m.frequency)}</span>` : esc(m[k]);
  return `<table class="meds"><thead><tr><th></th><th>Medicine</th>${cols.map(([, l]) => `<th>${l}</th>`).join('')}</tr></thead><tbody>
    ${meds
      .map((m, i) => `<tr><td class="n">${i + 1}</td><td class="med">${esc(m.name)}</td>${cols.map(([k]) => `<td>${cell(m, k)}</td>`).join('')}</tr>`)
      .join('')}
  </tbody></table>`;
}

function clinicalBlocks(v: PrescriptionView, p: Prepared): string {
  return `
    ${v.impression ? `<div class="block"><h3>Impression</h3><div class="text">${multiline(v.impression)}</div></div>` : ''}
    ${v.progression ? `<div class="block"><h3>Progression</h3><div class="text">${multiline(v.progression)}</div></div>` : ''}
    <div class="block"><h3><span class="rx-sym">℞</span>Medicines</h3>${medsTable(p.meds)}</div>
    ${
      p.advice.length || p.followUp
        ? `<div class="block"><h3>Advice</h3>${p.advice.length ? `<ul class="adv">${p.advice.map((a) => `<li>${esc(a)}</li>`).join('')}</ul>` : ''}${
            p.followUp ? `<div class="followup">↻ ${esc(p.followUp)}</div>` : ''
          }</div>`
        : ''
    }`;
}

function signature(v: PrescriptionView, p: Prepared): string {
  const d = v.doctor;
  return `<div class="sign"><div class="sign-box">
    ${d.signature_url ? `<img src="${esc(d.signature_url)}" alt="">` : '<div style="height:16mm"></div>'}
    <div class="sign-line">${esc(d.display_name)}</div>
    ${d.role ? `<div class="sign-sub">${esc(d.role)}</div>` : ''}
    ${d.reg_no ? `<div class="sign-sub">${esc(d.reg_no)}</div>` : ''}
    ${d.signature_url ? `<div class="dsig">Digitally signed · ${p.date}</div>` : ''}
  </div></div>`;
}

/** Modern: white page, logo + doctor header with a green→gold rule, patient card, medicines table. */
function renderModern(v: PrescriptionView): string {
  const d = v.doctor;
  const c = config.clinic;
  const p = prepare(v);
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(v.prescriptionId)}</title><style>${SHARED_CSS}
  .page { width: 210mm; min-height: 297mm; display: flex; flex-direction: column; padding: 13mm 15mm 0; }
  .head { display: flex; justify-content: space-between; align-items: center; }
  .head .logo img { width: 40mm; height: auto; display: block; }
  .head .doc { text-align: right; }
  .doc .name { font-size: 20px; font-weight: 800; color: ${BRAND.green}; letter-spacing: .2px; }
  .doc .line { font-size: 11.5px; color: ${BRAND.muted}; }
  .doc .hl { font-size: 11.5px; font-weight: 700; color: #b8862a; }
  .doc .reg { display: inline-block; margin-top: 1.2mm; font-size: 10px; font-weight: 700; color: ${BRAND.green}; background: ${BRAND.soft}; border-radius: 3px; padding: .4mm 2mm; }
  .rule { height: 1.2mm; border-radius: 1mm; margin: 5mm 0 6mm; background: linear-gradient(90deg, ${BRAND.green}, ${BRAND.leaf} 55%, ${BRAND.gold}); }
  .card { display: grid; grid-template-columns: 2.2fr 1fr 1fr 1.2fr; gap: 3mm 5mm; background: #f6f9f5; border: 1px solid #e1eadf; border-radius: 3mm; padding: 4mm 5mm; }
  .card .v { font-size: 13px; font-weight: 700; margin-top: .4mm; }
  .card .v.big { font-size: 15px; }
  .card .contact { grid-column: 1 / -1; font-size: 10.5px; color: ${BRAND.muted}; border-top: 1px dashed #d5e0d2; padding-top: 2mm; }
  .content { flex: 1; padding-top: 6mm; }
  .block { margin-bottom: 6mm; }
  .foot { margin: 0 -15mm; padding: 4mm 15mm; border-top: 1px solid #e1eadf; display: flex; align-items: center; gap: 5mm; font-size: 10.5px; color: ${BRAND.muted}; }
  .foot .qr { width: 16mm; height: 16mm; flex: none; }
  .foot .items { flex: 1; display: flex; flex-wrap: wrap; gap: 1.2mm 6mm; }
  .foot .items b { color: ${BRAND.green}; }
  .foot .rx { font-family: 'SF Mono', Menlo, monospace; font-size: 9.5px; }
</style></head><body><div class="page">
  <div class="head">
    <div class="logo">${LOGO_HTML}</div>
    <div class="doc">
      <div class="name">${esc(d.display_name)}</div>
      ${d.role ? `<div class="line">${esc(d.role)}</div>` : ''}
      ${d.designation ? `<div class="line">${esc(d.designation)}</div>` : ''}
      ${d.highlight ? `<div class="hl">${esc(d.highlight)}</div>` : ''}
      ${d.reg_no ? `<div class="reg">${esc(d.reg_no)}</div>` : ''}
    </div>
  </div>
  <div class="rule"></div>
  <div class="card">
    <div><div class="lbl">Patient</div><div class="v big">${esc(v.patient.name)}</div></div>
    <div><div class="lbl">Age · Sex</div><div class="v">${esc(p.ageSex)}</div></div>
    <div><div class="lbl">Patient ID</div><div class="v">${esc(v.patient.patientId ?? '—')}</div></div>
    <div><div class="lbl">Date</div><div class="v">${p.date}</div></div>
    ${
      v.patient.phone || v.patient.email
        ? `<div class="contact">${[v.patient.phone, v.patient.email].filter(Boolean).map(esc).join('  ·  ')}</div>`
        : ''
    }
  </div>
  <div class="content">
    ${clinicalBlocks(v, p)}
    ${signature(v, p)}
  </div>
  <div class="foot">
    ${v.qrSvg ? `<div class="qr">${v.qrSvg}</div>` : ''}
    <div class="items">
      ${c.phone ? `<span><b>☎</b> ${esc(c.phone)}</span>` : ''}
      ${c.email ? `<span><b>✉</b> ${esc(c.email)}</span>` : ''}
      ${c.entity ? `<span><b>⌂</b> ${esc(c.entity)}</span>` : ''}
      ${c.social ? `<span>${esc(c.social)}</span>` : ''}
    </div>
    <div class="rx">${esc(v.prescriptionId)}</div>
  </div>
</div></body></html>`;
}

/** Sidebar: green column with logo, doctor and clinic details; prescription on the right. */
function renderSidebar(v: PrescriptionView): string {
  const d = v.doctor;
  const c = config.clinic;
  const p = prepare(v);
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(v.prescriptionId)}</title><style>${SHARED_CSS}
  .page { width: 210mm; min-height: 297mm; display: flex; }
  .side { width: 60mm; background: ${BRAND.green}; color: #e8efe5; padding: 10mm 7mm; display: flex; flex-direction: column; gap: 6mm; position: relative; }
  .side::after { content: ''; position: absolute; top: 0; bottom: 0; right: 0; width: 1.6mm; background: linear-gradient(${BRAND.gold}, ${BRAND.sage}); }
  .side .logo { background: #fff; border-radius: 3mm; padding: 3mm; }
  .side .logo img { width: 100%; height: auto; display: block; }
  .side .name { font-size: 15px; font-weight: 800; color: #fff; line-height: 1.3; }
  .side .line { font-size: 10.5px; color: #cfdccb; }
  .side .hl { font-size: 10.5px; font-weight: 700; color: ${BRAND.gold}; margin-top: .6mm; }
  .side .reg { margin-top: 2mm; display: inline-block; font-size: 9.5px; border: 1px solid #6f8c72; border-radius: 3px; padding: .4mm 1.8mm; color: #e8efe5; }
  .side .sl { font-size: 8.5px; letter-spacing: 1.4px; text-transform: uppercase; color: #9fb79f; font-weight: 700; margin-bottom: 1mm; }
  .side .ci { font-size: 10.5px; color: #e8efe5; word-break: break-word; margin-bottom: 1mm; }
  .side .spacer { flex: 1; }
  .side .qr { background: #fff; padding: 1.6mm; width: 24mm; height: 24mm; border-radius: 2mm; }
  .side .social { font-size: 9px; color: #b9cbb6; }
  .main { flex: 1; padding: 12mm 13mm 10mm 11mm; display: flex; flex-direction: column; }
  .top { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 2px solid ${BRAND.green}; padding-bottom: 3mm; }
  .top .title { font-size: 22px; font-weight: 800; color: ${BRAND.green}; letter-spacing: .3px; }
  .top .meta { text-align: right; font-size: 11px; color: ${BRAND.muted}; }
  .top .meta b { color: ${BRAND.ink}; font-size: 12.5px; }
  .pt { margin: 5mm 0 6mm; display: grid; grid-template-columns: 1fr auto; gap: 1mm 6mm; }
  .pt .pname { font-size: 17px; font-weight: 800; }
  .pt .pmeta { font-size: 11px; color: ${BRAND.muted}; }
  .pt .pid { text-align: right; align-self: center; font-family: 'SF Mono', Menlo, monospace; font-size: 11px; background: ${BRAND.soft}; color: ${BRAND.green}; border-radius: 3px; padding: 1mm 2.4mm; font-weight: 700; }
  .content { flex: 1; }
  .block { margin-bottom: 6mm; }
</style></head><body><div class="page">
  <aside class="side">
    <div class="logo">${LOGO_HTML}</div>
    <div>
      <div class="name">${esc(d.display_name)}</div>
      ${d.role ? `<div class="line">${esc(d.role)}</div>` : ''}
      ${d.designation ? `<div class="line">${esc(d.designation)}</div>` : ''}
      ${d.highlight ? `<div class="hl">${esc(d.highlight)}</div>` : ''}
      ${d.reg_no ? `<div class="reg">${esc(d.reg_no)}</div>` : ''}
    </div>
    <div>
      <div class="sl">Contact</div>
      ${c.phone ? `<div class="ci">${esc(c.phone)}</div>` : ''}
      ${c.email ? `<div class="ci">${esc(c.email)}</div>` : ''}
      ${c.entity ? `<div class="ci">${esc(c.entity)}</div>` : ''}
    </div>
    <div class="spacer"></div>
    ${v.qrSvg ? `<div class="qr">${v.qrSvg}</div>` : ''}
    ${c.social ? `<div class="social">${esc(c.social)}</div>` : ''}
  </aside>
  <main class="main">
    <div class="top">
      <div class="title">Prescription</div>
      <div class="meta"><b>${p.date}</b><br>${esc(v.prescriptionId)}</div>
    </div>
    <div class="pt">
      <div class="pname">${esc(v.patient.name)}</div>
      <div class="pid">${esc(v.patient.patientId ?? '—')}</div>
      <div class="pmeta">${[p.ageSex, v.patient.phone, v.patient.email].filter((x) => x && x !== '—').map((x) => esc(x)).join('  ·  ')}</div>
    </div>
    <div class="content">${clinicalBlocks(v, p)}</div>
    ${signature(v, p)}
  </main>
</div></body></html>`;
}
