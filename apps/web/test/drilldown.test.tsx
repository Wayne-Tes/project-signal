import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@/hooks/useApi', () => ({ useApi: () => ({ data: null, loading: false, error: null }) }));
vi.mock('@/lib/brand-context', () => ({
  useBrand: () => ({ brandId: 'brand-1', selected: { id: 'brand-1', name: 'Tes' } }),
}));

const { DrillDown } = await import('../src/components/DrillDown');

import type { NavLevel } from '@/lib/types';

/**
 * The drill-down, and its stacked steps.
 *
 * THE REGRESSION THIS FILE EXISTS FOR. Each level you pass through is meant to collapse into a
 * narrow numbered spine — `01 INDEX`, `02 REPUTATION`, `03 <topic>` — standing as its own column
 * beside the panel you are reading, so the route from a number down to the things people actually
 * said stays visible, and any earlier step is one click away.
 *
 * The rewrite that deleted the mock data replaced the whole render with a single panel and took
 * the spines with it. Nothing caught it: the CSS for them stayed in `globals.css` the entire
 * time, styling elements that no longer existed, and no test rendered the component with a path
 * more than one level deep. That is the gap these tests close — every one of them uses a path of
 * two or three levels, because at one level the bug is invisible.
 */

const nav = {
  openOverview: vi.fn(),
  openDimension: vi.fn(),
  openCluster: vi.fn(),
  openTopic: vi.fn(),
  to: vi.fn(),
  close: vi.fn(),
};

const OVERVIEW: NavLevel = { kind: 'overview' };
const DIMENSION: NavLevel = { kind: 'dimension', dimKey: 'trust' };
const CLUSTER: NavLevel = { kind: 'cluster', clusterId: 'billing delays' };

function spines(): HTMLElement[] {
  return Array.from(document.querySelectorAll('.drill-panel.stacked'));
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('the stacked steps', () => {
  it('renders nothing at all for an empty path', () => {
    const { container } = render(<DrillDown path={[]} nav={nav} />);
    expect(container.innerHTML).toBe('');
  });

  it('renders one panel and no spines at the first level', () => {
    render(<DrillDown path={[OVERVIEW]} nav={nav} />);
    expect(document.querySelectorAll('.drill-panel:not(.stacked)')).toHaveLength(1);
    expect(spines()).toHaveLength(0);
  });

  it('collapses each completed level into a spine', () => {
    /* Two levels deep: one spine behind, one open panel. This is the assertion that fails against
       the single-panel version, and nothing in the suite made it before. */
    render(<DrillDown path={[OVERVIEW, DIMENSION]} nav={nav} />);
    expect(spines()).toHaveLength(1);
    expect(document.querySelectorAll('.drill-panel:not(.stacked)')).toHaveLength(1);
  });

  it('stacks two spines at three levels deep', () => {
    render(<DrillDown path={[OVERVIEW, DIMENSION, CLUSTER]} nav={nav} />);
    expect(spines()).toHaveLength(2);
  });

  it('numbers the steps, zero-padded so they line up', () => {
    render(<DrillDown path={[OVERVIEW, DIMENSION, CLUSTER]} nav={nav} />);
    const numbers = Array.from(document.querySelectorAll('.drill-spine .lvl')).map(
      (el) => el.textContent,
    );
    expect(numbers).toEqual(['01', '02']);
  });

  it('labels each spine with the level it goes back to', () => {
    render(<DrillDown path={[OVERVIEW, DIMENSION, CLUSTER]} nav={nav} />);
    const text = spines().map((el) => el.textContent);
    expect(text[0]).toContain('Index');
    /* The LABEL, not the key. A spine reading 'trust' would be the fallback path for an
       unrecognised key, which is a different thing from the dimension being rendered. */
    expect(text[1]).toContain('Trust');
  });

  it('makes a spine a real button, reachable by keyboard', () => {
    /* It is the way back to that step. A div with an onClick — which is what the original was —
       cannot be tabbed to and is not announced as an action. */
    render(<DrillDown path={[OVERVIEW, DIMENSION]} nav={nav} />);
    expect(spines()[0]!.tagName).toBe('BUTTON');
    expect(spines()[0]!.getAttribute('aria-label')).toMatch(/back to step 1: index/i);
  });

  it('goes back to that level when a spine is clicked', async () => {
    render(<DrillDown path={[OVERVIEW, DIMENSION, CLUSTER]} nav={nav} />);
    await userEvent.click(spines()[0]!);
    expect(nav.to).toHaveBeenCalledWith(0);
  });

  it('goes back from the second spine to the second level', async () => {
    render(<DrillDown path={[OVERVIEW, DIMENSION, CLUSTER]} nav={nav} />);
    await userEvent.click(spines()[1]!);
    expect(nav.to).toHaveBeenCalledWith(1);
  });
});

describe('the open panel', () => {
  it('shows the deepest level, not the first', () => {
    /* A path is a route, and the panel renders where you have got to. Rendering path[0] would
       leave the drawer stuck on the index however far you drilled. */
    render(<DrillDown path={[OVERVIEW, DIMENSION]} nav={nav} />);
    /* Scoped to the open panel, because 'Trust' also appears on the spine behind it and in the
       breadcrumb. The title is the dimension, NOT the brand name the overview level renders. */
    const title = document.querySelector('.drill-panel:not(.stacked) .drill-title');
    expect(title?.textContent).toBe('Trust');
  });

  it('renders the overview when the overview is where you are', () => {
    render(<DrillDown path={[OVERVIEW]} nav={nav} />);
    const title = document.querySelector('.drill-panel:not(.stacked) .drill-title');
    expect(title?.textContent).toBe('Tes');
  });

  it('still carries the breadcrumb', () => {
    /* The spines say how deep; the breadcrumb says where. They are not redundant — the spines
       are unreadable at a glance and the breadcrumb loses the sense of depth. */
    render(<DrillDown path={[OVERVIEW, DIMENSION, CLUSTER]} nav={nav} />);
    const crumbs = document.querySelector('.crumbs');
    expect(crumbs?.textContent).toContain('Index');
    expect(crumbs?.textContent).toContain('billing delays');
  });

  it('closes from the close button', async () => {
    render(<DrillDown path={[OVERVIEW]} nav={nav} />);
    await userEvent.click(screen.getByRole('button', { name: /close drill-down/i }));
    expect(nav.close).toHaveBeenCalled();
  });

  it('closes when the scrim is clicked', async () => {
    render(<DrillDown path={[OVERVIEW, DIMENSION]} nav={nav} />);
    await userEvent.click(document.querySelector('.drill-scrim')!);
    expect(nav.close).toHaveBeenCalled();
  });
});
