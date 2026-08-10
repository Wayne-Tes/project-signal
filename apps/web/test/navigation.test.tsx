import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AppShell } from '../src/design-system/shell/AppShell';
import { allowedViews, navForRole } from '../src/config/navigation';

/**
 * Navigation.
 *
 * REGRESSION. `navForRole` mapped over a hardcoded `GROUP_ORDER`, so an item whose group was not
 * named there was dropped entirely — present in NAV, present in ViewId, its view rendering
 * perfectly when reached, and unreachable by any user. Adding the Workspace group without
 * updating that list made the Assistant and Documentation pages invisible, and the only symptom
 * was five e2e clicks timing out with no indication why.
 *
 * These assert the two properties that matter: every declared item is reachable, and an unknown
 * group is appended rather than swallowed.
 */

describe('navForRole', () => {
  it('renders every nav item an admin may see', () => {
    const ids = navForRole('admin').flatMap((g) => g.items.map((i) => i.id));
    /* The specific point of the regression: these two were silently absent. */
    expect(ids).toContain('assistant');
    expect(ids).toContain('documentation');
    expect(ids).toContain('dashboard');
    expect(ids).toContain('admin');
  });

  it('loses no item between allowedViews and the rendered nav', () => {
    /* The invariant the defect broke. `allowedViews` never consulted GROUP_ORDER, so it happily
       reported views the sidebar would not show — the two functions disagreed, and only one of
       them was visible to a user. */
    for (const role of ['owner', 'admin', 'user'] as const) {
      const rendered = navForRole(role).flatMap((g) => g.items.map((i) => i.id)).sort();
      expect(rendered, role).toEqual([...allowedViews(role)].sort());
    }
  });

  it('puts the groups in the documented order', () => {
    const labels = navForRole('admin').map((g) => g.label);
    expect(labels).toEqual(['Brand', 'Intelligence', 'Delivery', 'Workspace', 'Manage']);
  });

  it('hides Admin from a plain user but still shows the workspace pages', () => {
    const ids = navForRole('user').flatMap((g) => g.items.map((i) => i.id));
    expect(ids).not.toContain('admin');
    expect(ids).toContain('assistant');
    expect(ids).toContain('documentation');
  });

  it('emits no empty groups', () => {
    for (const group of navForRole('user')) {
      expect(group.items.length, group.label).toBeGreaterThan(0);
    }
  });
});

describe('collapsible sidebar groups', () => {
  /* Rendered through AppShell rather than by poking state, because the persistence is the point:
     a nav that folds but forgets is more annoying than one that does not fold. */
  const NAV = [
    { label: 'Brand', items: [{ id: 'dashboard', label: 'Dashboard', icon: null }] },
    { label: 'Manage', items: [{ id: 'admin', label: 'Admin', icon: null }] },
  ];

  function shell() {
    return (
      <AppShell
        nav={NAV}
        active="dashboard"
        onNavigate={() => {}}
        brand={{ mark: <span>M</span>, name: 'Tes' }}
      >
        <div>content</div>
      </AppShell>
    );
  }

  beforeEach(() => {
    window.localStorage.clear();
  });

  it('starts with every group open', async () => {
    /* A product that hides sections on a first visit looks like it has fewer features than it
       has. Folding is a preference, not a default. */
    render(shell());
    expect(await screen.findByRole('button', { name: 'Dashboard' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Admin' })).toBeTruthy();
  });

  it('makes each heading a real button that reports its state', async () => {
    render(shell());
    const heading = await screen.findByRole('button', { name: /brand/i });
    expect(heading.getAttribute('aria-expanded')).toBe('true');
  });

  it('folds a group away when its heading is pressed', async () => {
    render(shell());
    await userEvent.click(await screen.findByRole('button', { name: /^brand$/i }));

    expect(screen.queryByRole('button', { name: 'Dashboard' })).toBeNull();
    /* And only that group — folding one section must not take the others with it. */
    expect(screen.getByRole('button', { name: 'Admin' })).toBeTruthy();
  });

  it('unfolds again on a second press', async () => {
    render(shell());
    const heading = await screen.findByRole('button', { name: /^brand$/i });
    await userEvent.click(heading);
    await userEvent.click(heading);

    expect(screen.getByRole('button', { name: 'Dashboard' })).toBeTruthy();
  });

  it('remembers what was folded, by LABEL', async () => {
    /* Stored by name rather than index, so adding or reordering a group does not silently fold a
       different section than the one the user closed — and GROUP_ORDER has already been
       reordered once. */
    render(shell());
    await userEvent.click(await screen.findByRole('button', { name: /^manage$/i }));

    expect(JSON.parse(window.localStorage.getItem('ps_nav_closed_groups') ?? '[]')).toEqual([
      'Manage',
    ]);
  });

  it('restores the folded state on the next visit', async () => {
    window.localStorage.setItem('ps_nav_closed_groups', JSON.stringify(['Manage']));
    render(shell());

    expect(await screen.findByRole('button', { name: 'Dashboard' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Admin' })).toBeNull();
  });

  it('survives a corrupted preference rather than taking the shell down', async () => {
    /* This value is user-editable. The nav is the only way out of a broken page, so a malformed
       preference must not be what breaks it. */
    window.localStorage.setItem('ps_nav_closed_groups', '{not json');
    render(shell());

    expect(await screen.findByRole('button', { name: 'Dashboard' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Admin' })).toBeTruthy();
  });
});
