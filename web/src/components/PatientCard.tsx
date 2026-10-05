import type { Patient } from '../api';

export function fmtWhen(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'Asia/Kolkata',
  });
}

export function statusLabel(p: Pick<Patient, 'status' | 'rxStatus'>) {
  if (p.status === 'CANCELLED') return { text: 'Cancelled', cls: 'cancelled' };
  if (p.status === 'Prescription Sent' || p.rxStatus === 'Sent') return { text: 'Rx sent', cls: 'sent' };
  if (p.rxStatus === 'Draft') return { text: 'Draft saved', cls: 'draft' };
  return { text: 'Pending Rx', cls: 'pending' };
}

export function PatientCard({ p, showDoctor, onOpen }: { p: Patient; showDoctor: boolean; onOpen: () => void }) {
  const s = statusLabel(p);
  return (
    <button className="card" onClick={onOpen}>
      <div className="card-top">
        <div className="card-name">{p.name}</div>
        {p.patientType && <span className={`badge ${p.patientType.toLowerCase()}`}>{p.patientType}</span>}
      </div>
      <div className="card-meta">
        <span className="mono">{p.patientId ?? 'No ID'}</span>
        <span>{[p.age, p.gender].filter(Boolean).join(' · ') || '—'}</span>
        <span>{p.phone ?? '—'}</span>
      </div>
      <div className="card-foot">
        <span className={`status ${s.cls}`}>{s.text}</span>
        <span className="when">{fmtWhen(p.startTime)}</span>
      </div>
      {showDoctor && <div className="card-doctor">{p.doctorName ?? 'Unassigned doctor'}</div>}
    </button>
  );
}
