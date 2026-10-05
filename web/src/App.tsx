import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, ApiError, type Bootstrap, type Patient } from './api';
import { Login, NotSetUp } from './components/Login';
import { PatientCard } from './components/PatientCard';
import { PrescriptionDrawer } from './components/PrescriptionDrawer';
import { Toast, useToast } from './components/Toast';

type Filter = 'all' | 'New' | 'Existing' | 'pending';

export default function App() {
  const [boot, setBoot] = useState<Bootstrap | null>(null);
  const [state, setState] = useState<'loading' | 'signed-out' | 'ready'>('loading');
  const [patients, setPatients] = useState<Patient[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [doctorId, setDoctorId] = useState<number | null>(null);
  const [open, setOpen] = useState<Patient | null>(null);
  const toast = useToast();

  const loadBoot = useCallback(async () => {
    try {
      setBoot(await api.bootstrap());
      setState('ready');
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setState('signed-out');
      else toast.show(String((e as Error).message), 'error');
    }
  }, [toast]);

  useEffect(() => {
    loadBoot();
  }, [loadBoot]);

  const loadPatients = useCallback(async () => {
    if (!boot?.authorized) return;
    setLoadingList(true);
    try {
      setPatients(await api.patients(boot.isAdmin ? doctorId : null));
    } catch (e) {
      toast.show((e as Error).message, 'error');
    } finally {
      setLoadingList(false);
    }
  }, [boot, doctorId, toast]);

  useEffect(() => {
    loadPatients();
  }, [loadPatients]);

  const counts = useMemo(
    () => ({
      all: patients.length,
      New: patients.filter((p) => p.patientType === 'New').length,
      Existing: patients.filter((p) => p.patientType === 'Existing').length,
      pending: patients.filter(isPendingRx).length,
    }),
    [patients],
  );

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const digits = needle.replace(/\D/g, '');
    return patients.filter((p) => {
      if (filter === 'New' && p.patientType !== 'New') return false;
      if (filter === 'Existing' && p.patientType !== 'Existing') return false;
      if (filter === 'pending' && !isPendingRx(p)) return false;
      if (!needle) return true;
      return (
        p.name.toLowerCase().includes(needle) ||
        (p.email ?? '').toLowerCase().includes(needle) ||
        (p.patientId ?? '').toLowerCase().includes(needle) ||
        (digits.length >= 3 && (p.phone ?? '').replace(/\D/g, '').includes(digits))
      );
    });
  }, [patients, q, filter]);

  if (state === 'loading') return <div className="center muted">Loading…</div>;
  if (state === 'signed-out') return <Login onSignedIn={loadBoot} />;
  if (boot && !boot.authorized) return <NotSetUp email={boot.email} onSignOut={() => signOut()} />;

  async function signOut() {
    await api.logout().catch(() => {});
    setBoot(null);
    setPatients([]);
    setState('signed-out');
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <Logo />
          <div>
            <div className="brand-name">EquaRoots</div>
            <div className="brand-sub">
              {boot!.isAdmin ? 'Admin — all doctors, view & send for anyone' : 'Doctor Dashboard'}
            </div>
          </div>
        </div>
        <div className="who">
          <div className="who-text">
            <div className="who-name">{boot!.doctor?.display_name ?? (boot!.isAdmin ? 'Admin' : '')}</div>
            <div className="who-email">{boot!.email}</div>
          </div>
          <button className="btn ghost sm" onClick={signOut}>
            Sign out
          </button>
        </div>
      </header>

      <div className="toolbar">
        <div className="search">
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden>
            <circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" strokeWidth="2" />
            <path d="M20 20l-3.5-3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          <input
            placeholder="Search name, email, phone or patient ID"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="Search patients"
          />
        </div>
        <div className="pills" role="tablist">
          {(
            [
              ['all', 'All'],
              ['New', 'New'],
              ['Existing', 'Existing'],
              ['pending', 'Pending Rx'],
            ] as [Filter, string][]
          ).map(([k, label]) => (
            <button key={k} className={`pill ${filter === k ? 'on' : ''}`} onClick={() => setFilter(k)} role="tab">
              {label}
              <span className="count">{counts[k]}</span>
            </button>
          ))}
        </div>
        {boot!.isAdmin && (
          <select
            className="doctor-filter"
            value={doctorId ?? ''}
            onChange={(e) => setDoctorId(e.target.value ? Number(e.target.value) : null)}
            aria-label="Filter by doctor"
          >
            <option value="">All doctors</option>
            {boot!.doctors.map((d) => (
              <option key={d.id} value={d.id}>
                {d.display_name}
              </option>
            ))}
          </select>
        )}
        <button className="btn ghost sm refresh" onClick={loadPatients} disabled={loadingList} title="Refresh">
          ↻
        </button>
      </div>

      <main className="list">
        {loadingList && !patients.length ? (
          <div className="empty muted">Loading patients…</div>
        ) : visible.length === 0 ? (
          <div className="empty muted">No patients match.</div>
        ) : (
          visible.map((p) => (
            <PatientCard key={p.bookingId} p={p} showDoctor={boot!.isAdmin} onOpen={() => setOpen(p)} />
          ))
        )}
      </main>

      {open && (
        <PrescriptionDrawer
          patient={open}
          medicines={boot!.medicines}
          isAdmin={boot!.isAdmin}
          onClose={() => setOpen(null)}
          onChanged={loadPatients}
          toast={toast.show}
        />
      )}
      <Toast state={toast.state} />
    </div>
  );
}

export function isPendingRx(p: Patient) {
  return p.status !== 'CANCELLED' && p.status !== 'Prescription Sent' && p.rxStatus !== 'Sent';
}

export function Logo() {
  return (
    <svg viewBox="0 0 32 32" width="34" height="34" aria-hidden>
      <rect width="32" height="32" rx="9" fill="#0f5c56" />
      <path
        d="M16 25V13m0 0c0-4 3-6 7-6 0 4-3 6-7 6zm0 3c0-3-2.5-5-6-5 0 3 2.5 5 6 5z"
        stroke="#fff"
        strokeWidth="2"
        fill="none"
        strokeLinecap="round"
      />
    </svg>
  );
}
