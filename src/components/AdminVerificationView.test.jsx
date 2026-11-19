import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import AdminVerificationView from './AdminVerificationView.jsx';
import * as apiModule from '../lib/api.js';

vi.mock('../lib/api.js', () => ({
  api: vi.fn(),
  API_BASE: '/api',
}));

describe('AdminVerificationView Component Tests', () => {
  const mockQueueData = {
    items: [
      {
        id: 'CP-QUE-001',
        complaint_id: 'CP-QUE-001',
        category: 'Road Infrastructure',
        title: 'Road crack repair',
        description: 'Road cracks on Mirpur 10.',
        location: { area: 'Mirpur 10, Dhaka', latitude: 23.8067, longitude: 90.3683 },
        status: 'Evidence Uploaded',
        created_at: '2026-11-05T09:00:00Z',
        work_completed_at: '2026-11-05T14:00:00Z',
        beforeImage: 'https://example.com/before.jpg',
        after_image_url: 'https://example.com/after.jpg',
        resolution_evidence: {
          after_image_url: 'https://example.com/after.jpg',
          completion_note: 'Filled and sealed road crack.',
        },
        evidence_versions: [
          {
            version: 1,
            image_url: 'https://example.com/after.jpg',
            completion_note: 'Filled and sealed road crack.',
            verification_status: 'pending',
          },
        ],
      },
    ],
    count: 1,
    total: 1,
    total_pages: 1,
    page: 1,
    stats: {
      pending_count: 1,
      approved_count: 3,
      rejected_count: 1,
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    apiModule.api.mockImplementation(async (endpoint, options) => {
      if (endpoint.startsWith('/operations/verification-queue')) {
        return mockQueueData;
      }
      if (endpoint.startsWith('/operations/verify/')) {
        return { status: options?.body ? JSON.parse(options.body).action === 'approve' ? 'Resolved' : 'Rejected' : 'Success' };
      }
      return {};
    });
  });

  it('renders admin verification queue and stat tiles', async () => {
    render(
      <AdminVerificationView
        lang="en"
        authUser={{ role: 'admin', name: 'Super Admin' }}
        showToast={vi.fn()}
      />
    );

    expect(screen.getByText(/Admin Evidence Verification Queue/i)).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText('CP-QUE-001')).toBeInTheDocument();
      expect(screen.getAllByText(/Pending Verification/i).length).toBeGreaterThan(0);
      expect(screen.getByRole('button', { name: /Approve Work/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Reject with Notes/i })).toBeInTheDocument();
    });
  });

  it('opens approval confirmation dialog and triggers verify API', async () => {
    const refreshSpy = vi.fn();
    render(
      <AdminVerificationView
        lang="en"
        authUser={{ role: 'admin', name: 'Super Admin' }}
        onRefreshData={refreshSpy}
        showToast={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('CP-QUE-001')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /Approve Work/i }));

    await waitFor(() => {
      expect(screen.getByTestId('approve-confirmation-modal')).toBeInTheDocument();
      expect(screen.getByText(/Approve Municipal Resolution/i)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /Confirm & Approve/i }));

    await waitFor(() => {
      expect(apiModule.api).toHaveBeenCalledWith(
        expect.stringContaining('/operations/verify/CP-QUE-001'),
        expect.objectContaining({
          method: 'POST',
        })
      );
    });
  });

  it('enforces mandatory rejection note in rejection dialog', async () => {
    const toastSpy = vi.fn();
    render(
      <AdminVerificationView
        lang="en"
        authUser={{ role: 'admin', name: 'Super Admin' }}
        showToast={toastSpy}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('CP-QUE-001')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /Reject with Notes/i }));

    await waitFor(() => {
      expect(screen.getByTestId('reject-confirmation-modal')).toBeInTheDocument();
      expect(screen.getByText(/Mandatory Rejection Reason/i)).toBeInTheDocument();
    });

    // Button should be disabled when note is empty
    const confirmBtn = screen.getByRole('button', { name: /Confirm Rejection/i });
    expect(confirmBtn).toBeDisabled();

    // Type note
    const textarea = screen.getByPlaceholderText(/asphalt compaction/i);
    fireEvent.change(textarea, { target: { value: 'Incomplete bitumen layer.' } });

    expect(confirmBtn).not.toBeDisabled();
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(apiModule.api).toHaveBeenCalledWith(
        expect.stringContaining('/operations/verify/CP-QUE-001'),
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ action: 'reject', note: 'Incomplete bitumen layer.' }),
        })
      );
    });
  });
});
