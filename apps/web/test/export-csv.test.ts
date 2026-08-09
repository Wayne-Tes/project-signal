import { describe, expect, it } from 'vitest';
import { csvFilename, toCsv } from '../src/lib/export-csv';

/**
 * CSV export.
 *
 * The interesting tests are the escaping ones. Every field in a signal comes from the public
 * internet — a source URL, a source name — so a CSV writer here is handling untrusted input, and
 * the file it produces is opened in Excel by someone who trusts it.
 */

const ROW = {
  id: 'sig-1',
  source: 'rss',
  sourceUrl: 'https://example.com/a',
  publishedAt: '2026-08-01T10:00:00.000Z',
  ingestedAt: '2026-08-01T10:05:00.000Z',
};

describe('toCsv', () => {
  it('writes a header and one row per signal', () => {
    const lines = toCsv([ROW, { ...ROW, id: 'sig-2' }]).split('\r\n');
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain('"id"');
    expect(lines[1]).toContain('"sig-1"');
  });

  it('uses CRLF, which is what RFC 4180 says and what Excel reads without complaint', () => {
    expect(toCsv([ROW])).toContain('\r\n');
  });

  it('escapes an embedded quote by doubling it', () => {
    const csv = toCsv([{ ...ROW, source: 'say "hello"' }]);
    expect(csv).toContain('"say ""hello"""');
  });

  it('keeps a comma inside a field rather than splitting the row', () => {
    const csv = toCsv([{ ...ROW, source: 'news, national' }]);
    expect(csv.split('\r\n')).toHaveLength(2);
    expect(csv).toContain('"news, national"');
  });

  it('keeps a newline inside a field', () => {
    /* Quoted newlines are legal CSV and common in review text. Splitting on them would
       silently corrupt every export containing a multi-line signal. */
    const csv = toCsv([{ ...ROW, source: 'line one\nline two' }]);
    expect(csv).toContain('"line one\nline two"');
  });

  it('neutralises a value a spreadsheet would execute as a formula', () => {
    /* CSV injection. A source URL beginning `=` is executed by Excel and Sheets on open. These
       values come from the public internet, so this is a live path rather than a theoretical
       one. The leading apostrophe is not shown in the cell. */
    for (const dangerous of ['=1+1', '+1', '-1', '@SUM(A1)']) {
      expect(toCsv([{ ...ROW, sourceUrl: dangerous }])).toContain(`"'${dangerous}"`);
    }
  });

  it('renders a missing optional field as empty rather than "null"', () => {
    const csv = toCsv([{ ...ROW, sourceUrl: null, ingestedAt: undefined }]);
    expect(csv).not.toContain('null');
    expect(csv).not.toContain('undefined');
  });

  it('produces a header-only file for no rows', () => {
    expect(toCsv([]).split('\r\n')).toHaveLength(1);
  });
});

describe('csvFilename', () => {
  it('slugs the brand name and dates the file', () => {
    expect(csvFilename('Tes Global', '2026-08-09T01:00:00.000Z')).toBe(
      'project-signal-tes-global-signals-2026-08-09.csv',
    );
  });

  it('survives a name with no usable characters', () => {
    expect(csvFilename('***', '2026-08-09T00:00:00.000Z')).toContain('project-signal-brand-');
  });

  it('strips characters a filesystem would reject', () => {
    expect(csvFilename('A/B:C*D?', '2026-08-09T00:00:00.000Z')).not.toMatch(/[/:*?]/);
  });
});

describe('downloadCsv', () => {
  it('names the file, clicks once, and releases the object URL', async () => {
    /* The revoke is the part worth testing. Without it the blob is retained for the lifetime of
       the document, so a user exporting repeatedly leaks a copy of every file they downloaded. */
    const { downloadCsv } = await import('../src/lib/export-csv');
    const created: string[] = [];
    const revoked: string[] = [];
    URL.createObjectURL = ((): string => {
      const url = `blob:${created.length}`;
      created.push(url);
      return url;
    }) as typeof URL.createObjectURL;
    URL.revokeObjectURL = ((url: string): void => {
      revoked.push(url);
    }) as typeof URL.revokeObjectURL;

    let clicks = 0;
    const realCreate = document.createElement.bind(document);
    document.createElement = ((tag: string) => {
      const el = realCreate(tag) as HTMLAnchorElement;
      if (tag === 'a') el.click = () => { clicks += 1; };
      return el;
    }) as typeof document.createElement;

    downloadCsv('out.csv', 'a,b');

    expect(clicks).toBe(1);
    expect(revoked).toEqual(created);
    document.createElement = realCreate;
  });
});
