'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { apiFetch } from '@/lib/api';
import { TERRITORY_ALL } from '@project-signal/shared-types';
import type { ApiBrand } from '@/lib/brand-data';

interface BrandContextValue {
  brands: ApiBrand[];
  brandId: string | null;
  /**
   * The territory currently being viewed, or 'all'.
   *
   * Held here rather than in each view for the same reason the brand is: every analytical view
   * asks the same question of the same scope, and holding it per view means two of them can
   * disagree about what the user is looking at while both render confidently.
   *
   * NOT PERSISTED. The brand is a durable choice; a territory filter is a lens you look through
   * and put down, and a stale one silently restored on the next visit would have someone reading
   * Australian numbers under a UK heading.
   */
  territory: string;
  setTerritory: (t: string) => void;
  selected: ApiBrand | null;
  setBrandId: (id: string) => void;
  loading: boolean;
  error: string | null;
  reload: () => void;
}

const BrandContext = createContext<BrandContextValue | null>(null);

/**
 * Loads the tenant's brands and holds the one currently being viewed.
 *
 * The shell previously hard-coded a single fictional brand, so there was no notion of a
 * selected brand at all. Defaults to the first owned brand — `GET /brands` already restricts a
 * pinned `user` to their own brand, so for that role the list is the pin.
 */
export function BrandProvider({ children }: { children: ReactNode }) {
  const [brands, setBrands] = useState<ApiBrand[]>([]);
  const [brandId, setBrandId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const [territory, setTerritory] = useState<string>(TERRITORY_ALL);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    apiFetch<ApiBrand[]>('/brands')
      .then((rows) => {
        if (cancelled) return;
        setBrands(rows);
        setBrandId((current) => current ?? rows.find((b) => b.isOwned)?.id ?? rows[0]?.id ?? null);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load brands');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [nonce]);

  const value = useMemo<BrandContextValue>(
    () => ({
      brands,
      brandId,
      selected: brands.find((b) => b.id === brandId) ?? null,
      setBrandId,
      territory,
      setTerritory,
      loading,
      error,
      reload,
    }),
    [brands, brandId, territory, loading, error, reload],
  );

  return <BrandContext.Provider value={value}>{children}</BrandContext.Provider>;
}

export function useBrand(): BrandContextValue {
  const ctx = useContext(BrandContext);
  if (!ctx) throw new Error('useBrand must be used inside a BrandProvider');
  return ctx;
}
