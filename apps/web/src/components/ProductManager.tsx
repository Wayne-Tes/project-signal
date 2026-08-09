'use client';

import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import { Check, ChevronRight, Package, Pencil, Plus, X } from 'lucide-react';
import { apiFetch } from '@/lib/api';
import { Badge, Button, Input, Select } from '@/design-system';

/**
 * Brand and product management.
 *
 * A product is a brand entity with a parent, so everything here is one tree of the same thing.
 * That is not an implementation detail leaking into the UI — it is the useful part: a product
 * created here immediately has its own index, dimensions, Brand impact and drill-down, because
 * every one of those keys off the same entity id.
 *
 * Re-parenting is a `<select>` of candidate parents rather than drag-and-drop. With twenty
 * products across acquired brands, an accidental drop that silently moves a product between
 * divisions is a worse outcome than a slower, deliberate choice.
 */

interface Entity {
  id: string;
  name: string;
  slug: string;
  parentId: string | null;
  kind: string;
  isOwned: boolean;
  children?: Entity[];
}

/** Flattens the tree, carrying depth, for the list and the parent picker. */
function flatten(nodes: Entity[], depth = 0): { node: Entity; depth: number }[] {
  return nodes.flatMap((n) => [{ node: n, depth }, ...flatten(n.children ?? [], depth + 1)]);
}

export function ProductManager() {
  const [tree, setTree] = useState<Entity[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [name, setName] = useState('');
  /* Which row is being renamed, and the draft value. Only one at a time: two open editors invite
     a half-typed name being left behind on a row the user has stopped looking at. */
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [parentId, setParentId] = useState('');
  const [kind, setKind] = useState('product');

  const load = useCallback(async () => {
    try {
      setTree(await apiFetch<Entity[]>('/brands/tree'));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load brands.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const rows = flatten(tree);

  async function create(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true);
    try {
      await apiFetch('/brands', {
        method: 'POST',
        body: JSON.stringify({
          name: name.trim(),
          /* Empty string means "no parent" — a root brand. Sending "" would be a lookup for an
             entity with that id, which fails as a missing parent rather than creating a root. */
          parentId: parentId || undefined,
          kind,
        }),
      });
      setName('');
      await load();
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create.');
    } finally {
      setBusy(false);
    }
  }

  async function rename(id: string): Promise<void> {
    const next = draft.trim();
    /* An unchanged or empty name is a no-op, not an error. Sending it would rewrite the slug for
       nothing, and refusing it loudly would be a lecture for pressing Enter. */
    if (!next || busy) {
      setEditingId(null);
      return;
    }
    setBusy(true);
    try {
      await apiFetch(`/brands/${id}`, { method: 'PATCH', body: JSON.stringify({ name: next }) });
      setEditingId(null);
      await load();
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not rename.');
    } finally {
      setBusy(false);
    }
  }

  async function reparent(id: string, newParent: string): Promise<void> {
    setBusy(true);
    try {
      await apiFetch(`/brands/${id}`, {
        method: 'PATCH',
        /* null, not undefined — the API distinguishes "not supplied" from "promote to root", and
           without that a product could never be detached from its parent. */
        body: JSON.stringify({ parentId: newParent || null }),
      });
      await load();
      setError(null);
    } catch (err) {
      /* The most likely rejection is the cycle guard, and its message says exactly what happened,
         so it is shown verbatim rather than replaced with something generic. */
      setError(err instanceof Error ? err.message : 'Could not move.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="ds-card" style={{ padding: 24, marginTop: 20 }}>
      <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 18, margin: '0 0 4px' }}>
        Brands and products
      </h2>
      <p style={{ color: 'var(--t2)', fontSize: 13, margin: '0 0 20px' }}>
        A product is scored exactly like a brand — its own index, dimensions, Brand impact and
        drill-down. Group them so you can read the portfolio as well as the whole.
      </p>

      {error && (
        <p className="ds-assistant__error" role="alert" style={{ marginBottom: 16 }}>
          {error}
        </p>
      )}

      {rows.length === 0 ? (
        <p style={{ color: 'var(--t3)', fontSize: 13 }}>No brands yet.</p>
      ) : (
        <ul style={{ listStyle: 'none', margin: '0 0 20px', padding: 0 }}>
          {rows.map(({ node, depth }) => (
            <li
              key={node.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '8px 0',
                paddingLeft: depth * 22,
                borderBottom: '1px solid var(--line)',
              }}
            >
              {depth > 0 && (
                <ChevronRight size={14} strokeWidth={1.8} style={{ color: 'var(--t3)' }} aria-hidden="true" />
              )}
              {node.kind === 'product' && (
                <Package size={15} strokeWidth={1.8} style={{ color: 'var(--accent)' }} aria-hidden="true" />
              )}
              {editingId === node.id ? (
                <>
                  <Input
                    autoFocus
                    aria-label={`Rename ${node.name}`}
                    value={draft}
                    disabled={busy}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      /* Enter saves, Escape abandons — the convention everywhere else, and the
                         two keys a person reaches for without thinking. */
                      if (e.key === 'Enter') void rename(node.id);
                      if (e.key === 'Escape') setEditingId(null);
                    }}
                    style={{ width: 240 }}
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    iconOnly
                    disabled={busy}
                    onClick={() => void rename(node.id)}
                    icon={<Check size={15} strokeWidth={1.8} aria-hidden="true" />}
                  >
                    Save name
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    iconOnly
                    onClick={() => setEditingId(null)}
                    icon={<X size={15} strokeWidth={1.8} aria-hidden="true" />}
                  >
                    Cancel rename
                  </Button>
                </>
              ) : (
                <>
                  <span style={{ fontWeight: 600, fontSize: 14 }}>{node.name}</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    iconOnly
                    onClick={() => {
                      setEditingId(node.id);
                      setDraft(node.name);
                    }}
                    icon={<Pencil size={14} strokeWidth={1.8} aria-hidden="true" />}
                  >
                    Rename {node.name}
                  </Button>
                </>
              )}
              <Badge tone={node.isOwned ? 'info' : 'neutral'}>
                {node.isOwned ? node.kind : 'competitor'}
              </Badge>

              <span style={{ flex: 1 }} />

              <label style={{ fontSize: 12, color: 'var(--t3)' }} htmlFor={`parent-${node.id}`}>
                Parent
              </label>
              <Select
                id={`parent-${node.id}`}
                value={node.parentId ?? ''}
                disabled={busy}
                onChange={(e) => void reparent(node.id, e.target.value)}
                style={{ width: 190 }}
              >
                <option value="">— none (top level) —</option>
                {rows
                  /* An entity cannot be its own parent. Deeper cycles are refused by the API,
                     which is the only place that can see the whole chain. */
                  .filter((r) => r.node.id !== node.id)
                  .map((r) => (
                    <option key={r.node.id} value={r.node.id}>
                      {' '.repeat(r.depth * 2)}
                      {r.node.name}
                    </option>
                  ))}
              </Select>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={(e) => void create(e)}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div>
            <label style={lbl} htmlFor="entityName">
              Name
            </label>
            <Input
              id="entityName"
              value={name}
              placeholder="e.g. Tes Assess"
              onChange={(e) => setName(e.target.value)}
              style={{ width: 220 }}
            />
          </div>
          <div>
            <label style={lbl} htmlFor="entityParent">
              Sits under
            </label>
            <Select
              id="entityParent"
              value={parentId}
              onChange={(e) => setParentId(e.target.value)}
              style={{ width: 200 }}
            >
              <option value="">— none (top level) —</option>
              {rows.map((r) => (
                <option key={r.node.id} value={r.node.id}>
                  {' '.repeat(r.depth * 2)}
                  {r.node.name}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <label style={lbl} htmlFor="entityKind">
              Type
            </label>
            <Select id="entityKind" value={kind} onChange={(e) => setKind(e.target.value)} style={{ width: 130 }}>
              <option value="product">Product</option>
              <option value="brand">Brand</option>
            </Select>
          </div>
          <Button
            type="submit"
            variant="primary"
            disabled={busy || !name.trim()}
            icon={<Plus size={16} strokeWidth={1.8} aria-hidden="true" />}
          >
            Add
          </Button>
        </div>
      </form>
    </div>
  );
}

const lbl: CSSProperties = {
  display: 'block',
  fontSize: 12,
  color: 'var(--t2)',
  margin: '12px 0 4px',
};
