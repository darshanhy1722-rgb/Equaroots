import { useCallback, useMemo, useRef, useState } from 'react';

export type ToastKind = 'ok' | 'error' | 'info';
export interface ToastState {
  msg: string;
  kind: ToastKind;
  id: number;
}

export function useToast() {
  const [state, setState] = useState<ToastState | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const show = useCallback((msg: string, kind: ToastKind = 'ok') => {
    window.clearTimeout(timer.current);
    setState({ msg, kind, id: Date.now() });
    timer.current = window.setTimeout(() => setState(null), kind === 'error' ? 7000 : 3500);
  }, []);
  return useMemo(() => ({ state, show }), [state, show]);
}

export function Toast({ state }: { state: ToastState | null }) {
  if (!state) return null;
  return (
    <div key={state.id} className={`toast ${state.kind}`} role="status">
      {state.msg}
    </div>
  );
}
