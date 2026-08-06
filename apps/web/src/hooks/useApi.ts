'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';

export interface ApiState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
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
  const [state, setState] = useState<ApiState<T>>({ data: null, loading: true, error: null });

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
  }, [path]);

  return state;
}
