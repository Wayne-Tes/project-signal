'use client';

import { useApi } from './useApi';
import { useBrand } from '@/lib/brand-context';
import type { ApiDimensionRow } from '@/lib/brand-data';

/**
 * The window the brand's scored data actually covers, for the top-bar label.
 *
 * The label previously printed `PS_BRAND.period` — a fixed string from the fictional-bank
 * fixture, describing a reporting window that corresponded to nothing. It was left visible and
 * marked as a stub rather than deleted (docs/STUBS.md), because removing a control silently is
 * not a decision that layer gets to take. This is the real version.
 *
 * Returns `null` rather than a placeholder when there is no data. An empty top bar is honest; a
 * date range for a brand with no scores is not.
 */
export function useReportingPeriod(): string | null {
  const { brandId } = useBrand();
  const { data } = useApi<ApiDimensionRow[]>(
    brandId ? `/brands/${brandId}/dimension-scores?days=90` : null,
  );

  if (!data || data.length === 0) return null;

  const dates = data.map((r) => r.date).sort();
  const from = dates[0];
  const to = dates[dates.length - 1];
  if (!from || !to) return null;

  const fmt = (iso: string): string =>
    new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

  /* A single day is a date, not a range — "3 Aug – 3 Aug" reads as a formatting fault. */
  return from === to ? fmt(to) : `${fmt(from)} – ${fmt(to)}`;
}
