import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import WorkHistoryView from './WorkHistoryView.jsx';
import * as apiModule from '../lib/api.js';

vi.mock('../lib/api.js', () => ({
  api: vi.fn(),
  API_BASE: '/api',
}));

describe('WorkHistoryView Component Tests', () => {
  const mockWorkHistoryData = {
    items: [
      {
        id: 'CP-CCC-001',
        complaint_id: 'CP-CCC-001',
        category: 'Road Infrastructure',
        title: 'Pothole on Main Road',
        description: 'Large pothole causing vehicle damage.',
        location: 'Agrabad, Chattogram',
        status: 'Resolved',
        admin_verified: true,
        verification_status: 'Verified',
        created_at: '2026-11-01T10:00:00Z',
        work_completed_at: '2026-11-02T15:30:00Z',
        after_image_url: 'https://example.com/resolved.jpg',
        resolution_evidence: {
          after_image_url: 'https://example.com/resolved.jpg',
          completion_note: 'Filled with cold asphalt mix.',
          uploaded_at: '2026-11-02T15:30:00Z',
        },
        evidence_versions: [
          {
            version: 1,
            image_url: 'https://example.com/resolved.jpg',
            completion_note: 'Filled with cold asphalt mix.',
            verification_status: 'verified',
            uploaded_at: '2026-11-02T15:30:00Z',
          },
        ],
      },
      {
        id: 'CP-CCC-002',
        complaint_id: 'CP-CCC-002',
        category: 'Drainage & Waterlogging',
        title: 'Clogged Drain',
        description: 'Water overflowing.',
        location: 'Jubilee Road, Chattogram',
        status: 'Rejected',
        rejection_reason: 'Water flow still obstructed. Clear deeper sediment.',
        created_at: '2026-11-03T11:00:00Z',
        work_completed_at: '2026-11-04T12:00:00Z',
        after_image_url: 'https://example.com/rejected.jpg',
        evidence_versions: [
          {
            version: 1,
            image_url: 'https://example.com/rejected.jpg',
            completion_note: 'Surface debris removed.',
            verification_status: 'rejected',
            admin_note: 'Water flow still obstructed. Clear deeper sediment.',
            uploaded_at: '2026-11-04T12:00:00Z',
          },
        ],
      },
    ],
    total: 2,
    total_pages: 1,
    page: 1,
    stats: {
      total_assigned: 2,
      in_progress: 0,
      pending_verification: 0,
      verified: 1,
      rejected: 1,
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    apiModule.api.mockImplementation(async (endpoint) => {
      if (endpoint.startsWith('/operations/work-history')) {
        return mockWorkHistoryData;
      }
      return {};
    });
  });

  it('renders work history header, stats cards, and audited records', async () => {
    render(
      <WorkHistoryView
        lang="en"
        authUser={{ role: 'officer', authority_id: 'AUTH-CCC', name: 'Officer Rahman' }}
        onSelectComplaint={vi.fn()}
      />
    );

    expect(screen.getByText(/Authority Work History & Audit Trail/i)).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText('CP-CCC-001')).toBeInTheDocument();
      expect(screen.getByText('CP-CCC-002')).toBeInTheDocument();
      expect(screen.getAllByText(/Verified Resolution/i).length).toBeGreaterThan(0);
      expect(screen.getAllByText(/Correction Required/i).length).toBeGreaterThan(0);
    });

    // Check stats are rendered
    expect(screen.getByText('Total Assigned')).toBeInTheDocument();
    expect(screen.getByText('Verified Resolved')).toBeInTheDocument();
  });

  it('opens detailed proof modal with evidence versions and comparison', async () => {
    render(
      <WorkHistoryView
        lang="en"
        authUser={{ role: 'officer', authority_id: 'AUTH-CCC', name: 'Officer Rahman' }}
        onSelectComplaint={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('CP-CCC-001')).toBeInTheDocument();
    });

    const btn = screen.getByTestId('view-proof-btn-CP-CCC-001');
    fireEvent.click(btn);

    await waitFor(() => {
      expect(screen.getByTestId('work-history-detail-modal')).toBeInTheDocument();
      expect(screen.getAllByText(/Filled with cold asphalt mix/i).length).toBeGreaterThan(0);
    });
  });
});
