'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';

export interface ApiState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  /**
   * Refetches the same path.
   *
   * Added because a view that WRITES then needs to re-read had no way to. Without it the Roadmap
   * had to tell the user to reload the page after saving a target — leaving the old number on
   * screen looking like the save had failed — and an accepted action would still render as
   * unaccepted, inviting a second click that stamps a second baseline against the same subject.
   */
  reload: () => void;
}

/**
 * Fetches an API path and tracks loading and error state.
 *
 * `path` of `null` means "nothing to fetch yet" — used while the selected brand is still
 * loading, so views do not fire a request against `/brands/null/...`. Every view that reads
 * live data must render all three states; an empty result is not the same as a failed one, and
 * both differ from still-loading.
 */
export function useApi<T>(path: string | null): ApiState<T> {
  const [state, setState] = useState<Omit<ApiState<T>, 'reload'>>({
    data: null,
    loading: true,
    error: null,
  });
  /* Bumped to re-run the effect against the SAME path. A boolean would not work — it has to
     change value every time, not toggle between two. */
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!path) {
      setState({ data: null, loading: true, error: null });
      return;
    }

    let cancelled = false;
    setState({ data: null, loading: true, error: null });

    apiFetch<T>(path)
      .then((data) => {
        if (!cancelled) setState({ data, loading: false, error: null });
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setState({
          data: null,
          loading: false,
          error: e instanceof Error ? e.message : 'Request failed',
        });
      });

    return () => {
      cancelled = true;
    };
  }, [path, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  return { ...state, reload };
}
