import { useEffect, useState } from 'react';
import { api, type Draft, type HistoryItem, type MedLine, type Medicine, type Patient } from '../api';
import type { ToastKind } from './Toast';
import { fmtWhen, statusLabel } from './PatientCard';

const blank = (): MedLine => ({ name: '', dosage: '', frequency: '', duration: '', notes: '' });

interface Props {
  patient: Patient;
  medicines: Medicine[];
  isAdmin: boolean;
  onClose: () => void;
  onChanged: () => void;
  toast: (msg: string, kind?: ToastKind) => void;
}

export function PrescriptionDrawer({ patient: p, medicines, isAdmin, onClose, onChanged, toast }: Props) {
  const [impression, setImpression] = useState('');
  const [advice, setAdvice] = useState('');
  const [meds, setMeds] = useState<MedLine[]>([blank()]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<'' | 'draft' | 'preview' | 'send'>('');
  const [confirm, setConfirm] = useState(false);

  useEffect(() => {
    let live = true;
    setLoading(true);
    Promise.all([
      api.draft(p.bookingId),
      p.patientId ? api.history(p.patientId, p.bookingId) : Promise.resolve([]),
    ])
      .then(([d, h]) => {
        if (!live) return;
        setDraft(d.draft);
        setPdfUrl(d.pdfUrl);
        setImpression(d.draft?.impression ?? '');
        setAdvice(d.draft?.advice ?? '');
        setMeds(d.draft?.medicines?.length ? d.draft.medicines.map((m) => ({ ...blank(), ...m })) : [blank()]);
        setHistory(h);
      })
      .catch((e) => toast(e.message, 'error'))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [p.bookingId, p.patientId, toast]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !confirm && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, confirm]);

  const body = () => ({ bookingId: p.bookingId, impression, advice, medicines: meds.filter((m) => m.name.trim()) });
  const setMed = (i: number, k: keyof MedLine, v: string) =>
    setMeds((ms) => ms.map((m, j) => (j === i ? { ...m, [k]: v } : m)));

  async function saveDraft() {
    setBusy('draft');
    try {
      const r = await api.save('draft', body());
      setDraft((d) => ({ ...(d ?? ({} as Draft)), prescriptionId: r.prescriptionId, status: 'Draft' }));
      toast(`Draft saved · ${r.prescriptionId}`);
      onChanged();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy('');
    }
  }

  async function preview() {
    const w = window.open('', '_blank');
    setBusy('preview');
    try {
      const blob = await api.preview(p.bookingId, body());
      const url = URL.createObjectURL(blob);
      if (w) w.location.href = url;
      else window.location.href = url;
    } catch (e) {
      w?.close();
      toast((e as Error).message, 'error');
    } finally {
      setBusy('');
    }
  }

  async function send() {
    setConfirm(false);
    setBusy('send');
    try {
      const r = await api.save('send', body());
      setDraft((d) => ({ ...(d ?? ({} as Draft)), prescriptionId: r.prescriptionId, status: 'Sent' }));
      setPdfUrl(r.pdfUrl ?? null);
      toast(`Prescription ${r.prescriptionId} sent to ${p.email}`);
      onChanged();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy('');
    }
  }

  const s = statusLabel({ status: p.status, rxStatus: draft?.status ?? p.rxStatus });
  const empty = !impression.trim() && !advice.trim() && !meds.some((m) => m.name.trim());

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside className="drawer" role="dialog" aria-label={`Prescription for ${p.name}`}>
        <div className="drawer-head">
          <div>
            <div className="drawer-title">
              {p.name}
              {p.patientType && <span className={`badge ${p.patientType.toLowerCase()}`}>{p.patientType}</span>}
            </div>
            <div className="drawer-sub">
              <span className="mono">{p.patientId ?? 'No ID'}</span>
              {draft?.prescriptionId && <span className="mono">{draft.prescriptionId}</span>}
              <span className={`status ${s.cls}`}>{s.text}</span>
            </div>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <div className="drawer-body">
          <dl className="facts">
            <div><dt>Age / Gender</dt><dd>{[p.age, p.gender].filter(Boolean).join(' / ') || '—'}</dd></div>
            <div><dt>Phone</dt><dd>{p.phone ?? '—'}</dd></div>
            <div><dt>Email</dt><dd>{p.email ?? '—'}</dd></div>
            <div><dt>Consultation</dt><dd>{fmtWhen(p.startTime)}</dd></div>
            <div><dt>Doctor</dt><dd>{p.doctorName ?? '—'}</dd></div>
            <div>
              <dt>Meet link</dt>
              <dd>{p.meetLink ? <a href={p.meetLink} target="_blank" rel="noreferrer">Join call</a> : '—'}</dd>
            </div>
          </dl>
          {p.description && <p className="desc">{p.description}</p>}
          {pdfUrl && (
            <a className="pdf-link" href={pdfUrl} target="_blank" rel="noreferrer">
              📄 View sent prescription PDF
            </a>
          )}

          {history.length > 0 && (
            <details className="history">
              <summary>Previous consultations ({history.length})</summary>
              {history.map((h) => (
                <div key={h.id} className="history-item">
                  <div className="history-head">
                    <b>{fmtWhen(h.consultationAt ?? h.createdAt)}</b> · {h.doctorName} · <span className="mono">{h.prescriptionId}</span> ·{' '}
                    {h.status}
                    {h.pdfUrl && <a href={h.pdfUrl} target="_blank" rel="noreferrer"> PDF</a>}
                  </div>
                  {h.impression && <div className="small">{h.impression}</div>}
                  {!!h.medicines?.length && (
                    <div className="small muted">{h.medicines.map((m) => `${m.name} ${m.dosage ?? ''}`.trim()).join(', ')}</div>
                  )}
                </div>
              ))}
            </details>
          )}

          {loading ? (
            <div className="muted center-pad">Loading…</div>
          ) : (
            <form className="rx-form" onSubmit={(e) => e.preventDefault()}>
              <label>
                <span>Clinical impression</span>
                <textarea rows={3} value={impression} onChange={(e) => setImpression(e.target.value)} placeholder="e.g. Generalised anxiety disorder, moderate" />
              </label>

              <div className="meds-head">
                <span>Medicines</span>
                <button type="button" className="btn ghost sm" onClick={() => setMeds((m) => [...m, blank()])}>
                  + Add medicine
                </button>
              </div>
              <datalist id="medicine-list">
                {medicines.map((m) => (
                  <option key={m.id} value={m.name}>{m.notes ?? ''}</option>
                ))}
              </datalist>
              <div className="meds">
                {meds.map((m, i) => (
                  <div className="med-row" key={i}>
                    <input className="med-name" list="medicine-list" placeholder="Medicine" value={m.name} onChange={(e) => setMed(i, 'name', e.target.value)} />
                    <input placeholder="Dosage" value={m.dosage} onChange={(e) => setMed(i, 'dosage', e.target.value)} />
                    <input placeholder="Frequency" value={m.frequency} onChange={(e) => setMed(i, 'frequency', e.target.value)} />
                    <input placeholder="Duration" value={m.duration} onChange={(e) => setMed(i, 'duration', e.target.value)} />
                    <input className="med-notes" placeholder="Notes" value={m.notes} onChange={(e) => setMed(i, 'notes', e.target.value)} />
                    <button type="button" className="icon-btn sm" aria-label="Remove" onClick={() => setMeds((ms) => (ms.length > 1 ? ms.filter((_, j) => j !== i) : [blank()]))}>
                      ×
                    </button>
                  </div>
                ))}
              </div>

              <label>
                <span>Advice</span>
                <textarea rows={3} value={advice} onChange={(e) => setAdvice(e.target.value)} placeholder="Sleep hygiene, follow-up in 4 weeks…" />
              </label>
            </form>
          )}
        </div>

        <div className="drawer-foot">
          {isAdmin && <div className="small muted acting">Will be issued under <b>{p.doctorName ?? 'the treating doctor'}</b></div>}
          <div className="actions">
            <button className="btn ghost" disabled={!!busy || loading} onClick={saveDraft}>
              {busy === 'draft' ? 'Saving…' : 'Save draft'}
            </button>
            <button className="btn ghost" disabled={!!busy || loading} onClick={preview}>
              {busy === 'preview' ? 'Rendering…' : 'Preview PDF'}
            </button>
            <button className="btn primary" disabled={!!busy || loading || empty || !p.email || p.status === 'CANCELLED'} onClick={() => setConfirm(true)}>
              {busy === 'send' ? 'Sending…' : draft?.status === 'Sent' ? 'Re-send' : 'Approve & send'}
            </button>
          </div>
        </div>

        {confirm && (
          <div className="confirm" role="alertdialog">
            <div className="confirm-box">
              <h3>Send prescription?</h3>
              <p>
                A PDF signed by <b>{p.doctorName}</b> will be emailed to <b>{p.email}</b>. This can’t be undone.
              </p>
              <div className="actions">
                <button className="btn ghost" onClick={() => setConfirm(false)}>Cancel</button>
                <button className="btn primary" onClick={send}>Approve & send</button>
              </div>
            </div>
          </div>
        )}
      </aside>
    </div>
  );
}
