const APIFY_BASE = 'https://api.apify.com/v2';
const POLL_INTERVAL_MS = 5_000;
const POLL_TIMEOUT_MS = 300_000;

type ApifyRunStatus = 'READY' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'TIMED-OUT' | 'ABORTED';

export interface ApifyRun {
  id: string;
  status: ApifyRunStatus;
  defaultDatasetId: string;
  /** Apify's own one-line summary of the run. Carries plan and quota refusals verbatim. */
  statusMessage?: string;
}

/**
 * Phrases Apify uses when a run was refused for commercial reasons rather than technical ones.
 *
 * THIS IS THE POINT OF THE WHOLE MECHANISM. A free-tier actor that is out of quota, or whose
 * author forbids API access on the free plan, does **not** fail. It finishes `SUCCEEDED` with
 * `exitCode: 0`, and either writes nothing or writes placeholder `{"noResults": true}` rows. To
 * everything downstream that is indistinguishable from "there was nothing new to collect", so the
 * feed gets a green timestamp and the user is told the source is healthy.
 *
 * Verified against real runs on 2026-08-10, where `statusMessage` read:
 *
 *   "The developer of this actor doesn't allow the use of API in the Free Plan."
 *   "Free tier limit reached (5 total runs). You have used all 5 free runs across all runs."
 *
 * The Play Store source collected 54 reviews once and then returned zero on every subsequent run
 * for a day, reporting success each time. Nothing surfaced it. See `docs/OWNER-ACTIONS.md` §4b.
 */
const REFUSAL_PATTERNS = [
  /free plan/i,
  /free tier/i,
  /paid plan/i,
  /subscribe to a paid/i,
  /quota|limit reached|out of credits/i,
  /**
   * "Finished! Total 1 requests: 0 succeeded, 1 failed."
   *
   * A third variant of the same lie, and the one that reads most like success. Crawlee reports
   * the run as finished — because the crawler itself ran to completion — while every request it
   * made failed. The Google reviews source sat in exactly this state for seven consecutive hourly
   * scans on 2026-08-10 before it began reporting `FAILED` outright.
   *
   * Anchored on "0 succeeded" with a NON-ZERO failure count, so the ordinary
   * "3 succeeded, 0 failed" cannot match it.
   */
  /\b0 succeeded,\s*[1-9]\d* failed/i,
];

/** The message, if it says the run did not really do what its status claims. */
function refusalIn(message: string | undefined): string | undefined {
  if (!message) return undefined;
  return REFUSAL_PATTERNS.some((p) => p.test(message)) ? message : undefined;
}

export async function startApifyRun(
  apiKey: string,
  actorId: string,
  input: Record<string, unknown>,
): Promise<ApifyRun> {
  const res = await fetch(`${APIFY_BASE}/acts/${actorId}/runs?token=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(`Apify start run failed: ${res.status}`);
  const data = (await res.json()) as { data: ApifyRun };
  return data.data;
}

/**
 * Polls a run to completion.
 *
 * THE PATH IS `/actor-runs/`, NOT `/runs/`. This polled `/v2/runs/{id}`, which returns **404**
 * for every run that has ever existed — verified against the live API on 2026-08-10 with a real
 * run id: `/v2/runs/{id}` → 404, `/v2/actor-runs/{id}` → 200. So every Apify-backed adapter
 * started its run successfully, then failed on the first poll, for as long as this code has
 * existed. It was invisible because the Apify token in the deployed environment was never set,
 * so the failure was a 401 at start and nobody reached the poll.
 *
 * That is the shape of this class of bug: one broken thing hiding behind another. Fixing the
 * credential is what revealed it.
 */
export async function waitForApifyRun(apiKey: string, runId: string): Promise<ApifyRun> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const res = await fetch(`${APIFY_BASE}/actor-runs/${runId}?token=${apiKey}`);
    if (!res.ok) throw new Error(`Apify poll failed: ${res.status}`);
    const data = (await res.json()) as { data: ApifyRun };
    const run = data.data;
    if (run.status === 'SUCCEEDED') {
      /* A commercially refused run is a FAILED run wearing a SUCCEEDED badge. Raising here is
         what puts the reason on `source_configs.last_error`, so the feed row says "Free tier
         limit reached" instead of quietly showing a fresh green timestamp and no signals. */
      const refusal = refusalIn(run.statusMessage);
      if (refusal) {
        throw new Error(`Apify reported SUCCEEDED but collected nothing: ${refusal}`);
      }
      return run;
    }
    if (['FAILED', 'TIMED-OUT', 'ABORTED'].includes(run.status)) {
      /* Apify's own message names the cause — an invalid input, a missing field — where the bare
         status only says something went wrong. It is the difference between a defect the person
         who configured the feed can fix and one they cannot. */
      const detail = run.statusMessage ? `: ${run.statusMessage}` : '';
      throw new Error(`Apify run ${runId} ended with status ${run.status}${detail}`);
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  throw new Error(`Apify run ${runId} timed out after ${POLL_TIMEOUT_MS}ms`);
}

/**
 * The run's dataset, with Apify's placeholder rows removed.
 *
 * `{"noResults": true}` is not a record of anything. Several actors emit one per attempted page
 * when they are refused or find nothing, so a refused run yields ten of them — and every field an
 * adapter reads off such a row is `undefined`, producing a signal with no text, no id and an
 * `Invalid Date`. Dropping them here means no adapter has to know the convention, and none can
 * forget it.
 *
 * A run that is ONLY placeholders throws rather than returning an empty array. By that point the
 * refusal check in `waitForApifyRun` has already passed, so this catches the actors that pad the
 * dataset without saying anything in `statusMessage` — and "the actor returned nothing but
 * placeholders" is a fault worth showing on the feed, not a quiet zero.
 */
export async function fetchApifyDataset<T>(apiKey: string, datasetId: string): Promise<T[]> {
  const res = await fetch(`${APIFY_BASE}/datasets/${datasetId}/items?token=${apiKey}&format=json`);
  if (!res.ok) throw new Error(`Apify dataset fetch failed: ${res.status}`);

  const items = (await res.json()) as T[];
  const real = items.filter((item) => !isPlaceholder(item));
  if (items.length > 0 && real.length === 0) {
    throw new Error(
      `Apify returned ${items.length} placeholder row(s) and no data — the actor was refused or found nothing it could report`,
    );
  }
  return real;
}

function isPlaceholder(item: unknown): boolean {
  return typeof item === 'object' && item !== null && (item as { noResults?: unknown }).noResults === true;
}
