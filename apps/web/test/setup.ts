import '@testing-library/jest-dom/vitest';

/**
 * Node 25+ ships its own Web Storage globals. Without `--localstorage-file` the global
 * `localStorage` exists but is unusable (`undefined` / throws), and because it is already defined
 * on `globalThis`, vitest's jsdom environment does not overwrite it with jsdom's working
 * implementation. Every test touching storage then fails with "Cannot read properties of
 * undefined (reading 'clear')" — on Node 26, which is the project's runtime, while passing on 20.
 *
 * Re-point both globals at jsdom's own Storage objects. This is environment repair, not a test
 * double: the components under test get a real, spec-compliant Storage, exactly as in a browser.
 */
const jsdomWindow = (globalThis as { jsdom?: { window: Window } }).jsdom?.window;
if (jsdomWindow) {
  for (const key of ['localStorage', 'sessionStorage'] as const) {
    Object.defineProperty(globalThis, key, {
      configurable: true,
      enumerable: true,
      get: () => jsdomWindow[key],
    });
  }
}

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
/**
 * jsdom has no IntersectionObserver either, and `useInView` constructs one on mount — so every
 * view that animates on scroll threw before rendering anything. The stub reports the element as
 * visible immediately, which is the honest reading for a test: there is no viewport to be outside
 * of, and "visible" is the state that renders the real content rather than the pre-animation one.
 */
if (typeof globalThis.IntersectionObserver === 'undefined') {
  class ImmediatelyVisible {
    constructor(private readonly callback: IntersectionObserverCallback) {}
    observe(target: Element): void {
      this.callback(
        [{ isIntersecting: true, target } as IntersectionObserverEntry],
        this as unknown as IntersectionObserver,
      );
    }
    unobserve(): void {}
    disconnect(): void {}
    takeRecords(): IntersectionObserverEntry[] {
      return [];
    }
  }
  globalThis.IntersectionObserver = ImmediatelyVisible as unknown as typeof IntersectionObserver;
}

if (typeof Element !== 'undefined' && !Element.prototype.scrollTo) {
  Element.prototype.scrollTo = function scrollTo(): void {
    /* intentionally empty — see above */
  };
}
