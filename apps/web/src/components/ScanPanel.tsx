'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { Badge, Button } from '@/design-system';
import { apiFetch } from '@/lib/api';
import { useBrand } from '@/lib/brand-context';

/**
 * The scan button, and the status that makes it usable.
 *
 * Collection is asynchronous, takes minutes, and writes signals that will not reach the dashboard
 * until a rollup has also run. Without visible progress the user presses Scan and observes
 * nothing at all — so they press it again. This shows *queued → running → 47 signals collected*,
 * which is the difference between a feature and a leap of faith.
 */

interface ScanRun {
  id: string;
  status: string;
  trigger: string;
  sourcesAttempted: number;
  sourcesSucceeded: number;
  signalsCollected: number;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
}

const ACTIVE = ['queued', 'running'];

/** Poll only while something is actually happening. */
const POLL_MS = 4000;

function tone(status: string): 'positive' | 'critical' | 'info' | 'neutral' {
  if (status === 'completed') return 'positive';
  if (status === 'failed') return 'critical';
  if (ACTIVE.includes(status)) return 'info';
  return 'neutral';
}

function when(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

export function ScanPanel() {
  const { brandId, selected } = useBrand();
  const [runs, setRuns] = useState<ScanRun[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    if (!brandId) return;
    try {
      setRuns(await apiFetch<ScanRun[]>(`/brands/${brandId}/scans`));
    } catch {
      /* A failed status read must not disable the button — the user can still start a scan, and
         the next poll may well succeed. */
    }
  }, [brandId]);

  useEffect(() => {
    void load();
  }, [load]);

  /* Poll ONLY while a run is active, and stop the moment it finishes. A permanent 4-second
     interval against an idle brand is a request every four seconds, forever, per open tab. */
  useEffect(() => {
    const active = runs.some((r) => ACTIVE.includes(r.status));
    if (timer.current) clearTimeout(timer.current);
    if (!active) return;
    timer.current = setTimeout(() => void load(), POLL_MS);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [runs, load]);

  async function scan(): Promise<void> {
    if (!brandId || busy) return;
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/brands/${brandId}/scan`, { method: 'POST' });
      await load();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(
        message.includes('409')
          ? 'A scan is already running for this brand.'
          : 'Could not start the scan. Try again shortly.',
      );
      /* Refresh regardless: on a 409 the run that blocked us is the one worth showing. */
      await load();
    } finally {
      setBusy(false);
    }
  }

  const latest = runs[0];
  const running = latest ? ACTIVE.includes(latest.status) : false;

  return (
    <div className="ds-card" style={{ padding: 24, marginTop: 20 }}>
      <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 18, margin: '0 0 4px' }}>
        Collect signals
      </h2>
      <p style={{ color: 'var(--t2)', fontSize: 13, margin: '0 0 16px' }}>
        Runs every enabled source for {selected?.name ?? 'this brand'} now. Collection takes a few
        minutes, and scores appear once the next rollup has run.
      </p>

      {error && (
        <p className="ds-assistant__error" role="alert" style={{ marginBottom: 14 }}>
          {error}
        </p>
      )}

      <Button
        variant="primary"
        onClick={() => void scan()}
        disabled={!brandId || busy || running}
        icon={<RefreshCw size={16} strokeWidth={1.8} aria-hidden="true" />}
      >
        {running ? 'Scan in progress…' : busy ? 'Starting…' : 'Scan now'}
      </Button>

      {runs.length > 0 && (
        <ul style={{ listStyle: 'none', margin: '18px 0 0', padding: 0 }}>
          {runs.slice(0, 5).map((run) => (
            <li
              key={run.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '8px 0',
                borderTop: '1px solid var(--line)',
                fontSize: 13,
              }}
            >
              <Badge tone={tone(run.status)}>{run.status}</Badge>
              <span style={{ color: 'var(--t2)' }}>
                {run.status === 'completed'
                  ? `${run.signalsCollected} signal${run.signalsCollected === 1 ? '' : 's'} from ${run.sourcesSucceeded}/${run.sourcesAttempted} source${run.sourcesAttempted === 1 ? '' : 's'}`
                  : run.status === 'failed'
                    ? 'did not run'
                    : 'collecting…'}
              </span>
              {/* The reason, verbatim. A failed run that says only "failed" sends someone to logs
                  they cannot reach; a partial one needs to say which feed was broken. */}
              {run.error && (
                <span style={{ color: 'var(--t3)', flex: 1, minWidth: 0 }} title={run.error}>
                  {run.error.length > 70 ? `${run.error.slice(0, 70)}…` : run.error}
                </span>
              )}
              <span style={{ marginLeft: 'auto', color: 'var(--t3)' }}>{when(run.startedAt)}</span>
              {run.trigger === 'scheduled' && <Badge tone="neutral">scheduled</Badge>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
