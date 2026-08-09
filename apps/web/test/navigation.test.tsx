import { describe, expect, it } from 'vitest';
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
