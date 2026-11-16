'use client';

import { Building2 } from 'lucide-react';
import { useBrand } from '@/lib/brand-context';

/**
 * Chooses which brand every view is about.
 *
 * Before this existed the app always showed the FIRST owned brand. A tenant tracking several of
 * its own brands — or wanting to look at a competitor's evidence directly — had no way to change
 * it; the provider exposed `setBrandId` and nothing called it.
 *
 * Owned brands are listed before competitors, each group alphabetically, and competitors are
 * labelled as such so a reading of a rival's numbers is never mistaken for your own. Hidden when
 * there is nothing to choose between, including for a `user` pinned to one brand.
 */
export function BrandSwitcher() {
  const { brands, brandId, setBrandId } = useBrand();
  if (brands.length < 2) return null;

  const sorted = brands
    .slice()
    .sort((a, b) => Number(b.isOwned) - Number(a.isOwned) || a.name.localeCompare(b.name));

  return (
    <label className="terr-picker" title="Choose the brand every view is about">
      <Building2 size={15} strokeWidth={1.8} aria-hidden="true" />
      <span className="sr-only">Brand</span>
      <select aria-label="Brand" value={brandId ?? ''} onChange={(e) => setBrandId(e.target.value)}>
        {sorted.map((b) => (
          <option key={b.id} value={b.id}>
            {b.isOwned ? b.name : `${b.name} (competitor)`}
          </option>
        ))}
      </select>
    </label>
  );
}
