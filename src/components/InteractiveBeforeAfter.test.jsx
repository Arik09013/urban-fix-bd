import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import InteractiveBeforeAfter from './InteractiveBeforeAfter.jsx';

describe('InteractiveBeforeAfter component', () => {
  it('renders progress placeholder when afterImage is not yet available', () => {
    render(
      <InteractiveBeforeAfter
        beforeImage="/uploads/before.jpg"
        afterImage={null}
      />
    );
    expect(screen.getByText(/Inspection proof photo will appear here/i)).toBeInTheDocument();
    expect(screen.getByAltText(/Before report/i)).toBeInTheDocument();
  });

  it('renders interactive scrub slider with both before and after images when afterImage is provided', () => {
    render(
      <InteractiveBeforeAfter
        beforeImage="/uploads/before.jpg"
        afterImage="/uploads/after.jpg"
        altBefore="Before reported issue"
        altAfter="After completed repair"
      />
    );

    expect(screen.getByTestId('interactive-before-after')).toBeInTheDocument();
    expect(screen.getByText('BEFORE REPORTED')).toBeInTheDocument();
    expect(screen.getByText('AFTER RESOLUTION')).toBeInTheDocument();

    const slider = screen.getByLabelText(/Before after slider scrub/i);
    expect(slider).toBeInTheDocument();
    expect(slider.value).toBe('50');

    // Simulate slider scrub
    fireEvent.change(slider, { target: { value: '75' } });
    expect(slider.value).toBe('75');
  });
});
