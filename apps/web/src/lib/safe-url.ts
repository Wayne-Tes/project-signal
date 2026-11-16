/**
 * The ONLY way a URL from data — a scraped signal, a model answer, a playbook citation — may
 * become an `href` in this app.
 *
 * Every one of those sources is ultimately text somebody else wrote. A review can carry a
 * `javascript:` URL as its link; a model asked about that review can quote it back. Rendering
 * either as `<a href>` runs script in an authenticated page on click, and the session token is
 * readable from that page. So every href built from data goes through here, and nothing else.
 */

/**
 * An absolute http(s) URL, normalised by the URL parser, or `undefined`.
 *
 * Parsing — not a prefix test — is the point: `java\tscript:`, leading control characters and
 * mixed case all fool a regex but not the WHATWG parser, which is the same parser the browser
 * will use when the link is clicked.
 */
export function safeExternalHref(raw: string | null | undefined): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  if (!/^https?:\/\//i.test(trimmed)) return undefined;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
    if (!url.hostname) return undefined;
    return url.href;
  } catch {
    return undefined;
  }
}

/**
 * A same-origin path such as `/help/scoring`, or `undefined`.
 *
 * `//evil.example/x` starts with a slash but is PROTOCOL-RELATIVE — the browser resolves it to
 * another host. `/\evil.example` is treated the same way by browsers that normalise backslashes.
 * Both are rejected, which is what the previous `startsWith('/')` check missed.
 */
export function safeInAppPath(raw: string | null | undefined): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  if (!trimmed.startsWith('/')) return undefined;
  if (trimmed.startsWith('//') || trimmed.startsWith('/\\')) return undefined;
  // Control characters have no business in a path and are how parsers get disagreed with.
  if (/[\u0000-\u001f\u007f]/.test(trimmed)) return undefined;
  return trimmed;
}
