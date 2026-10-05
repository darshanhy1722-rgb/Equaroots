import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';

export interface SignaturePadHandle {
  /** Trimmed PNG data URL, or null when the pad is empty. */
  toDataUrl: () => string | null;
}

const W = 520;
const H = 180;

/** Draw-or-upload signature pad. Ink is transparent PNG so it sits cleanly on the PDF. */
export const SignaturePad = forwardRef<SignaturePadHandle, { initial: string | null }>(function SignaturePad(
  { initial },
  ref,
) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);
  const [empty, setEmpty] = useState(true);
  const file = useRef<HTMLInputElement>(null);

  const ctx = () => canvas.current!.getContext('2d')!;

  useEffect(() => {
    const c = canvas.current!;
    const dpr = window.devicePixelRatio || 1;
    c.width = W * dpr;
    c.height = H * dpr;
    const g = ctx();
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.strokeStyle = '#13294b';
    g.lineWidth = 2.4;
    if (initial) drawImage(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial]);

  function clear() {
    ctx().clearRect(0, 0, W, H);
    setEmpty(true);
  }

  function drawImage(src: string) {
    const img = new Image();
    img.onload = () => {
      clear();
      const scale = Math.min((W - 20) / img.width, (H - 20) / img.height, 1);
      const w = img.width * scale;
      const h = img.height * scale;
      ctx().drawImage(img, (W - w) / 2, (H - h) / 2, w, h);
      setEmpty(false);
    };
    img.src = src;
  }

  const pos = (e: React.PointerEvent) => {
    const r = canvas.current!.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H };
  };

  useImperativeHandle(ref, () => ({
    toDataUrl() {
      if (empty) return null;
      const c = canvas.current!;
      const g = c.getContext('2d')!;
      const { width, height } = c;
      const data = g.getImageData(0, 0, width, height).data;
      let minX = width, minY = height, maxX = -1, maxY = -1;
      for (let y = 0; y < height; y++)
        for (let x = 0; x < width; x++)
          if (data[(y * width + x) * 4 + 3] > 8) {
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
      if (maxX < 0) return null;
      const pad = 8;
      minX = Math.max(0, minX - pad);
      minY = Math.max(0, minY - pad);
      maxX = Math.min(width - 1, maxX + pad);
      maxY = Math.min(height - 1, maxY + pad);
      const out = document.createElement('canvas');
      out.width = maxX - minX + 1;
      out.height = maxY - minY + 1;
      out.getContext('2d')!.drawImage(c, minX, minY, out.width, out.height, 0, 0, out.width, out.height);
      return out.toDataURL('image/png');
    },
  }));

  return (
    <div className="sigpad">
      <canvas
        ref={canvas}
        style={{ width: '100%', aspectRatio: `${W} / ${H}` }}
        onPointerDown={(e) => {
          (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
          drawing.current = true;
          last.current = pos(e);
          const p = last.current;
          const g = ctx();
          g.beginPath();
          g.arc(p.x, p.y, 1.1, 0, Math.PI * 2);
          g.fillStyle = '#13294b';
          g.fill();
          setEmpty(false);
        }}
        onPointerMove={(e) => {
          if (!drawing.current || !last.current) return;
          const p = pos(e);
          const g = ctx();
          g.beginPath();
          g.moveTo(last.current.x, last.current.y);
          g.lineTo(p.x, p.y);
          g.stroke();
          last.current = p;
        }}
        onPointerUp={() => {
          drawing.current = false;
          last.current = null;
        }}
        onPointerCancel={() => (drawing.current = false)}
      />
      {empty && <div className="sigpad-hint">Sign here with your mouse, finger or stylus</div>}
      <div className="sigpad-actions">
        <button type="button" className="btn ghost sm" onClick={clear}>Clear</button>
        <button type="button" className="btn ghost sm" onClick={() => file.current?.click()}>Upload image…</button>
        <input
          ref={file}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            const r = new FileReader();
            r.onload = () => drawImage(String(r.result));
            r.readAsDataURL(f);
            e.target.value = '';
          }}
        />
      </div>
    </div>
  );
});
