import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import ErrorBoundary from './ErrorBoundary.jsx';

const ProblemChild = ({ shouldThrow }) => {
  if (shouldThrow) {
    throw new Error('Test crash in child component');
  }
  return <div>Safe child content</div>;
};

describe('ErrorBoundary Component Tests', () => {
  it('renders children when no error occurs', () => {
    render(
      <ErrorBoundary>
        <ProblemChild shouldThrow={false} />
      </ErrorBoundary>
    );

    expect(screen.getByText('Safe child content')).toBeInTheDocument();
  });

  it('catches error and renders user-friendly fallback UI without crashing', () => {
    // Suppress console.error during expected test error
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <ErrorBoundary title="Work History Error">
        <ProblemChild shouldThrow={true} />
      </ErrorBoundary>
    );

    expect(screen.getByTestId('error-boundary-fallback')).toBeInTheDocument();
    expect(screen.getByText('Work History Error')).toBeInTheDocument();
    expect(screen.getByText('Test crash in child component')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Reload View/i })).toBeInTheDocument();

    consoleSpy.mockRestore();
  });
});
