import { useEffect, useRef, useState } from 'react';
import { api, type Doctor, type Layout } from '../api';
import { LayoutPicker } from './LayoutPicker';
import { SignaturePad, type SignaturePadHandle } from './SignaturePad';
import type { ToastKind } from './Toast';

/** Lets a doctor (or an admin on their behalf) set the signature printed on prescriptions. */
export function SignatureModal({
  doctors,
  onClose,
  toast,
  onSaved,
}: {
  doctors: Doctor[];
  onClose: () => void;
  toast: (m: string, k?: ToastKind) => void;
  onSaved?: () => void;
}) {
  const [doctorId, setDoctorId] = useState(doctors[0]?.id);
  const [initial, setInitial] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [layouts, setLayouts] = useState<Record<number, Layout>>(() =>
    Object.fromEntries(doctors.map((d) => [d.id, d.letterhead_layout ?? 'modern'])),
  );
  const pad = useRef<SignaturePadHandle>(null);
  const doctor = doctors.find((d) => d.id === doctorId);

  useEffect(() => {
    if (!doctorId) return;
    setLoading(true);
    api
      .getSignature(doctorId)
      .then(setInitial)
      .catch((e) => toast(e.message, 'error'))
      .finally(() => setLoading(false));
  }, [doctorId, toast]);

  async function save(remove = false) {
    if (!doctorId) return;
    setBusy(true);
    try {
      const sig = remove ? null : pad.current?.toDataUrl() ?? null;
      if (!remove && !sig) {
        toast('Draw or upload a signature first', 'error');
        return;
      }
      await api.setSignature(doctorId, sig);
      toast(remove ? 'Signature removed' : `Signature saved for ${doctor?.display_name}`);
      onSaved?.();
      onClose();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="overlay center-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal wide" role="dialog" aria-label="Letterhead and signature">
        <div className="modal-head">
          <h3>Letterhead &amp; signature</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Close">×</button>
        </div>
        {doctors.length > 1 && (
          <label className="field">
            <span>Doctor</span>
            <select value={doctorId} onChange={(e) => setDoctorId(Number(e.target.value))}>
              {doctors.map((d) => (
                <option key={d.id} value={d.id}>{d.display_name}</option>
              ))}
            </select>
          </label>
        )}
        <div className="field">
          <span>Prescription layout</span>
          <LayoutPicker
            value={layouts[doctorId!] ?? 'modern'}
            previewUrl={(l) => api.letterheadPreviewUrl(doctorId!, l)}
            onChange={async (l) => {
              const prev = layouts[doctorId!];
              setLayouts({ ...layouts, [doctorId!]: l });
              try {
                await api.setLetterhead(doctorId!, l);
                toast(`${doctor?.display_name}'s prescriptions will use the ${l} layout`);
                onSaved?.();
              } catch (e) {
                setLayouts({ ...layouts, [doctorId!]: prev });
                toast((e as Error).message, 'error');
              }
            }}
          />
        </div>
        <div className="field"><span>Digital signature</span></div>
        <p className="small muted" style={{ marginTop: -6 }}>
          This signature is printed on every prescription issued under <b>{doctor?.display_name}</b>, with a “Digitally
          signed” date stamp.
        </p>
        {loading ? <div className="center-pad muted">Loading…</div> : <SignaturePad ref={pad} initial={initial} />}
        <div className="actions modal-actions">
          {initial && (
            <button className="btn ghost danger" disabled={busy} onClick={() => save(true)}>Remove</button>
          )}
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={busy || loading} onClick={() => save()}>
            {busy ? 'Saving…' : 'Save signature'}
          </button>
        </div>
      </div>
    </div>
  );
}
