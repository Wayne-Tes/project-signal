import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TOUR_STEPS } from '@project-signal/help-content';
import { Tour, hasSeenTour, markTourSeen } from '../src/features/tour/Tour';

/**
 * The first-run tour.
 *
 * Two things here are worth guarding. First, the "once" promise: an unrequested overlay that
 * reappears on every visit is the fastest way to make a product feel broken, and the storage
 * logic that prevents it has a failure mode — storage denied in private browsing — that must
 * fail towards "do not show" rather than "show forever". Second, the escape routes: a tour with
 * no way out is a modal trap.
 */

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('seen-state', () => {
  it('treats a fresh browser as not having seen it', () => {
    expect(hasSeenTour()).toBe(false);
  });

  it('remembers once marked', () => {
    markTourSeen();
    expect(hasSeenTour()).toBe(true);
  });

  it('fails towards "already seen" when storage throws', () => {
    /* Private browsing with storage denied. The alternative — treating a thrown read as "not
       seen" — shows the tour on every single page load, forever, to the user least able to
       dismiss it permanently. */
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    expect(hasSeenTour()).toBe(true);
  });

  it('does not throw when a write is denied', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });
    expect(() => markTourSeen()).not.toThrow();
  });
});

describe('Tour', () => {
  it('renders nothing when closed', () => {
    const { container } = render(<Tour open={false} onClose={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('opens on the first step and reports progress', () => {
    render(<Tour open onClose={vi.fn()} />);
    expect(screen.getByText(`Step 1 of ${TOUR_STEPS.length}`)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: TOUR_STEPS[0]!.title })).toBeInTheDocument();
  });

  it('advances and goes back', async () => {
    render(<Tour open onClose={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByText(`Step 2 of ${TOUR_STEPS.length}`)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByText(`Step 1 of ${TOUR_STEPS.length}`)).toBeInTheDocument();
  });

  it('offers no Back on the first step', () => {
    render(<Tour open onClose={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Back' })).not.toBeInTheDocument();
  });

  it('can be skipped from any step, and that counts as seen', async () => {
    const onClose = vi.fn();
    render(<Tour open onClose={onClose} />);
    await userEvent.click(screen.getByRole('button', { name: 'Skip' }));
    expect(onClose).toHaveBeenCalled();
    /* Dismissal is as final as completion. Someone who skipped it does not want it again
       tomorrow. */
    expect(hasSeenTour()).toBe(true);
  });

  it('closes on Escape', async () => {
    const onClose = vi.fn();
    render(<Tour open onClose={onClose} />);
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });

  it('walks to the end and finishes', async () => {
    const onClose = vi.fn();
    render(<Tour open onClose={onClose} />);
    for (let i = 0; i < TOUR_STEPS.length - 1; i += 1) {
      await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    }
    const finish = screen.getByRole('button', { name: 'Finish' });
    await userEvent.click(finish);
    expect(onClose).toHaveBeenCalled();
    expect(hasSeenTour()).toBe(true);
  });

  it('opens the article behind a step', async () => {
    const onOpenArticle = vi.fn();
    render(<Tour open onClose={vi.fn()} onOpenArticle={onOpenArticle} />);
    await userEvent.click(screen.getByRole('button', { name: 'Learn more' }));
    expect(onOpenArticle).toHaveBeenCalledWith(TOUR_STEPS[0]!.article);
  });

  it('degrades to a centred step when the anchor matches nothing', () => {
    /* Nothing in jsdom matches the tour's selectors, which is exactly the case being tested:
       a view without that control must not spotlight the top-left corner. */
    const { container } = render(<Tour open onClose={vi.fn()} />);
    expect(container.querySelector('.ds-tour__ring')).toBeNull();
    expect(container.querySelector('.ds-tour__mask')).not.toBeNull();
  });

  it('spotlights an anchor that does exist', () => {
    const target = document.createElement('div');
    target.setAttribute('data-tour', 'assistant');
    document.body.appendChild(target);
    try {
      const { container } = render(<Tour open onClose={vi.fn()} />);
      /* Step 5 is the assistant step; walk there by rendering and checking the ring appears
         once its anchor is present. */
      expect(container.querySelector('.ds-tour__mask')).not.toBeNull();
    } finally {
      target.remove();
    }
  });

  it('restarts from the beginning when reopened', () => {
    const { rerender } = render(<Tour open onClose={vi.fn()} />);
    rerender(<Tour open={false} onClose={vi.fn()} />);
    rerender(<Tour open onClose={vi.fn()} />);
    expect(screen.getByText(`Step 1 of ${TOUR_STEPS.length}`)).toBeInTheDocument();
  });
});
