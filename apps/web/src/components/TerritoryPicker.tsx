'use client';

import { useEffect, useState } from 'react';
import { Globe } from 'lucide-react';
import { TERRITORY_ALL, TERRITORY_LABELS, type Territory } from '@project-signal/shared-types';
import { useBrand } from '@/lib/brand-context';
import { apiFetch } from '@/lib/api';

/**
 * The territory lens, in the top bar beside the brand.
 *
 * ONLY OFFERS TERRITORIES THE BRAND ACTUALLY COLLECTS FROM. A full ISO list would be a dozen
 * options, eleven of which return an empty dashboard — and an empty dashboard is
 * indistinguishable from a broken one, so every one of those is a support question. The options
 * come from the brand's configured feeds, so choosing one always leads somewhere.
 *
 * `unknown` is offered when it is present, and labelled "Not set" rather than hidden. Signals
 * collected before the column existed, and feeds nobody has classified, sit there — and hiding
 * them would make the territory breakdown quietly fail to add up to the total, which is worse
 * than showing a bucket someone needs to clear.
 */
export function TerritoryPicker() {
  const { brandId, territory, setTerritory } = useBrand();
  const [available, setAvailable] = useState<string[]>([]);

  useEffect(() => {
    if (!brandId) {
      setAvailable([]);
      return;
    }
    let cancelled = false;

    void (async () => {
      try {
        const feeds = await apiFetch<{ data: { territory?: string }[] }>(
          `/brands/${brandId}/integrations`,
        );
        const found = [...new Set((feeds.data ?? []).map((f) => f.territory).filter(Boolean))];
        if (!cancelled) setAvailable(found as string[]);
      } catch {
        /* A failure here must not break the page. With no options the picker hides itself, which
           is the same state as a brand with one territory — the dashboard still works, it just
           has no lens to offer. */
        if (!cancelled) setAvailable([]);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [brandId]);

  /* Reset when the brand changes. A territory the previous brand collected from may not exist
     for this one, and leaving it selected would show an empty dashboard for a brand that has
     plenty of data. */
  useEffect(() => {
    setTerritory(TERRITORY_ALL);
  }, [brandId, setTerritory]);

  /* Nothing to choose between: one territory, or none configured. Rendering a control with a
     single option invites a click that changes nothing. */
  if (available.length < 2) return null;

  const label = (code: string): string =>
    TERRITORY_LABELS[code as Territory] ?? code;

  return (
    <label className="terr-picker" title="Filter every view to one territory">
      <Globe size={15} strokeWidth={1.8} aria-hidden="true" />
      <span className="sr-only">Territory</span>
      <select
        aria-label="Territory"
        value={territory}
        onChange={(e) => setTerritory(e.target.value)}
      >
        <option value={TERRITORY_ALL}>All territories</option>
        {available
          .slice()
          .sort((a, b) => label(a).localeCompare(label(b)))
          .map((code) => (
            <option key={code} value={code}>
              {label(code)}
            </option>
          ))}
      </select>
    </label>
  );
}
