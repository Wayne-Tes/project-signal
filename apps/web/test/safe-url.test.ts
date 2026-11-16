import { describe, expect, it } from 'vitest';
import { safeExternalHref, safeInAppPath } from '@/lib/safe-url';

describe('safeExternalHref', () => {
  it.each([
    ['https://example.com/review/1', 'https://example.com/review/1'],
    ['http://example.com', 'http://example.com/'],
    ['  HTTPS://Example.com/a  ', 'https://example.com/a'],
  ])('accepts %s', (raw, expected) => {
    expect(safeExternalHref(raw)).toBe(expected);
  });

  it.each([
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    ' javascript:alert(1)',
    'java\tscript:alert(1)',
    'data:text/html;base64,PHNjcmlwdD4=',
    'vbscript:msgbox(1)',
    '//evil.example/x',
    '/relative/path',
    'mailto:a@b.c',
    'https://',
    'not a url',
    '',
  ])('rejects %j', (raw) => {
    expect(safeExternalHref(raw)).toBeUndefined();
  });

  it('rejects non-strings', () => {
    expect(safeExternalHref(null)).toBeUndefined();
    expect(safeExternalHref(undefined)).toBeUndefined();
  });
});

describe('safeInAppPath', () => {
  it('accepts a same-origin path', () => {
    expect(safeInAppPath('/help/how-recency-works')).toBe('/help/how-recency-works');
  });

  it.each(['//evil.example', '/\\evil.example', 'help/x', 'https://x.y', '/a\u0000b', '', null])(
    'rejects %j',
    (raw) => {
      expect(safeInAppPath(raw)).toBeUndefined();
    },
  );
});
