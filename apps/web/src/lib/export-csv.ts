/**
 * CSV export of a brand's signals.
 *
 * The Export button was a stub from the prototype onwards: rendered, enabled, and wired to
 * nothing. It was left visible and DISABLED rather than deleted (docs/STUBS.md #1) because
 * removing a control unilaterally was not that refactor's decision to take. This makes it real.
 *
 * Signals, not the current view's aggregates, because that is the export people actually want:
 * the rows behind the numbers, openable in a spreadsheet. Aggregates are already on screen and
 * in the printable report.
 */

export interface ExportableSignal {
  id: string;
  source: string;
  sourceUrl: string | null;
  publishedAt: string;
  ingestedAt?: string;
}

/**
 * Escapes one CSV field.
 *
 * Quotes everything rather than only what needs it. Selective quoting means the rule lives in
 * two places — the writer's idea of "special" and the reader's — and they disagree on exactly
 * the values that break a file: an embedded comma inside a quoted string, a newline inside a
 * review, a leading `=` that a spreadsheet treats as a formula.
 */
function csvField(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value);
  /* A leading =, +, - or @ is executed as a formula by Excel and Sheets. Prefixing a single
     quote neutralises it without changing what the user reads in the cell. This is a real
     injection path: signal text and source URLs come from the public internet. */
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
}

export function toCsv(rows: readonly ExportableSignal[]): string {
  const header = ['id', 'source', 'published_at', 'ingested_at', 'source_url'];
  const lines = rows.map((r) =>
    [r.id, r.source, r.publishedAt, r.ingestedAt ?? '', r.sourceUrl ?? ''].map(csvField).join(','),
  );
  /* CRLF: the line ending RFC 4180 specifies, and the one Excel reads without complaint. */
  return [header.map(csvField).join(','), ...lines].join('\r\n');
}

/** A filename that sorts chronologically and survives every filesystem. */
export function csvFilename(brandName: string, isoDate: string): string {
  const slug = brandName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'brand';
  return `project-signal-${slug}-signals-${isoDate.slice(0, 10)}.csv`;
}

/**
 * Triggers a browser download of `content`.
 *
 * The object URL is revoked after the click. Without it the blob is held for the lifetime of the
 * document, and a user exporting repeatedly leaks a copy of every file they have downloaded.
 */
export function downloadCsv(filename: string, content: string): void {
  /* The BOM is what makes Excel read UTF-8 rather than the system codepage. Without it, any
     non-ASCII character in a brand name or a URL renders as mojibake — and this product's
     signals are multilingual by nature. */
  const blob = new Blob([`﻿${content}`], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
