import type { Layout } from '../api';

const G = '#1e421e';
const S = '#566f5a';
const GOLD = '#e9b84a';
const L = '#d5e0d2';

/** Tiny schematic of each letterhead so doctors can tell them apart at a glance. */
function Thumb({ layout }: { layout: Layout }) {
  const lines = (x: number, y: number, w: number, n: number) =>
    Array.from({ length: n }, (_, i) => <rect key={i} x={x} y={y + i * 7} width={w - (i % 3) * 8} height="3" rx="1.5" fill={L} />);
  return (
    <svg viewBox="0 0 84 112" className="lp-thumb" aria-hidden>
      <rect width="84" height="112" rx="3" fill="#fff" />
      {layout === 'modern' && (
        <>
          <circle cx="15" cy="13" r="7" fill={GOLD} opacity=".8" />
          <rect x="44" y="8" width="32" height="4" rx="2" fill={G} />
          <rect x="52" y="15" width="24" height="3" rx="1.5" fill={L} />
          <rect x="8" y="26" width="68" height="2" rx="1" fill={G} />
          <rect x="8" y="32" width="68" height="13" rx="2" fill="#eef4ec" />
          {lines(8, 52, 68, 3)}
          <rect x="8" y="73" width="68" height="16" rx="1" fill="#f3f7f2" />
          <rect x="8" y="104" width="68" height="1" fill={L} />
        </>
      )}
      {layout === 'sidebar' && (
        <>
          <rect width="26" height="112" rx="3" fill={G} />
          <rect x="24" width="2" height="112" fill={GOLD} />
          <rect x="5" y="6" width="16" height="13" rx="2" fill="#fff" />
          <rect x="5" y="24" width="16" height="3" rx="1.5" fill="#fff" opacity=".8" />
          <rect x="5" y="30" width="12" height="2" rx="1" fill="#9fb79f" />
          <rect x="5" y="94" width="11" height="11" rx="1" fill="#fff" />
          <rect x="32" y="8" width="26" height="4" rx="2" fill={G} />
          <rect x="32" y="15" width="44" height="1.5" fill={G} />
          {lines(32, 22, 44, 3)}
          <rect x="32" y="46" width="44" height="18" rx="1" fill="#f3f7f2" />
          {lines(32, 70, 44, 2)}
        </>
      )}
      {layout === 'classic' && (
        <>
          <rect y="4" width="84" height="20" fill={G} />
          <rect y="21" width="84" height="3" fill={S} />
          <rect x="6" y="2" width="22" height="25" fill={S} />
          <rect x="8" y="4" width="18" height="21" fill="#fff" />
          <rect x="52" y="9" width="24" height="3" rx="1.5" fill="#fff" />
          <rect x="58" y="15" width="18" height="2" rx="1" fill={GOLD} />
          {lines(8, 36, 68, 6)}
          <rect y="98" width="84" height="14" fill={G} />
        </>
      )}
    </svg>
  );
}

export const LAYOUTS: { id: Layout; name: string; blurb: string }[] = [
  { id: 'modern', name: 'Modern', blurb: 'Clean white page, patient card, medicines table' },
  { id: 'sidebar', name: 'Sidebar', blurb: 'Green side panel with logo, doctor & contacts' },
  { id: 'classic', name: 'Classic', blurb: 'Original green EquaRoots letterhead band' },
];

export function LayoutPicker({
  value,
  onChange,
  previewUrl,
  disabled,
}: {
  value: Layout;
  onChange: (l: Layout) => void;
  previewUrl: (l: Layout) => string;
  disabled?: boolean;
}) {
  return (
    <div className="lp">
      {LAYOUTS.map((l) => (
        <div key={l.id} className={`lp-opt ${value === l.id ? 'on' : ''}`}>
          <button type="button" className="lp-pick" disabled={disabled} onClick={() => onChange(l.id)} aria-pressed={value === l.id}>
            <Thumb layout={l.id} />
            <span className="lp-name">
              {value === l.id && <span className="lp-check">✓</span>}
              {l.name}
            </span>
            <span className="lp-blurb">{l.blurb}</span>
          </button>
          <a className="lp-prev" href={previewUrl(l.id)} target="_blank" rel="noreferrer">
            Preview PDF ↗
          </a>
        </div>
      ))}
    </div>
  );
}
