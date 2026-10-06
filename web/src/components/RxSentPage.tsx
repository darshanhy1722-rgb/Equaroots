import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, type Doctor, type SentRx } from '../api';
import { istDay } from '../dates';
import type { ToastKind } from './Toast';

const fmt = (iso: string | null, withTime = true) =>
  iso
    ? new Date(iso).toLocaleString('en-IN', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        ...(withTime ? { hour: 'numeric', minute: '2-digit' } : {}),
        timeZone: 'Asia/Kolkata',
      })
    : '—';

const slot = (r: SentRx) => {
  if (!r.consultationAt) return '—';
  const t = (d: string) => new Date(d).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' });
  return `${fmt(r.consultationAt, false)}, ${t(r.consultationAt)}${r.consultationEnd ? ` – ${t(r.consultationEnd)}` : ''}`;
};

/** "Prescriptions" tab: every sent prescription with full details and its PDF. */
export function RxSentPage({
  isAdmin,
  doctors,
  toast,
}: {
  isAdmin: boolean;
  doctors: Doctor[];
  toast: (m: string, k?: ToastKind) => void;
}) {
  const [list, setList] = useState<SentRx[] | null>(null);
  const [doctorId, setDoctorId] = useState<number | null>(null);
  const [q, setQ] = useState('');
  const [period, setPeriod] = useState<'all' | 'week' | 'month'>('all');
  const [sel, setSel] = useState<SentRx | null>(null);

  const load = useCallback(() => {
    api.sentPrescriptions(isAdmin ? doctorId : null).then(setList).catch((e) => toast(e.message, 'error'));
  }, [isAdmin, doctorId, toast]);
  useEffect(() => {
    load();
  }, [load]);

  const inPeriod = useCallback(
    (r: SentRx, p: typeof period) => {
      if (p === 'all') return true;
      if (!r.sentAt) return false;
      const days = p === 'week' ? 7 : 30;
      return Date.now() - new Date(r.sentAt).getTime() < days * 864e5;
    },
    [],
  );
  const counts = useMemo(
    () => ({
      all: list?.length ?? 0,
      week: list?.filter((r) => inPeriod(r, 'week')).length ?? 0,
      month: list?.filter((r) => inPeriod(r, 'month')).length ?? 0,
      today: list?.filter((r) => r.sentAt && istDay(r.sentAt) === istDay(new Date())).length ?? 0,
    }),
    [list, inPeriod],
  );
  const visible = useMemo(() => {
    const n = q.trim().toLowerCase();
    return (list ?? []).filter(
      (r) =>
        inPeriod(r, period) &&
        (!n ||
          [r.patientName, r.patientId, r.prescriptionId, r.email, r.phone, r.doctorName, r.impression]
            .filter(Boolean)
            .some((x) => String(x).toLowerCase().includes(n))),
    );
  }, [list, q, period, inPeriod]);

  useEffect(() => {
    if (sel && !visible.some((r) => r.bookingId === sel.bookingId)) setSel(null);
  }, [visible, sel]);

  return (
    <main className="rx-page">
      <div className="tiles rx-tiles">
        {(
          [
            ['all', counts.all, 'Prescriptions sent', 'all time'],
            ['month', counts.month, 'Last 30 days', 'sent'],
            ['week', counts.week, 'Last 7 days', `${counts.today} today`],
          ] as [typeof period, number, string, string][]
        ).map(([k, n, l, sub]) => (
          <button key={k} className={`tile ${period === k ? 'on' : ''}`} onClick={() => setPeriod(k)}>
            <span className="tile-n">{n}</span>
            <span className="tile-l">{l}</span>
            <span className="tile-s">{sub}</span>
          </button>
        ))}
      </div>
      <div className="toolbar">
        <div className="search">
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden>
            <circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" strokeWidth="2" />
            <path d="M20 20l-3.5-3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          <input placeholder="Search patient, ER ID, RX number, doctor or diagnosis" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        {isAdmin && (
          <select className="doctor-filter" value={doctorId ?? ''} onChange={(e) => setDoctorId(e.target.value ? Number(e.target.value) : null)}>
            <option value="">All doctors</option>
            {doctors.map((d) => (
              <option key={d.id} value={d.id}>{d.display_name}</option>
            ))}
          </select>
        )}
        <button className="btn ghost sm refresh" onClick={load} title="Refresh">↻</button>
      </div>

      <div className={`rx-split ${sel ? 'has-sel' : ''}`}>
        <div className="rx-list">
          {list === null ? (
            <div className="empty muted">Loading…</div>
          ) : visible.length === 0 ? (
            <div className="empty muted">No prescriptions sent{q ? ' match' : ' yet'}.</div>
          ) : (
            visible.map((r) => (
              <button key={r.bookingId} className={`rx-item ${sel?.bookingId === r.bookingId ? 'on' : ''}`} onClick={() => setSel(r)}>
                <div className="rx-item-top">
                  <span className="rx-item-name">{r.patientName}</span>
                  <span className="mono muted">{r.patientId ?? ''}</span>
                </div>
                <div className="rx-item-sub">
                  {r.impression ? <span className="rx-dx">{r.impression}</span> : <span className="muted">{r.imported ? 'Imported from Sheet' : '—'}</span>}
                </div>
                <div className="rx-item-meta">
                  <span>{r.doctorName ?? '—'}</span>
                  <span>Sent {fmt(r.sentAt)}</span>
                </div>
              </button>
            ))
          )}
        </div>

        {sel && <RxDetail r={sel} onClose={() => setSel(null)} />}
      </div>
    </main>
  );
}

function RxDetail({ r, onClose }: { r: SentRx; onClose: () => void }) {
  const pdf = r.externalPdfUrl ?? (r.hasPdf ? api.pdfUrl(r.bookingId) : null);
  const meds = (r.medicines ?? []).filter((m) => m.name?.trim());
  const advice = (r.advice ?? '').split('\n').map((l) => l.trim()).filter(Boolean);
  return (
    <aside className="rx-detail">
      <div className="rx-detail-head">
        <div>
          <div className="drawer-title">{r.patientName}</div>
          <div className="drawer-sub">
            {r.patientId && <span className="mono">{r.patientId}</span>}
            {r.prescriptionId && <span className="mono">{r.prescriptionId}</span>}
            <span className="status sent">Rx sent</span>
          </div>
        </div>
        <button className="icon-btn" onClick={onClose} aria-label="Close">×</button>
      </div>

      <dl className="facts">
        <div><dt>Doctor</dt><dd>{r.doctorName ?? '—'}</dd></div>
        <div><dt>Consultation</dt><dd>{slot(r)}</dd></div>
        <div><dt>Sent</dt><dd>{fmt(r.sentAt)}</dd></div>
        <div><dt>Sent to</dt><dd>{r.email ?? '—'}</dd></div>
        <div><dt>Phone</dt><dd>{r.phone ?? '—'}</dd></div>
        <div><dt>Age / Gender</dt><dd>{[r.age, r.gender].filter(Boolean).join(' / ') || '—'}</dd></div>
      </dl>

      {r.imported ? (
        <p className="small muted">Imported from the old Google Sheet — only the PDF link was recorded there.</p>
      ) : (
        <div className="rx-body">
          {r.impression && (<><h4>Impression</h4><p>{r.impression}</p></>)}
          {r.progression && (<><h4>Progression</h4><p>{r.progression}</p></>)}
          <h4>Medicines</h4>
          {meds.length ? (
            <table className="rx-meds">
              <thead><tr><th></th><th>Medicine</th><th>Dose</th><th>When</th><th>Duration</th><th>Notes</th></tr></thead>
              <tbody>
                {meds.map((m, i) => (
                  <tr key={i}>
                    <td className="muted">{i + 1}</td><td><b>{m.name}</b></td><td>{m.dosage}</td>
                    <td>{m.frequency && <span className="dose-chip">{m.frequency}</span>}</td><td>{m.duration}</td><td>{m.notes}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="muted">No medicines.</p>
          )}
          {advice.length > 0 && (<><h4>Advice</h4><ul>{advice.map((a, i) => <li key={i}>{a}</li>)}</ul></>)}
        </div>
      )}

      <div className="rx-pdf-actions">
        {pdf ? (
          <>
            <a className="btn primary sm" href={pdf} target="_blank" rel="noreferrer">Open PDF ↗</a>
            {!r.externalPdfUrl && <a className="btn ghost sm" href={api.pdfUrl(r.bookingId, true)}>Download</a>}
          </>
        ) : (
          <span className="muted small">No PDF stored for this prescription.</span>
        )}
      </div>
      {pdf && !r.externalPdfUrl && <iframe className="rx-pdf" src={pdf} title={`Prescription ${r.prescriptionId ?? ''}`} />}
    </aside>
  );
}
