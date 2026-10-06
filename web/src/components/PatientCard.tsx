import type { Patient } from '../api';
import { relativeDay } from '../dates';

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

export function PatientCard({ p, showDoctor, fresh, onOpen }: { p: Patient; showDoctor: boolean; fresh?: boolean; onOpen: () => void }) {
  const s = statusLabel(p);
  const rel = relativeDay(p.startTime);
  return (
    <button className={`card ${fresh ? 'fresh' : ''}`} onClick={onOpen}>
      {fresh && <span className="fresh-tag">● New booking</span>}
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
        <span className={`when ${rel ? 'soon' : ''}`}>
          {rel ? `${rel}, ${new Date(p.startTime!).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' })}` : fmtWhen(p.startTime)}
        </span>
      </div>
      {showDoctor && <div className="card-doctor">{p.doctorName ?? 'Unassigned doctor'}</div>}
    </button>
  );
}
