import type { MedLine } from '../api';

export type ChipKind = 'frequency' | 'duration' | 'notes' | 'advice';
export const CHIP_MIME = 'application/x-equaroots-chip';
export const ROW_MIME = 'application/x-equaroots-row';

export const PRESETS: { kind: ChipKind; label: string; values: string[] }[] = [
  { kind: 'frequency', label: 'When', values: ['1-0-0', '0-1-0', '0-0-1', '1-0-1', '1-1-1', '0-0-½', 'SOS'] },
  { kind: 'duration', label: 'Duration', values: ['3 days', '5 days', '7 days', '2 weeks', '4 weeks', '3 months', '7 days then stop', 'Continue'] },
  { kind: 'notes', label: 'Notes', values: ['After food', 'Before food', 'Empty stomach', 'At bedtime', 'With milk', 'Do not stop abruptly', 'Taper slowly'] },
  {
    kind: 'advice',
    label: 'Advice',
    values: ['Review after 1 week', 'Review after 2 weeks', 'Review after 20 days', 'Review after 1 month', 'Sleep hygiene', '20-minute walk daily', 'Avoid alcohol', 'Limit caffeine after 2pm', 'Continue therapy sessions'],
  },
];

/** Where a chip's value lands. Notes/advice add to what's there; timing and duration replace it. */
export function applyToMed(m: MedLine, kind: Exclude<ChipKind, 'advice'>, value: string): MedLine {
  if (kind === 'notes') {
    const cur = m.notes.trim();
    if (cur.toLowerCase().includes(value.toLowerCase())) return m;
    return { ...m, notes: cur ? `${cur}, ${value}` : value };
  }
  return { ...m, [kind]: value };
}

export function appendAdvice(advice: string, value: string): string {
  const lines = advice.split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.some((l) => l.toLowerCase() === value.toLowerCase())) return advice;
  // Only one "Review after …" line: a new one replaces the old.
  const isReview = (l: string) => /^review after\b/i.test(l);
  const kept = isReview(value) ? lines.filter((l) => !isReview(l)) : lines;
  return [...kept, value].join('\n');
}

export function readChip(e: React.DragEvent): { kind: ChipKind; value: string } | null {
  try {
    const raw = e.dataTransfer.getData(CHIP_MIME);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function QuickPicks({ activeRow, onPick }: { activeRow: number | null; onPick: (kind: ChipKind, value: string) => void }) {
  return (
    <div className="qp" aria-label="Quick picks">
      <div className="qp-hint">
        Drag a chip onto a medicine row or into Advice — or click it to fill
        {activeRow != null ? ` medicine ${activeRow + 1}` : ' the row you last edited'}.
      </div>
      {PRESETS.map((g) => (
        <div key={g.kind} className={`qp-group qp-${g.kind}`}>
          <span className="qp-label">{g.label}</span>
          {g.values.map((v) => (
            <button
              key={v}
              type="button"
              className="chip-btn"
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData(CHIP_MIME, JSON.stringify({ kind: g.kind, value: v }));
                e.dataTransfer.setData('text/plain', v);
                e.dataTransfer.effectAllowed = 'copy';
              }}
              onClick={() => onPick(g.kind, v)}
              title={g.kind === 'advice' ? 'Add to advice' : `Set ${g.label.toLowerCase()}`}
            >
              {v}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}
