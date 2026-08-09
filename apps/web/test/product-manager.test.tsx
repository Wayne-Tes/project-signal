import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const apiFetch = vi.fn();
vi.mock('@/lib/api', () => ({ apiFetch: (...a: unknown[]) => apiFetch(...a) }));

const { ProductManager } = await import('../src/components/ProductManager');

/**
 * Brand and product management.
 *
 * REGRESSION THIS FILE EXISTS FOR. The edit control shipped as an icon-only ghost pencil wedged
 * between a name and a badge. It worked; nobody could see it. The owner added sixteen products
 * and reported there was no way to edit them — which, as an affordance, is the same thing as it
 * not being there. So the assertions below are deliberately about what a person can FIND and
 * PRESS by its accessible name, not about internal state: `getByRole('button', {name: 'Edit'})`
 * fails the moment the control goes back to being decoration.
 *
 * The second thing guarded here is delete. It removes something, so it takes two deliberate
 * clicks — and it must never fire on the first.
 */

const TREE = [
  {
    id: 'tes',
    name: 'Tes',
    slug: 'tes',
    parentId: null,
    kind: 'brand',
    isOwned: true,
    children: [
      {
        id: 'cc',
        name: 'Class charts',
        slug: 'class-charts',
        parentId: 'tes',
        kind: 'product',
        isOwned: true,
        children: [],
      },
    ],
  },
];

/**
 * The row for a named entity, so queries cannot accidentally match a sibling.
 *
 * Every name appears many times over: once as its own row label, and again as an `<option>` in
 * the parent picker of every OTHER row. So this matches the label element specifically rather
 * than the first text hit.
 */
function row(name: string): HTMLElement {
  const label = screen.getAllByText(name).find((el) => el.tagName === 'SPAN');
  const li = label?.closest('li');
  if (!li) throw new Error(`no row for ${name}`);
  return li as HTMLElement;
}

beforeEach(() => {
  apiFetch.mockReset();
  apiFetch.mockResolvedValue(TREE);
});

describe('finding the edit control', () => {
  it('shows a labelled Edit button on every row', async () => {
    render(<ProductManager />);
    await waitFor(() => row('Class charts'));

    /* By accessible NAME. An icon with a visually-hidden label would satisfy a query for
       /rename/i; it did, and it was still invisible. This asks for the word on the button. */
    const edits = screen.getAllByRole('button', { name: 'Edit' });
    expect(edits).toHaveLength(2);
  });

  it('renders the tree, parent under child', async () => {
    render(<ProductManager />);
    await waitFor(() => expect(row('Tes')).toBeTruthy());
    expect(row('Class charts')).toBeTruthy();
  });
});

describe('editing', () => {
  it('opens an editor pre-filled with the current values', async () => {
    render(<ProductManager />);
    await waitFor(() => row('Class charts'));
    await userEvent.click(within(row('Class charts')).getByRole('button', { name: 'Edit' }));

    expect(screen.getByLabelText('Name of Class charts')).toHaveProperty('value', 'Class charts');
    expect(screen.getByLabelText('Type of Class charts')).toHaveProperty('value', 'product');
    expect(screen.getByLabelText('Ownership of Class charts')).toHaveProperty('value', 'owned');
  });

  it('saves name, type and ownership together', async () => {
    /* All three in one PATCH. The API accepts them together, and saving them one at a time would
       mean a half-applied edit if the second call failed. */
    render(<ProductManager />);
    await waitFor(() => row('Class charts'));
    await userEvent.click(within(row('Class charts')).getByRole('button', { name: 'Edit' }));

    const input = screen.getByLabelText('Name of Class charts');
    await userEvent.clear(input);
    await userEvent.type(input, 'ClassCharts');
    await userEvent.selectOptions(screen.getByLabelText('Ownership of Class charts'), 'competitor');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      const patch = apiFetch.mock.calls.find((c) => c[1]?.method === 'PATCH');
      expect(patch?.[0]).toBe('/brands/cc');
      expect(JSON.parse(patch?.[1].body)).toEqual({
        name: 'ClassCharts',
        kind: 'product',
        isOwned: false,
      });
    });
  });

  it('saves on Enter', async () => {
    render(<ProductManager />);
    await waitFor(() => row('Class charts'));
    await userEvent.click(within(row('Class charts')).getByRole('button', { name: 'Edit' }));

    const input = screen.getByLabelText('Name of Class charts');
    await userEvent.clear(input);
    await userEvent.type(input, 'ClassCharts{Enter}');

    await waitFor(() => {
      expect(apiFetch.mock.calls.some((c) => c[1]?.method === 'PATCH')).toBe(true);
    });
  });

  it('abandons on Escape without sending anything', async () => {
    render(<ProductManager />);
    await waitFor(() => row('Class charts'));
    await userEvent.click(within(row('Class charts')).getByRole('button', { name: 'Edit' }));
    await userEvent.type(screen.getByLabelText('Name of Class charts'), 'zzz{Escape}');

    expect(apiFetch.mock.calls.some((c) => c[1]?.method === 'PATCH')).toBe(false);
    expect(screen.queryByLabelText('Name of Class charts')).toBeNull();
  });

  it('treats an emptied name as cancel, not as an error', async () => {
    /* Clearing the field and pressing Save is someone changing their mind. Rejecting it loudly
       would be a lecture; sending it would blank the name and rewrite the slug to "brand". */
    render(<ProductManager />);
    await waitFor(() => row('Class charts'));
    await userEvent.click(within(row('Class charts')).getByRole('button', { name: 'Edit' }));
    await userEvent.clear(screen.getByLabelText('Name of Class charts'));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(apiFetch.mock.calls.some((c) => c[1]?.method === 'PATCH')).toBe(false);
  });

  it('edits one row at a time', async () => {
    render(<ProductManager />);
    await waitFor(() => row('Class charts'));
    await userEvent.click(within(row('Class charts')).getByRole('button', { name: 'Edit' }));
    await userEvent.click(within(row('Tes')).getByRole('button', { name: 'Edit' }));

    expect(screen.queryByLabelText('Name of Class charts')).toBeNull();
    expect(screen.getByLabelText('Name of Tes')).toBeTruthy();
  });

  it('surfaces a failed save instead of silently closing', async () => {
    render(<ProductManager />);
    await waitFor(() => row('Class charts'));
    await userEvent.click(within(row('Class charts')).getByRole('button', { name: 'Edit' }));
    apiFetch.mockRejectedValueOnce(new Error('409: name already taken'));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByRole('alert')).toHaveProperty('textContent', '409: name already taken');
  });
});

describe('deleting', () => {
  it('does NOT delete on the first click', async () => {
    render(<ProductManager />);
    await waitFor(() => row('Class charts'));
    await userEvent.click(within(row('Class charts')).getByRole('button', { name: /^Delete/ }));

    expect(apiFetch.mock.calls.some((c) => c[1]?.method === 'DELETE')).toBe(false);
    expect(screen.getByRole('button', { name: 'Confirm delete' })).toBeTruthy();
  });

  it('deletes on the second, confirming click', async () => {
    render(<ProductManager />);
    await waitFor(() => row('Class charts'));
    await userEvent.click(within(row('Class charts')).getByRole('button', { name: /^Delete/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Confirm delete' }));

    await waitFor(() => {
      const del = apiFetch.mock.calls.find((c) => c[1]?.method === 'DELETE');
      expect(del?.[0]).toBe('/brands/cc');
    });
  });

  it('backs out on Keep', async () => {
    render(<ProductManager />);
    await waitFor(() => row('Class charts'));
    await userEvent.click(within(row('Class charts')).getByRole('button', { name: /^Delete/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Keep' }));

    expect(screen.queryByRole('button', { name: 'Confirm delete' })).toBeNull();
    expect(apiFetch.mock.calls.some((c) => c[1]?.method === 'DELETE')).toBe(false);
  });

  it("shows the API's refusal verbatim, because it says what to do next", async () => {
    /* "Cannot delete" on its own sends someone to a database they have no access to. The API
       names the specific blocker — children, collected signals, an assigned user — and that is
       the only part of the message worth reading. */
    render(<ProductManager />);
    await waitFor(() => row('Class charts'));
    await userEvent.click(within(row('Class charts')).getByRole('button', { name: /^Delete/ }));
    apiFetch.mockRejectedValueOnce(
      new Error('409: Cannot delete this entity because signals have been collected for it.'),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Confirm delete' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/signals have been collected/);
    /* And the confirm state closes, so the button is not left armed under an error. */
    expect(screen.queryByRole('button', { name: 'Confirm delete' })).toBeNull();
  });

  it('arms only one row at a time', async () => {
    render(<ProductManager />);
    await waitFor(() => row('Class charts'));
    await userEvent.click(within(row('Class charts')).getByRole('button', { name: /^Delete/ }));
    await userEvent.click(within(row('Tes')).getByRole('button', { name: /^Delete/ }));

    expect(screen.getAllByRole('button', { name: 'Confirm delete' })).toHaveLength(1);
  });
});

describe('re-parenting', () => {
  it('sends null rather than an empty string when promoting to a root', async () => {
    /* The API distinguishes "not supplied" from "promote to root". An empty string would be read
       as a lookup for an entity with that id and fail as a missing parent, which would make it
       impossible ever to detach a product. */
    render(<ProductManager />);
    await waitFor(() => row('Class charts'));
    await userEvent.selectOptions(within(row('Class charts')).getByLabelText('Parent'), '');

    await waitFor(() => {
      const patch = apiFetch.mock.calls.find((c) => c[1]?.method === 'PATCH');
      expect(JSON.parse(patch?.[1].body)).toEqual({ parentId: null });
    });
  });

  it('never offers an entity itself as its own parent', async () => {
    render(<ProductManager />);
    await waitFor(() => row('Class charts'));
    const options = within(row('Class charts'))
      .getByLabelText('Parent')
      .querySelectorAll('option');

    expect([...options].map((o) => o.textContent?.trim())).not.toContain('Class charts');
  });
});
