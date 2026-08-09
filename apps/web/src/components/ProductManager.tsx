'use client';

import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import { Check, ChevronRight, Package, Pencil, Plus, Trash2, X } from 'lucide-react';
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

/** The editable fields, which are exactly the ones `PATCH /brands/:id` accepts. */
interface Draft {
  name: string;
  kind: string;
  isOwned: boolean;
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
  /* Which row is open for editing, and its draft. Only one at a time: two open editors invite a
     half-typed name being left behind on a row the user has stopped looking at. */
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>({ name: '', kind: 'product', isOwned: true });
  /* Delete confirms in place rather than through `window.confirm`. A native dialog blocks the
     whole page, cannot be styled, and cannot be driven by the e2e suite — and this button removes
     something. Two deliberate clicks on the row itself is both safer and testable. */
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
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

  async function save(id: string): Promise<void> {
    const next = draft.name.trim();
    /* An empty name is a no-op, not an error. Refusing it loudly would be a lecture for pressing
       Enter on a field the user had already decided to leave alone. */
    if (!next || busy) {
      setEditingId(null);
      return;
    }
    setBusy(true);
    try {
      await apiFetch(`/brands/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ name: next, kind: draft.kind, isOwned: draft.isOwned }),
      });
      setEditingId(null);
      await load();
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save.');
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string): Promise<void> {
    setBusy(true);
    try {
      await apiFetch(`/brands/${id}`, { method: 'DELETE' });
      setConfirmingId(null);
      await load();
      setError(null);
    } catch (err) {
      /* The API's refusals name the specific thing in the way — children, collected signals, an
         assigned user — so they are shown verbatim. Replacing them with "could not delete" would
         throw away the only part that tells the user what to do next. */
      setError(err instanceof Error ? err.message : 'Could not delete.');
      setConfirmingId(null);
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
                    aria-label={`Name of ${node.name}`}
                    value={draft.name}
                    disabled={busy}
                    onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                    onKeyDown={(e) => {
                      /* Enter saves, Escape abandons — the convention everywhere else, and the
                         two keys a person reaches for without thinking. */
                      if (e.key === 'Enter') void save(node.id);
                      if (e.key === 'Escape') setEditingId(null);
                    }}
                    style={{ width: 210 }}
                  />
                  <Select
                    aria-label={`Type of ${node.name}`}
                    value={draft.kind}
                    disabled={busy}
                    onChange={(e) => setDraft((d) => ({ ...d, kind: e.target.value }))}
                    style={{ width: 115 }}
                  >
                    <option value="product">Product</option>
                    <option value="brand">Brand</option>
                  </Select>
                  <Select
                    aria-label={`Ownership of ${node.name}`}
                    value={draft.isOwned ? 'owned' : 'competitor'}
                    disabled={busy}
                    onChange={(e) =>
                      setDraft((d) => ({ ...d, isOwned: e.target.value === 'owned' }))
                    }
                    style={{ width: 135 }}
                  >
                    <option value="owned">Ours</option>
                    <option value="competitor">Competitor</option>
                  </Select>
                  <Button
                    variant="primary"
                    size="sm"
                    disabled={busy}
                    onClick={() => void save(node.id)}
                    icon={<Check size={15} strokeWidth={1.8} aria-hidden="true" />}
                  >
                    Save
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setEditingId(null)}
                    icon={<X size={15} strokeWidth={1.8} aria-hidden="true" />}
                  >
                    Cancel
                  </Button>
                </>
              ) : (
                <>
                  <span style={{ fontWeight: 600, fontSize: 14 }}>{node.name}</span>
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
                    style={{ width: 165 }}
                  >
                    <option value="">— none (top level) —</option>
                    {rows
                      /* An entity cannot be its own parent. Deeper cycles are refused by the API,
                         which is the only place that can see the whole chain. */
                      .filter((r) => r.node.id !== node.id)
                      .map((r) => (
                        <option key={r.node.id} value={r.node.id}>
                          {' '.repeat(r.depth * 2)}
                          {r.node.name}
                        </option>
                      ))}
                  </Select>

                  {/* A labelled button, not a bare ghost icon. The previous version was an
                      icon-only pencil wedged between a name and a badge, and it read as
                      decoration: the owner added sixteen products and reported there was no way
                      to edit them. An affordance nobody finds is an affordance that is not
                      there. */}
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={busy}
                    onClick={() => {
                      setConfirmingId(null);
                      setEditingId(node.id);
                      setDraft({ name: node.name, kind: node.kind, isOwned: node.isOwned });
                    }}
                    icon={<Pencil size={14} strokeWidth={1.8} aria-hidden="true" />}
                  >
                    Edit
                  </Button>

                  {confirmingId === node.id ? (
                    <>
                      <Button
                        variant="danger"
                        size="sm"
                        disabled={busy}
                        onClick={() => void remove(node.id)}
                      >
                        Confirm delete
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setConfirmingId(null)}>
                        Keep
                      </Button>
                    </>
                  ) : (
                    <Button
                      variant="ghost"
                      size="sm"
                      iconOnly
                      disabled={busy}
                      onClick={() => setConfirmingId(node.id)}
                      icon={<Trash2 size={14} strokeWidth={1.8} aria-hidden="true" />}
                    >
                      Delete {node.name}
                    </Button>
                  )}
                </>
              )}
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
