import { strFromU8, unzipSync } from 'fflate';

/** Minimal .xlsx reader: first worksheet → rows of cell text (enough for the patient register). */
export async function readXlsxTable(file: File): Promise<string[][]> {
  const zip = unzipSync(new Uint8Array(await file.arrayBuffer()));
  const xml = (path: string) => {
    const f = zip[path];
    return f ? new DOMParser().parseFromString(strFromU8(f), 'application/xml') : null;
  };
  const text = (el: Element | null | undefined) =>
    el ? Array.from(el.getElementsByTagName('t')).map((t) => t.textContent ?? '').join('') : '';

  const shared = Array.from(xml('xl/sharedStrings.xml')?.getElementsByTagName('si') ?? []).map((si) => text(si));

  // First sheet in workbook order → its file via the workbook relationships.
  const wb = xml('xl/workbook.xml');
  const rid = wb?.getElementsByTagName('sheet')[0]?.getAttribute('r:id');
  const rel = Array.from(xml('xl/_rels/workbook.xml.rels')?.getElementsByTagName('Relationship') ?? []).find(
    (r) => r.getAttribute('Id') === rid,
  );
  const target = rel?.getAttribute('Target')?.replace(/^\/?(xl\/)?/, '') ?? 'worksheets/sheet1.xml';
  const sheet = xml(`xl/${target}`);
  if (!sheet) throw new Error('Could not read the first worksheet');

  const colIndex = (ref: string) => {
    const letters = /^[A-Z]+/.exec(ref)?.[0] ?? 'A';
    return [...letters].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1;
  };
  return Array.from(sheet.getElementsByTagName('row')).map((row) => {
    const out: string[] = [];
    for (const c of Array.from(row.getElementsByTagName('c'))) {
      const t = c.getAttribute('t');
      const v = c.getElementsByTagName('v')[0]?.textContent ?? '';
      out[colIndex(c.getAttribute('r') ?? 'A')] =
        t === 's' ? shared[Number(v)] ?? '' : t === 'inlineStr' ? text(c.getElementsByTagName('is')[0]) : v;
    }
    return Array.from(out, (x) => x ?? '');
  });
}
