/**
 * Leser teksten i en PDF lokalt i nettleseren (pdf.js) og grupperer den i linjer.
 * Filen sendes ikke noe sted. pdf.js lastes først når en PDF faktisk velges.
 */
export async function pdfToLines(data: ArrayBuffer): Promise<string[]> {
  const pdfjs = await import('pdfjs-dist');
  const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  const doc = await pdfjs.getDocument({ data: new Uint8Array(data) }).promise;
  const lines: string[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    // Tekstbiter på samme høyde (± 2 pt) hører til samme linje.
    const rows: { y: number; items: { x: number; str: string }[] }[] = [];
    for (const it of content.items) {
      if (!('str' in it) || !it.str.trim()) continue;
      const x = it.transform[4];
      const y = it.transform[5];
      const row = rows.find((r) => Math.abs(r.y - y) <= 2);
      if (row) row.items.push({ x, str: it.str });
      else rows.push({ y, items: [{ x, str: it.str }] });
    }
    rows
      .sort((a, b) => b.y - a.y)
      .forEach((r) => lines.push(r.items.sort((a, b) => a.x - b.x).map((i) => i.str.trim()).join(' ')));
  }
  await doc.destroy();
  return lines;
}
