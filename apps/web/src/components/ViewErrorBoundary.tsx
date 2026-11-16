'use client';

import { Component, type ErrorInfo, type ReactNode } from 'react';

/**
 * Contains a render error to the view that threw it.
 *
 * There was no error boundary anywhere in the app, so React's behaviour on a render error applied:
 * unmount EVERYTHING. One malformed row in one admin panel left a blank page — no sidebar, no
 * sign-out, no way to navigate away from the view that broke. A boundary around the active view
 * keeps the shell alive and says what happened.
 *
 * `resetKey` is the active view id: navigating somewhere else clears the error, so a fault on one
 * page never follows the user to the next.
 */
export class ViewErrorBoundary extends Component<
  { resetKey: string; children: ReactNode },
  { error: Error | null; key: string }
> {
  state = { error: null as Error | null, key: this.props.resetKey };

  static getDerivedStateFromProps(
    props: { resetKey: string },
    state: { error: Error | null; key: string },
  ): { error: Error | null; key: string } | null {
    return props.resetKey !== state.key ? { error: null, key: props.resetKey } : null;
  }

  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    /* `console.error` rather than swallowing: this is a defect, and the browser console is where
       DEVRULES' fix loop reads them from. */
    console.error('View failed to render', error, info.componentStack);
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div className="card" role="alert" style={{ padding: '32px 26px', textAlign: 'center' }}>
          <div style={{ fontSize: 14, color: 'var(--coral)', marginBottom: 4 }}>
            This view hit an error and could not be shown
          </div>
          <div className="mono" style={{ fontSize: 12, color: 'var(--t3)' }}>
            {this.state.error.message}
          </div>
          <div style={{ fontSize: 12.5, color: 'var(--t3)', marginTop: 6 }}>
            The rest of the app still works — choose another view, or reload the page.
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
