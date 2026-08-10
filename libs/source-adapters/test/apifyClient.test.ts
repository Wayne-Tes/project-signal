import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startApifyRun, waitForApifyRun, fetchApifyDataset } from '../src/apifyClient.js';

const mockFetch = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', mockFetch);
  mockFetch.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function jsonResponse(data: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(data),
  };
}

describe('startApifyRun', () => {
  const run = { id: 'run-1', status: 'READY', defaultDatasetId: 'ds-1' };

  it('POSTs to Apify and returns the run object', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ data: run }));
    const result = await startApifyRun('key', 'actor~id', { placeIds: ['abc'] });
    expect(result).toEqual(run);
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/acts/actor~id/runs?token=key'),
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('throws when the HTTP response is not ok', async () => {
    mockFetch.mockResolvedValue(jsonResponse({}, 422));
    await expect(startApifyRun('key', 'actor', {})).rejects.toThrow('422');
  });
});

describe('waitForApifyRun', () => {
  it('returns when run reaches SUCCEEDED status', async () => {
    const run = { id: 'run-1', status: 'SUCCEEDED', defaultDatasetId: 'ds-1' };
    mockFetch.mockResolvedValue(jsonResponse({ data: run }));
    const result = await waitForApifyRun('key', 'run-1');
    expect(result.status).toBe('SUCCEEDED');
  });

  it('polls through RUNNING until SUCCEEDED', async () => {
    const running = { id: 'run-1', status: 'RUNNING', defaultDatasetId: 'ds-1' };
    const succeeded = { id: 'run-1', status: 'SUCCEEDED', defaultDatasetId: 'ds-1' };
    mockFetch
      .mockResolvedValueOnce(jsonResponse({ data: running }))
      .mockResolvedValueOnce(jsonResponse({ data: running }))
      .mockResolvedValueOnce(jsonResponse({ data: succeeded }));

    vi.useFakeTimers();
    const promise = waitForApifyRun('key', 'run-1');
    await vi.runAllTimersAsync();
    const result = await promise;
    expect(result.status).toBe('SUCCEEDED');
    vi.useRealTimers();
  });

  it('throws when run ends with FAILED status', async () => {
    const failed = { id: 'run-1', status: 'FAILED', defaultDatasetId: 'ds-1' };
    mockFetch.mockResolvedValue(jsonResponse({ data: failed }));
    await expect(waitForApifyRun('key', 'run-1')).rejects.toThrow('FAILED');
  });

  it('throws when run ends with ABORTED status', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ data: { id: 'run-1', status: 'ABORTED', defaultDatasetId: '' } }));
    await expect(waitForApifyRun('key', 'run-1')).rejects.toThrow('ABORTED');
  });

  it('throws on non-ok poll response', async () => {
    mockFetch.mockResolvedValue(jsonResponse({}, 500));
    await expect(waitForApifyRun('key', 'run-1')).rejects.toThrow('500');
  });
});

describe('fetchApifyDataset', () => {
  it('returns array of typed items from dataset', async () => {
    const items = [{ text: 'Great!', stars: 5 }, { text: 'Good', stars: 4 }];
    mockFetch.mockResolvedValue(jsonResponse(items));
    const result = await fetchApifyDataset<{ text: string; stars: number }>('key', 'ds-1');
    expect(result).toEqual(items);
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/datasets/ds-1/items?token=key'),
    );
  });

  it('throws on non-ok response', async () => {
    mockFetch.mockResolvedValue(jsonResponse({}, 404));
    await expect(fetchApifyDataset('key', 'ds-1')).rejects.toThrow('404');
  });
});

describe('the poll endpoint', () => {
  /**
   * THE PATH IS `/actor-runs/`, NOT `/runs/`.
   *
   * This polled `/v2/runs/{id}`, which returns 404 for every run that has ever existed —
   * verified against the live API with a real run id: `/v2/runs/{id}` → 404,
   * `/v2/actor-runs/{id}` → 200. So every Apify-backed adapter started its run successfully and
   * then failed on the first poll, for as long as this code has existed.
   *
   * It stayed invisible because the deployed Apify token was never set, so the failure was a 401
   * at start and nothing ever reached the poll. Fixing the credential is what revealed it — one
   * broken thing hiding behind another.
   */
  it('polls /actor-runs/, which is the path that resolves', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { id: 'run-1', status: 'SUCCEEDED', defaultDatasetId: 'ds-1' } }),
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await waitForApifyRun('key-123', 'run-1');

    const url = String(fetchMock.mock.calls[0]![0]);
    expect(url).toContain('/v2/actor-runs/run-1');
    expect(url, 'the legacy /v2/runs/ path 404s for every run').not.toMatch(/\/v2\/runs\//);
  });
});
