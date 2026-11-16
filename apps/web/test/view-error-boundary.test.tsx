import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ViewErrorBoundary } from '../src/components/ViewErrorBoundary';

/**
 * REGRESSION. With no boundary anywhere, one component throwing during render unmounted the WHOLE
 * app — sidebar and sign-out included — leaving a blank page with no way out.
 */

function Boom(): never {
  throw new Error('row had no config');
}

describe('ViewErrorBoundary', () => {
  it('contains the error to the view and says what happened', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render(
      <div>
        <nav aria-label="Main">still here</nav>
        <ViewErrorBoundary resetKey="admin">
          <Boom />
        </ViewErrorBoundary>
      </div>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('row had no config');
    expect(screen.getByRole('navigation', { name: 'Main' })).toBeInTheDocument();
  });

  it('clears the error when the user moves to another view', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { rerender } = render(
      <ViewErrorBoundary resetKey="admin">
        <Boom />
      </ViewErrorBoundary>,
    );
    expect(screen.getByRole('alert')).toBeInTheDocument();
    rerender(
      <ViewErrorBoundary resetKey="dashboard">
        <p>Dashboard</p>
      </ViewErrorBoundary>,
    );
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByText('Dashboard')).toBeInTheDocument();
  });
});
