import '@testing-library/jest-dom/vitest';

/**
 * jsdom has no layout engine, so it implements none of the scrolling API.
 *
 * `Element.prototype.scrollTo` is simply absent, and any component that keeps its newest content
 * in view — the assistant dock, the drill-down — throws `scrollTo is not a function` on render.
 * That is an artefact of the environment, not a defect in the component, and without this stub it
 * makes those components untestable rather than merely awkward.
 *
 * A no-op is the honest stub: there is nothing to scroll, and pretending otherwise would invite a
 * test that asserts on a scroll position jsdom cannot compute. Anything that genuinely depends on
 * layout belongs in the Playwright suite, which has a real browser.
 */
if (typeof Element !== 'undefined' && !Element.prototype.scrollTo) {
  Element.prototype.scrollTo = function scrollTo(): void {
    /* intentionally empty — see above */
  };
}
