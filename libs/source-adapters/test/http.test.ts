import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockLookup } = vi.hoisted(() => ({ mockLookup: vi.fn() }));
vi.mock('node:dns/promises', () => ({ lookup: mockLookup }));

import { assertPublicUrl, fetchPublic, fetchWithTimeout, isBlockedAddress } from '../src/http.js';

const mockFetch = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', mockFetch);
  mockFetch.mockReset();
  mockLookup.mockReset();
  mockLookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
});

afterEach(() => vi.unstubAllGlobals());

describe('isBlockedAddress', () => {
  it.each([
    '127.0.0.1',
    '10.0.0.1',
    '172.16.5.4',
    '192.168.1.1',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '224.0.0.1',
    '::1',
    '::',
    'fd00::1',
    'fe80::1',
    '::ffff:127.0.0.1',
    '::ffff:169.254.169.254',
    'not-an-ip',
  ])('blocks %s', (address) => {
    expect(isBlockedAddress(address)).toBe(true);
  });

  it.each(['93.184.216.34', '8.8.8.8', '2606:4700:4700::1111', '::ffff:8.8.8.8'])(
    'allows public %s',
    (address) => {
      expect(isBlockedAddress(address)).toBe(false);
    },
  );
});

describe('assertPublicUrl', () => {
  it('accepts a public https URL', async () => {
    await expect(assertPublicUrl('https://example.com/feed')).resolves.toBeInstanceOf(URL);
  });

  it('rejects a name with ANY private address among its records', async () => {
    /* Accepting on the first record would connect to whichever the resolver returns next time. */
    mockLookup.mockResolvedValue([
      { address: '93.184.216.34', family: 4 },
      { address: '10.0.0.7', family: 4 },
    ]);
    await expect(assertPublicUrl('https://mixed.test/')).rejects.toThrow(/private or reserved/);
  });

  it('checks a literal IP without resolving it', async () => {
    await expect(assertPublicUrl('http://[::1]:8080/')).rejects.toThrow(/private or reserved/);
    expect(mockLookup).not.toHaveBeenCalled();
  });

  it('rejects malformed URLs, other schemes, embedded credentials and names that do not resolve', async () => {
    await expect(assertPublicUrl('not a url')).rejects.toThrow(/Not a valid URL/);
    await expect(assertPublicUrl('ftp://example.com/')).rejects.toThrow(/Only http and https/);
    await expect(assertPublicUrl('https://user:pw@example.com/')).rejects.toThrow(/credentials/);
    mockLookup.mockResolvedValue([]);
    await expect(assertPublicUrl('https://nowhere.test/')).rejects.toThrow(/does not resolve/);
  });
});

describe('fetchPublic', () => {
  it('gives up after too many redirects', async () => {
    mockFetch.mockResolvedValue({ status: 302, headers: new Headers({ location: '/again' }) });
    await expect(fetchPublic('https://example.com/loop')).rejects.toThrow(/Too many redirects/);
    expect(mockFetch).toHaveBeenCalledTimes(6);
  });

  it('never lets fetch follow redirects on its own', async () => {
    mockFetch.mockResolvedValue({ status: 200, headers: new Headers() });
    await fetchPublic('https://example.com/');
    expect((mockFetch.mock.calls[0]?.[1] as RequestInit).redirect).toBe('manual');
  });
});

describe('fetchWithTimeout', () => {
  it('attaches an abort signal so a hung source fails in bounded time', async () => {
    mockFetch.mockResolvedValue({ status: 200 });
    await fetchWithTimeout('https://example.com/', { method: 'GET' }, 1000);
    const init = mockFetch.mock.calls[0]?.[1] as RequestInit;
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(init.method).toBe('GET');
  });
});
