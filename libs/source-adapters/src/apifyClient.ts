const APIFY_BASE = 'https://api.apify.com/v2';
const POLL_INTERVAL_MS = 5_000;
const POLL_TIMEOUT_MS = 300_000;

type ApifyRunStatus = 'READY' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'TIMED-OUT' | 'ABORTED';

export interface ApifyRun {
  id: string;
  status: ApifyRunStatus;
  defaultDatasetId: string;
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

export async function waitForApifyRun(apiKey: string, runId: string): Promise<ApifyRun> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const res = await fetch(`${APIFY_BASE}/runs/${runId}?token=${apiKey}`);
    if (!res.ok) throw new Error(`Apify poll failed: ${res.status}`);
    const data = (await res.json()) as { data: ApifyRun };
    const run = data.data;
    if (run.status === 'SUCCEEDED') return run;
    if (['FAILED', 'TIMED-OUT', 'ABORTED'].includes(run.status)) {
      throw new Error(`Apify run ${runId} ended with status: ${run.status}`);
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  throw new Error(`Apify run ${runId} timed out after ${POLL_TIMEOUT_MS}ms`);
}

export async function fetchApifyDataset<T>(apiKey: string, datasetId: string): Promise<T[]> {
  const res = await fetch(`${APIFY_BASE}/datasets/${datasetId}/items?token=${apiKey}&format=json`);
  if (!res.ok) throw new Error(`Apify dataset fetch failed: ${res.status}`);
  return (await res.json()) as T[];
}
