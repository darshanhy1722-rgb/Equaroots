import { useCallback, useEffect, useState } from 'react';
import { api, type AdminDoctor, type Medicine, type WebhookLog } from '../api';
import { SignatureModal } from './SignatureModal';
import type { ToastKind } from './Toast';

type Tab = 'doctors' | 'medicines' | 'webhooks' | 'import';
type Toast = (m: string, k?: ToastKind) => void;

export function AdminPage({ toast, onDataChanged }: { toast: Toast; onDataChanged: () => void }) {
  const [tab, setTab] = useState<Tab>('doctors');
  return (
    <main className="admin">
      <div className="tabs">
        {(
          [
            ['doctors', 'Doctors & signatures'],
            ['medicines', 'Medicines'],
            ['webhooks', 'Cal.id webhook log'],
            ['import', 'Import from Sheet'],
          ] as [Tab, string][]
        ).map(([k, label]) => (
          <button key={k} className={`tab ${tab === k ? 'on' : ''}`} onClick={() => setTab(k)}>
            {label}
          </button>
        ))}
      </div>
      {tab === 'doctors' && <DoctorsTab toast={toast} onDataChanged={onDataChanged} />}
      {tab === 'medicines' && <MedicinesTab toast={toast} onDataChanged={onDataChanged} />}
      {tab === 'webhooks' && <WebhooksTab toast={toast} />}
      {tab === 'import' && <ImportTab toast={toast} onDataChanged={onDataChanged} />}
    </main>
  );
}

const blankDoctor = { display_name: '', role: '', reg_no: '', email: '' };

function DoctorsTab({ toast, onDataChanged }: { toast: Toast; onDataChanged: () => void }) {
  const [doctors, setDoctors] = useState<AdminDoctor[]>([]);
  const [editing, setEditing] = useState<(typeof blankDoctor & { id?: number }) | null>(null);
  const [signing, setSigning] = useState<AdminDoctor | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => api.adminDoctors().then(setDoctors).catch((e) => toast(e.message, 'error')), [toast]);
  useEffect(() => {
    load();
  }, [load]);

  const emailCounts = doctors.reduce<Record<string, number>>((m, d) => ((m[d.email] = (m[d.email] ?? 0) + 1), m), {});

  async function save() {
    if (!editing) return;
    setBusy(true);
    try {
      const { id, ...body } = editing;
      if (id) await api.updateDoctor(id, body);
      else await api.createDoctor(body);
      toast(`${body.display_name} saved`);
      setEditing(null);
      await load();
      onDataChanged();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function remove(d: AdminDoctor) {
    if (!confirm(`Delete ${d.display_name}?`)) return;
    try {
      await api.deleteDoctor(d.id);
      toast(`${d.display_name} deleted`);
      await load();
      onDataChanged();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  }

  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>Doctors</h2>
          <p className="small muted">
            The email is the Google account the doctor signs in with, and should match their Cal.id account. Doctors
            sharing one email (e.g. hello@) are told apart by name.
          </p>
        </div>
        <button className="btn primary" onClick={() => setEditing({ ...blankDoctor })}>+ Add doctor</button>
      </div>
      <div className="table-wrap">
        <table className="grid-table">
          <thead>
            <tr><th>Name</th><th>Qualification</th><th>Reg No</th><th>Login email</th><th>Signature</th><th>Bookings</th><th></th></tr>
          </thead>
          <tbody>
            {doctors.map((d) => (
              <tr key={d.id}>
                <td className="strong">{d.display_name}</td>
                <td>{d.role ?? '—'}</td>
                <td className={/\/$/.test(d.reg_no ?? '') ? 'warn' : ''}>{d.reg_no ?? '—'}</td>
                <td>
                  {d.email}
                  {emailCounts[d.email] > 1 && <span className="chip">shared</span>}
                </td>
                <td>
                  <button className="sig-cell" onClick={() => setSigning(d)} title="Set digital signature">
                    {d.signature_url ? <img src={d.signature_url} alt="signature" /> : <span className="link">+ Add signature</span>}
                  </button>
                </td>
                <td>{d.bookings}</td>
                <td><div className="row-actions">
                  <button className="btn ghost sm" onClick={() => setEditing({ id: d.id, display_name: d.display_name, role: d.role ?? '', reg_no: d.reg_no ?? '', email: d.email })}>Edit</button>
                  <button className="btn ghost sm danger" onClick={() => remove(d)} disabled={d.bookings > 0} title={d.bookings ? 'Has bookings' : 'Delete'}>Delete</button>
                </div></td>
              </tr>
            ))}
            {!doctors.length && (
              <tr><td colSpan={7} className="muted center-pad">No doctors yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {editing && (
        <div className="overlay center-overlay" onMouseDown={(e) => e.target === e.currentTarget && setEditing(null)}>
          <form className="modal" onSubmit={(e) => { e.preventDefault(); save(); }}>
            <div className="modal-head">
              <h3>{editing.id ? 'Edit doctor' : 'Add doctor'}</h3>
              <button type="button" className="icon-btn" onClick={() => setEditing(null)}>×</button>
            </div>
            {(
              [
                ['display_name', 'Name (as printed on the prescription)', 'Dr Radha Dangaich'],
                ['role', 'Qualification', 'MD Psychiatry (NIMHANS)'],
                ['reg_no', 'Registration number', 'Reg No DMC/R/25251'],
                ['email', 'Login email (Google / Cal.id)', 'doctor@equaroots.com'],
              ] as [keyof typeof blankDoctor, string, string][]
            ).map(([k, label, ph]) => (
              <label className="field" key={k}>
                <span>{label}</span>
                <input value={editing[k]} placeholder={ph} type={k === 'email' ? 'email' : 'text'} required={k === 'display_name' || k === 'email'} onChange={(e) => setEditing({ ...editing, [k]: e.target.value })} />
              </label>
            ))}
            <div className="actions modal-actions">
              <button type="button" className="btn ghost" onClick={() => setEditing(null)}>Cancel</button>
              <button className="btn primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
            </div>
          </form>
        </div>
      )}
      {signing && (
        <SignatureModal doctors={[signing]} toast={toast} onClose={() => setSigning(null)} onSaved={() => { load(); onDataChanged(); }} />
      )}
    </section>
  );
}

function MedicinesTab({ toast, onDataChanged }: { toast: Toast; onDataChanged: () => void }) {
  const [meds, setMeds] = useState<Medicine[]>([]);
  const [name, setName] = useState('');
  const [notes, setNotes] = useState('');
  const load = useCallback(() => api.bootstrap().then((b) => setMeds(b.medicines)).catch((e) => toast(e.message, 'error')), [toast]);
  useEffect(() => {
    load();
  }, [load]);

  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>Medicines</h2>
          <p className="small muted">Suggestions shown in the prescription form. Doctors can still type any medicine.</p>
        </div>
      </div>
      <form
        className="inline-form"
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            await api.addMedicine(name, notes);
            setName('');
            setNotes('');
            await load();
            onDataChanged();
          } catch (e2) {
            toast((e2 as Error).message, 'error');
          }
        }}
      >
        <input placeholder="Medicine, e.g. Escitalopram 10mg" value={name} onChange={(e) => setName(e.target.value)} required />
        <input placeholder="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} />
        <button className="btn primary">Add</button>
      </form>
      <ul className="med-list">
        {meds.map((m) => (
          <li key={m.id}>
            <span><b>{m.name}</b>{m.notes && <span className="muted"> · {m.notes}</span>}</span>
            <button className="icon-btn sm" aria-label={`Remove ${m.name}`} onClick={async () => { await api.deleteMedicine(m.id); await load(); onDataChanged(); }}>×</button>
          </li>
        ))}
        {!meds.length && <li className="muted">No medicines yet.</li>}
      </ul>
    </section>
  );
}

function WebhooksTab({ toast }: { toast: Toast }) {
  const [logs, setLogs] = useState<WebhookLog[] | null>(null);
  const load = useCallback(() => api.webhookLogs().then(setLogs).catch((e) => toast(e.message, 'error')), [toast]);
  useEffect(() => {
    load();
  }, [load]);
  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>Cal.id webhook log</h2>
          <p className="small muted">Every call from Cal.id, newest first. Use it to see why a booking did or didn’t appear.</p>
        </div>
        <button className="btn ghost sm" onClick={load}>↻ Refresh</button>
      </div>
      <div className="table-wrap">
        <table className="grid-table">
          <thead><tr><th></th><th>Received</th><th>Event</th><th>Booking UID</th><th>Result</th></tr></thead>
          <tbody>
            {logs?.map((l) => (
              <tr key={l.id}>
                <td>{l.ok ? <span className="ok">✓</span> : <span className="bad">✗</span>}</td>
                <td className="nowrap">{new Date(l.receivedAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}</td>
                <td>{l.triggerEvent ?? '—'}</td>
                <td className="mono">{l.calUid ?? '—'}</td>
                <td className={l.note?.includes('NO DOCTOR MATCH') ? 'warn' : ''}>{l.note}</td>
              </tr>
            ))}
            {logs && !logs.length && <tr><td colSpan={5} className="muted center-pad">No webhook calls yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );
}

const SHEETS: [string, string][] = [
  ['doctors', 'Doctors'],
  ['medicines', 'Medicines'],
  ['bookings', 'Booking Data'],
  ['consultations', 'Consultations'],
];

function ImportTab({ toast, onDataChanged }: { toast: Toast; onDataChanged: () => void }) {
  const [files, setFiles] = useState<Record<string, File | undefined>>({});
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState('');

  async function run() {
    setBusy(true);
    setResult('');
    try {
      const body: Record<string, string> = {};
      for (const [k] of SHEETS) if (files[k]) body[k] = await files[k]!.text();
      if (!Object.keys(body).length) throw new Error('Choose at least one CSV file');
      setResult(await api.importCsv(body));
      toast('Import finished');
      onDataChanged();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>Import from the old Google Sheet</h2>
          <p className="small muted">
            In the Sheet, open each tab and choose File → Download → CSV. Existing patient IDs and New/Existing flags are
            kept exactly. Re-importing the same file updates rows instead of duplicating them.
          </p>
        </div>
      </div>
      <div className="import-grid">
        {SHEETS.map(([k, label]) => (
          <label key={k} className="file-field">
            <span>{label}</span>
            <input type="file" accept=".csv,text/csv" onChange={(e) => setFiles({ ...files, [k]: e.target.files?.[0] })} />
          </label>
        ))}
      </div>
      <div className="actions" style={{ justifyContent: 'flex-start', marginTop: 14 }}>
        <button className="btn primary" disabled={busy} onClick={run}>{busy ? 'Importing…' : 'Import'}</button>
      </div>
      {result && <pre className="import-result">{result}</pre>}
    </section>
  );
}
