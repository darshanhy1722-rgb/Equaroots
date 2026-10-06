import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError, type Bootstrap, type Patient } from './api';
import { AdminPage } from './components/AdminPage';
import { Login, NotSetUp } from './components/Login';
import { PatientCard } from './components/PatientCard';
import { PrescriptionDrawer } from './components/PrescriptionDrawer';
import { SignatureModal } from './components/SignatureModal';
import { Toast, useToast } from './components/Toast';
import { relativeDay, sortForSection, whenOf, type When } from './dates';

type WhenFilter = 'all' | When | 'fresh';
const SECTIONS: [When, string][] = [
  ['today', 'Today'],
  ['upcoming', 'Upcoming'],
  ['past', 'Past'],
  ['nodate', 'No appointment date'],
];

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
  const [page, setPage] = useState<'patients' | 'admin'>('patients');
  const [signing, setSigning] = useState(false);
  const [when, setWhen] = useState<WhenFilter>('all');
  const [now, setNow] = useState(() => Date.now());
  const knownIds = useRef<Set<number> | null>(null);
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

  const loadPatients = useCallback(
    async (silent = false) => {
      if (!boot?.authorized) return;
      if (!silent) setLoadingList(true);
      try {
        const list = await api.patients(boot.isAdmin ? doctorId : null);
        const known = knownIds.current;
        if (known) {
          const arrived = list.filter((p) => !known.has(p.bookingId));
          if (arrived.length === 1) {
            const p = arrived[0];
            toast.show(`New booking: ${p.name}${p.startTime ? ` · ${relativeDay(p.startTime) || fmtShort(p.startTime)}` : ''}`, 'info');
          } else if (arrived.length > 1) toast.show(`${arrived.length} new bookings arrived`, 'info');
        }
        knownIds.current = new Set(list.map((p) => p.bookingId));
        setPatients(list);
        setNow(Date.now());
      } catch (e) {
        if (!silent) toast.show((e as Error).message, 'error');
      } finally {
        if (!silent) setLoadingList(false);
      }
    },
    [boot, doctorId, toast],
  );

  useEffect(() => {
    knownIds.current = null; // switching doctor filter isn't "new bookings"
    loadPatients();
  }, [loadPatients]);

  // Check for new bookings every minute while the tab is visible.
  useEffect(() => {
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') loadPatients(true);
    }, 60_000);
    return () => window.clearInterval(id);
  }, [loadPatients]);

  // "New in 24h" = arrived from Cal.id in the last 24 hours (Sheet imports don't count).
  const isFresh = useCallback((p: Patient) => p.fromCal && now - new Date(p.createdAt).getTime() < 864e5, [now]);

  // Cancelled bookings (they never get a patient ID) are hidden unless asked for.
  const [showCancelled, setShowCancelled] = useState(() => {
    try {
      return localStorage.getItem('er_show_cancelled') === '1';
    } catch {
      return false;
    }
  });
  const toggleCancelled = (v: boolean) => {
    setShowCancelled(v);
    try {
      localStorage.setItem('er_show_cancelled', v ? '1' : '0');
    } catch {
      /* per-browser preference only */
    }
  };
  const cancelledCount = useMemo(() => patients.filter((p) => p.status === 'CANCELLED').length, [patients]);
  const shown = useMemo(
    () => (showCancelled ? patients : patients.filter((p) => p.status !== 'CANCELLED')),
    [patients, showCancelled],
  );

  const counts = useMemo(
    () => ({
      all: shown.length,
      New: shown.filter((p) => p.patientType === 'New').length,
      Existing: shown.filter((p) => p.patientType === 'Existing').length,
      pending: shown.filter(isPendingRx).length,
    }),
    [shown],
  );

  const whenCounts = useMemo(() => {
    const active = shown.filter((p) => p.status !== 'CANCELLED');
    const c = { all: shown.length, today: 0, upcoming: 0, past: 0, nodate: 0, fresh: 0 };
    for (const p of active) c[whenOf(p)]++;
    c.fresh = shown.filter(isFresh).length;
    return c;
  }, [shown, isFresh]);

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const digits = needle.replace(/\D/g, '');
    return shown.filter((p) => {
      if (filter === 'New' && p.patientType !== 'New') return false;
      if (filter === 'Existing' && p.patientType !== 'Existing') return false;
      if (filter === 'pending' && !isPendingRx(p)) return false;
      if (when === 'fresh' && !isFresh(p)) return false;
      if (when !== 'all' && when !== 'fresh' && whenOf(p) !== when) return false;
      if (!needle) return true;
      return (
        p.name.toLowerCase().includes(needle) ||
        (p.email ?? '').toLowerCase().includes(needle) ||
        (p.patientId ?? '').toLowerCase().includes(needle) ||
        (digits.length >= 3 && (p.phone ?? '').replace(/\D/g, '').includes(digits))
      );
    });
  }, [shown, q, filter, when, isFresh]);

  const sections = useMemo(
    () =>
      SECTIONS.map(([k, label]) => ({ k, label, items: sortForSection(visible.filter((p) => whenOf(p) === k), k) })).filter(
        (s) => s.items.length,
      ),
    [visible],
  );

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
        {boot!.isAdmin && (
          <nav className="nav">
            <button className={page === 'patients' ? 'on' : ''} onClick={() => setPage('patients')}>Patients</button>
            <button className={page === 'admin' ? 'on' : ''} onClick={() => setPage('admin')}>Admin tools</button>
          </nav>
        )}
        <div className="who">
          {boot!.myDoctors.length > 0 && (
            <button className="btn ghost sm" onClick={() => setSigning(true)}>✍︎ My letterhead</button>
          )}
          <div className="who-text">
            <div className="who-name">{boot!.doctor?.display_name ?? (boot!.isAdmin ? 'Admin' : '')}</div>
            <div className="who-email">{boot!.email}</div>
          </div>
          <button className="btn ghost sm" onClick={signOut}>
            Sign out
          </button>
        </div>
      </header>

      {page === 'admin' && boot!.isAdmin ? (
        <AdminPage toast={toast.show} onDataChanged={loadBoot} />
      ) : (
      <>
      {boot!.myDoctors.some((d) => !d.hasSignature) && (
        <div className="banner">
          Add your digital signature so it’s printed on your prescriptions.
          <button className="btn primary sm" onClick={() => setSigning(true)}>Add signature</button>
        </div>
      )}
      <div className="tiles">
        {(
          [
            ['today', 'Today', 'appointments'],
            ['upcoming', 'Upcoming', 'after today'],
            ['fresh', 'New in 24h', 'booked in the last 24 hours'],
            ['past', 'Past', 'consultations'],
            ['all', 'All', 'bookings'],
          ] as [WhenFilter, string, string][]
        ).map(([k, label, sub]) => (
          <button key={k} className={`tile ${when === k ? 'on' : ''} ${k === 'fresh' && whenCounts.fresh ? 'hot' : ''}`} onClick={() => setWhen(k)}>
            <span className="tile-n">{whenCounts[k as keyof typeof whenCounts]}</span>
            <span className="tile-l">{label}</span>
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
        <label className={`toggle ${showCancelled ? 'on' : ''}`} title="Cancelled bookings have no patient ID">
          <input type="checkbox" checked={showCancelled} onChange={(e) => toggleCancelled(e.target.checked)} />
          Show cancelled <span className="count">{cancelledCount}</span>
        </label>
        <button className="btn ghost sm refresh" onClick={() => loadPatients()} disabled={loadingList} title="Refresh (also checks automatically every minute)">
          ↻
        </button>
      </div>

      <main className="list">
        {loadingList && !patients.length ? (
          <div className="empty muted">Loading patients…</div>
        ) : visible.length === 0 ? (
          <div className="empty muted">No patients match.</div>
        ) : (
          sections.map((sec) => (
            <section key={sec.k} className="day-section">
              <h2 className="section-h">
                {sec.label} <span className="count">{sec.items.length}</span>
              </h2>
              <div className="cards">
                {sec.items.map((p) => (
                  <PatientCard key={p.bookingId} p={p} showDoctor={boot!.isAdmin} fresh={isFresh(p)} onOpen={() => setOpen(p)} />
                ))}
              </div>
            </section>
          ))
        )}
      </main>
      </>
      )}

      {signing && (
        <SignatureModal
          doctors={boot!.myDoctors}
          toast={toast.show}
          onClose={() => setSigning(false)}
          onSaved={loadBoot}
        />
      )}
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

function fmtShort(iso: string) {
  return new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' });
}

export function isPendingRx(p: Patient) {
  return p.status !== 'CANCELLED' && p.status !== 'Prescription Sent' && p.rxStatus !== 'Sent';
}

export function Logo({ size = 40 }: { size?: number }) {
  return <img src="/favicon.png" width={size} height={size * 0.68} alt="EquaRoots" style={{ objectFit: 'contain' }} />;
}
