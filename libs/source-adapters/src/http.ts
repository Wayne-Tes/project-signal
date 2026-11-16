import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';

/**
 * HTTP helpers shared by every adapter.
 *
 * Two defects motivated this file:
 *
 * 1. **No timeouts.** `fetch` has none by default, so one source that accepted the connection and
 *    then never answered held its whole scan open until the visibility timeout handed the message
 *    to another consumer — and that consumer hit the same hang. A collection run must fail in
 *    bounded time and record why.
 * 2. **Server-side request forgery.** The RSS feed URL is typed in by a tenant admin and fetched
 *    from inside the VPC. Unchecked, `http://169.254.169.254/latest/meta-data/` (the instance
 *    metadata service) or `http://10.20.x.x:5432` is just another feed URL.
 */

/** Long enough for a slow feed, short enough that a hung one cannot hold a scan open. */
export const DEFAULT_TIMEOUT_MS = 30_000;

/** `fetch` with a hard deadline. The global is read at call time so tests can stub it. */
export function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<Response> {
  return fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
}

/**
 * Address ranges a tenant-supplied URL may never reach.
 *
 * Loopback, RFC 1918 private ranges, carrier-grade NAT, link-local (which is where every cloud's
 * instance metadata service lives), "this network", multicast and reserved space — and the IPv6
 * equivalents, including IPv4-mapped addresses, which are how `::ffff:127.0.0.1` would otherwise
 * walk around the IPv4 rules.
 */
const BLOCKED = new BlockList();
for (const [net, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  BLOCKED.addSubnet(net, prefix, 'ipv4');
}
for (const [net, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
] as const) {
  BLOCKED.addSubnet(net, prefix, 'ipv6');
}

/** True if the address is somewhere a tenant-supplied URL must not reach. */
export function isBlockedAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return BLOCKED.check(address, 'ipv4');
  if (family === 6) {
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
    if (mapped?.[1]) return BLOCKED.check(mapped[1], 'ipv4');
    return BLOCKED.check(address, 'ipv6');
  }
  /* Not an address at all — refuse rather than guess. */
  return true;
}

/**
 * Throws unless `raw` is an http(s) URL whose host resolves ONLY to public addresses.
 *
 * Every resolved address is checked, not just the first: a hostname with one public and one
 * private A record would otherwise be accepted and then connected to whichever the resolver
 * returned on the second lookup.
 *
 * Residual risk, stated plainly: the check resolves the name and `fetch` then resolves it again,
 * so a hostile DNS server answering differently the second time (DNS rebinding) is not closed by
 * this alone. The private subnets also have no route to anything a feed fetch can harm beyond the
 * database, which requires credentials — this check is the first layer, not the only one.
 */
export async function assertPublicUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`Not a valid URL: ${raw}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`Only http and https URLs can be fetched, not ${url.protocol}`);
  }
  if (url.username || url.password) {
    throw new Error('URLs with embedded credentials cannot be fetched');
  }

  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = isIP(host)
    ? [host]
    : (await lookup(host, { all: true, verbatim: true })).map((a) => a.address);
  if (addresses.length === 0) throw new Error(`${host} does not resolve`);

  const blocked = addresses.find(isBlockedAddress);
  if (blocked) {
    throw new Error(`Refusing to fetch ${host}: it resolves to a private or reserved address`);
  }
  return url;
}

/** Redirect hops followed before giving up. */
const MAX_REDIRECTS = 5;

/**
 * Fetches a URL a TENANT supplied, re-validating every redirect hop.
 *
 * `fetch` follows redirects on its own, which would let a public URL answer `302 Location:
 * http://169.254.169.254/` and walk straight past a check made only on the first URL. So redirects
 * are followed by hand, with `assertPublicUrl` on each.
 */
export async function fetchPublic(
  raw: string,
  init: RequestInit = {},
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<Response> {
  let current = raw;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const url = await assertPublicUrl(current);
    const res = await fetchWithTimeout(url.toString(), { ...init, redirect: 'manual' }, timeoutMs);
    const location = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && location) {
      current = new URL(location, url).toString();
      continue;
    }
    return res;
  }
  throw new Error(`Too many redirects fetching ${raw}`);
}
