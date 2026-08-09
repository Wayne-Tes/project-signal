'use client';

import { useCallback, useEffect, useState } from 'react';
import { TOUR_STEPS } from '@project-signal/help-content';
import { Button } from '@/design-system';

/**
 * The first-run tour.
 *
 * A spotlight over the real interface rather than a carousel of screenshots. Screenshots go
 * stale silently — they keep showing a control that has moved or been renamed, and the user
 * concludes the product is broken rather than the tour. Highlighting the live element cannot
 * drift, and when an element is missing the step degrades to a centred card instead of
 * pointing at nothing.
 *
 * SHOWN ONCE, and only to a genuinely new user. An unrequested overlay on every visit is an
 * irritation, so completion and dismissal are both recorded and both suppress it permanently.
 * It stays reachable from the help centre, which is where someone who skipped it will look.
 */

const STORAGE_KEY = 'ps_tour_completed';

export function hasSeenTour(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    /* Private browsing with storage denied. Treating that as "seen" is the right way to fail:
       the alternative shows the tour on every single page load, forever. */
    return true;
  }
}

export function markTourSeen(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, '1');
  } catch {
    /* Nothing to do. The tour will offer itself again, which is a smaller failure than
       breaking the app over a preference. */
  }
}

export interface TourProps {
  open: boolean;
  onClose: () => void;
  /** Opens a help article from a step's "Learn more". */
  onOpenArticle?: (slug: string) => void;
}

interface Spotlight {
  top: number;
  left: number;
  width: number;
  height: number;
}

export function Tour({ open, onClose, onOpenArticle }: TourProps) {
  const [index, setIndex] = useState(0);
  const [spotlight, setSpotlight] = useState<Spotlight | null>(null);

  const step = TOUR_STEPS[index];

  const finish = useCallback(() => {
    markTourSeen();
    setIndex(0);
    onClose();
  }, [onClose]);

  useEffect(() => {
    if (open) setIndex(0);
  }, [open]);

  /* Measure the anchor after paint, and re-measure on resize and scroll. A spotlight positioned
     once is wrong the moment anything moves, and a highlight over the wrong element is more
     confusing than none. */
  useEffect(() => {
    if (!open || !step) return;

    const measure = (): void => {
      if (!step.anchor) {
        setSpotlight(null);
        return;
      }
      const el = document.querySelector(step.anchor);
      if (!el) {
        /* The anchor is gone — a view without that control, or a renamed selector. Fall back to
           a centred step rather than spotlighting the top-left corner. */
        setSpotlight(null);
        return;
      }
      const r = el.getBoundingClientRect();
      const pad = 8;
      setSpotlight({
        top: r.top - pad,
        left: r.left - pad,
        width: r.width + pad * 2,
        height: r.height + pad * 2,
      });
    };

    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [open, step]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') finish();
      if (e.key === 'ArrowRight') setIndex((i) => Math.min(i + 1, TOUR_STEPS.length - 1));
      if (e.key === 'ArrowLeft') setIndex((i) => Math.max(i - 1, 0));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, finish]);

  if (!open || !step) return null;

  const isLast = index === TOUR_STEPS.length - 1;

  /* Place the card below the highlight, or above it when there is no room. Centred when there
     is nothing to anchor to. */
  const cardStyle: React.CSSProperties = spotlight
    ? spotlight.top + spotlight.height + 220 < window.innerHeight
      ? { top: spotlight.top + spotlight.height + 12, left: Math.max(16, Math.min(spotlight.left, window.innerWidth - 380)) }
      : { top: Math.max(16, spotlight.top - 210), left: Math.max(16, Math.min(spotlight.left, window.innerWidth - 380)) }
    : { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' };

  return (
    <div className="ds-tour" role="dialog" aria-modal="true" aria-label="Product tour" data-testid="tour">
      {/* Four panels around the highlight rather than one scrim with a hole: a box-shadow
          cut-out cannot be clicked through, and this keeps the highlighted control visible
          without trapping the pointer over it. */}
      {spotlight ? (
        <>
          <div className="ds-tour__mask" style={{ top: 0, left: 0, right: 0, height: Math.max(0, spotlight.top) }} />
          <div className="ds-tour__mask" style={{ top: spotlight.top + spotlight.height, left: 0, right: 0, bottom: 0 }} />
          <div className="ds-tour__mask" style={{ top: spotlight.top, left: 0, width: Math.max(0, spotlight.left), height: spotlight.height }} />
          <div className="ds-tour__mask" style={{ top: spotlight.top, left: spotlight.left + spotlight.width, right: 0, height: spotlight.height }} />
          <div
            className="ds-tour__ring"
            style={{ top: spotlight.top, left: spotlight.left, width: spotlight.width, height: spotlight.height }}
            aria-hidden="true"
          />
        </>
      ) : (
        <div className="ds-tour__mask" style={{ inset: 0 }} />
      )}

      <div className="ds-tour__card" style={cardStyle}>
        <span className="ds-eyebrow">
          Step {index + 1} of {TOUR_STEPS.length}
        </span>
        <h2 className="ds-tour__title">{step.title}</h2>
        <p className="ds-tour__body">{step.body}</p>

        <div className="ds-tour__actions">
          {step.article && onOpenArticle && (
            <Button variant="ghost" size="sm" onClick={() => onOpenArticle(step.article as string)}>
              Learn more
            </Button>
          )}
          <span className="ds-tour__spacer" />
          {/* Always available, on every step. A tour you cannot leave is a modal trap. */}
          <Button variant="ghost" size="sm" onClick={finish}>
            Skip
          </Button>
          {index > 0 && (
            <Button variant="secondary" size="sm" onClick={() => setIndex((i) => i - 1)}>
              Back
            </Button>
          )}
          <Button
            variant="primary"
            size="sm"
            onClick={() => (isLast ? finish() : setIndex((i) => i + 1))}
          >
            {isLast ? 'Finish' : 'Next'}
          </Button>
        </div>
      </div>
    </div>
  );
}
