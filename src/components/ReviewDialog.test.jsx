import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import ReviewDialog from './ReviewDialog.jsx';

const report = {
  id: 'CP-101',
  category: 'Road Infrastructure',
  severity: 'High',
  department: 'Roads Department',
};

test('requires a review reason and returns editable classification', () => {
  const confirm = vi.fn();
  render(<ReviewDialog report={report} onClose={() => {}} onConfirm={confirm} busy={false} />);

  const submit = screen.getByRole('button', { name: 'Confirm review' });
  expect(submit).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Severity'), { target: { value: 'Critical' } });
  fireEvent.change(screen.getByLabelText('Decision note'), { target: { value: 'Verified against the submitted evidence.' } });
  fireEvent.click(submit);

  expect(confirm).toHaveBeenCalledWith(expect.objectContaining({
    category: 'Road Infrastructure',
    severity: 'Critical',
    department: 'Roads Department',
  }));
});

test('closes from the explicit close control', () => {
  const close = vi.fn();
  render(<ReviewDialog report={report} onClose={close} onConfirm={() => {}} busy={false} />);
  fireEvent.click(screen.getByRole('button', { name: 'Close review' }));
  expect(close).toHaveBeenCalledOnce();
});

test('closes with Escape and restores focus', () => {
  const close = vi.fn();
  const trigger = document.createElement('button');
  document.body.appendChild(trigger);
  trigger.focus();
  const { unmount } = render(<ReviewDialog report={report} onClose={close} onConfirm={() => {}} busy={false} />);

  fireEvent.keyDown(document, { key: 'Escape' });
  expect(close).toHaveBeenCalledOnce();
  unmount();
  expect(trigger).toHaveFocus();
  trigger.remove();
});
