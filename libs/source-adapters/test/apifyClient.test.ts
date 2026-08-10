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

/**
 * A run that Apify refused for COMMERCIAL reasons.
 *
 * THE FAILURE MODE THIS CLOSES, in one sentence: a free-tier actor that is out of quota, or whose
 * author forbids API access on the free plan, finishes `SUCCEEDED` with `exitCode: 0` and no data.
 *
 * Nothing downstream could tell that apart from "there was nothing new to collect". So the scan
 * was recorded as a success, `last_fetched_at` was stamped, and the feed showed a healthy green
 * timestamp — while collecting nothing, indefinitely. The Play Store source did exactly this: 54
 * reviews on the first five runs, then zero on every run for a day, reported as success each time.
 * It was found by reading Apify's run logs, not by anything the product said.
 *
 * The messages below are VERBATIM from real runs on 2026-08-10. See `docs/OWNER-ACTIONS.md` §4b.
 */
describe('a run Apify refused rather than ran', () => {
  const refused = (statusMessage: string) => ({
    id: 'run-1',
    status: 'SUCCEEDED',
    defaultDatasetId: 'ds-1',
    statusMessage,
  });

  it('throws when the actor forbids API use on the free plan', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({
        data: refused(
          "The developer of this actor doesn't allow the use of API in the Free Plan. Please subscribe to a paid plan on Apify if you want to use the API with this actor.",
        ),
      }),
    );
    await expect(waitForApifyRun('key', 'run-1')).rejects.toThrow(/collected nothing/i);
  });

  it('throws when the free-tier run allowance is exhausted', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({
        data: refused(
          'Free tier limit reached (5 total runs). You have used all 5 free runs across all runs. To continue scraping, get an Apify paid plan',
        ),
      }),
    );
    await expect(waitForApifyRun('key', 'run-1')).rejects.toThrow(/collected nothing/i);
  });

  it("carries Apify's own words through, so the feed row names the cause", async () => {
    /* `source_configs.last_error` is rendered on the feed. "Free tier limit reached" is something
       the owner can act on; "collection failed" is not. */
    mockFetch.mockResolvedValue(jsonResponse({ data: refused('Free tier limit reached (5 total runs).') }));
    await expect(waitForApifyRun('key', 'run-1')).rejects.toThrow(/Free tier limit reached/);
  });

  it('throws when every request the crawler made failed', async () => {
    /* "Finished!" is Crawlee reporting that the CRAWLER ran to completion, not that it fetched
       anything. The Google reviews source sat in this state for seven consecutive hourly scans on
       2026-08-10, reported as success each time, before it began failing outright. */
    mockFetch.mockResolvedValue(
      jsonResponse({ data: refused('Finished! Total 1 requests: 0 succeeded, 1 failed.') }),
    );
    await expect(waitForApifyRun('key', 'run-1')).rejects.toThrow(/0 succeeded/);
  });

  it('does not fire on a healthy run that had SOME failures', async () => {
    /* A partial fetch is still a fetch. Only a run where nothing at all succeeded is the silent
       failure — which is why the pattern is anchored on a zero success count, not on the word
       "failed". */
    mockFetch.mockResolvedValue(
      jsonResponse({
        data: {
          id: 'run-1',
          status: 'SUCCEEDED',
          defaultDatasetId: 'ds-1',
          statusMessage: 'Finished! Total 3 requests: 2 succeeded, 1 failed.',
        },
      }),
    );
    await expect(waitForApifyRun('key', 'run-1')).resolves.toMatchObject({ status: 'SUCCEEDED' });
  });

  it('lets an ordinary successful run through untouched', async () => {
    /* The guard must not fire on the normal case. This is the real message from a healthy run. */
    mockFetch.mockResolvedValue(
      jsonResponse({
        data: {
          id: 'run-1',
          status: 'SUCCEEDED',
          defaultDatasetId: 'ds-1',
          statusMessage: 'Finished! Total 3 requests: 3 succeeded, 0 failed.',
        },
      }),
    );
    await expect(waitForApifyRun('key', 'run-1')).resolves.toMatchObject({ status: 'SUCCEEDED' });
  });

  it('still succeeds when the actor reports no status message at all', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({ data: { id: 'run-1', status: 'SUCCEEDED', defaultDatasetId: 'ds-1' } }),
    );
    await expect(waitForApifyRun('key', 'run-1')).resolves.toMatchObject({ status: 'SUCCEEDED' });
  });

  it("names the cause when a run genuinely FAILS, not just the status", async () => {
    /* A real one: a Google Place ID field holding an App Store URL. "FAILED" sends someone to the
       logs; the message tells them which feed to fix. */
    mockFetch.mockResolvedValue(
      jsonResponse({
        data: {
          id: 'run-1',
          status: 'FAILED',
          defaultDatasetId: 'ds-1',
          statusMessage: 'INVALID INPUT: "startUrls" don\'t contain any valid URLs.',
        },
      }),
    );
    await expect(waitForApifyRun('key', 'run-1')).rejects.toThrow(/INVALID INPUT/);
  });
});

describe('placeholder rows', () => {
  /**
   * `{"noResults": true}` is not a record of anything — several actors emit one per attempted
   * page. Every field an adapter reads off one is `undefined`, which produces a signal with no
   * text, no external id and an `Invalid Date` publishedAt. Filtering here means no adapter has to
   * know the convention, and none can forget it.
   */
  it('drops placeholder rows and keeps the real ones', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse([{ noResults: true }, { text: 'Great!', stars: 5 }, { noResults: true }]),
    );
    await expect(fetchApifyDataset<{ text: string }>('key', 'ds-1')).resolves.toEqual([
      { text: 'Great!', stars: 5 },
    ]);
  });

  it('throws when the dataset is nothing BUT placeholders', async () => {
    /* The shape of a refused run that said nothing useful in `statusMessage`. Ten placeholder
       rows and no data is a fault worth showing on the feed, not a quiet zero. */
    mockFetch.mockResolvedValue(jsonResponse(Array.from({ length: 10 }, () => ({ noResults: true }))));
    await expect(fetchApifyDataset('key', 'ds-1')).rejects.toThrow(/placeholder/i);
  });

  it('returns an empty array for a genuinely empty dataset', async () => {
    /* An actor that ran properly and found nothing new is the normal steady state of a working
       feed, and must not be reported as an error. */
    mockFetch.mockResolvedValue(jsonResponse([]));
    await expect(fetchApifyDataset('key', 'ds-1')).resolves.toEqual([]);
  });

  it('is not confused by a row whose noResults is false', async () => {
    mockFetch.mockResolvedValue(jsonResponse([{ noResults: false, text: 'ok' }]));
    await expect(fetchApifyDataset('key', 'ds-1')).resolves.toHaveLength(1);
  });
});
