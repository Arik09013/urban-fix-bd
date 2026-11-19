import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import EvidenceManagementView from './EvidenceManagementView.jsx';
import * as apiModule from '../lib/api.js';

vi.mock('../lib/api.js', () => ({
  api: vi.fn(),
  API_BASE: '/api',
}));

describe('EvidenceManagementView Component Tests', () => {
  const mockItems = [
    {
      id: 'CP-EVI-001',
      complaint_id: 'CP-EVI-001',
      category: 'Street Lighting',
      title: 'Fix street light',
      location: { area: 'Dhanmondi 27, Dhaka', latitude: 23.75, longitude: 90.37 },
      status: 'Evidence Uploaded',
      after_image_url: 'https://example.com/light_fixed.jpg',
      completion_description: 'Replaced 100W LED module.',
      evidence_versions: [
        {
          version: 1,
          image_url: 'https://example.com/light_fixed.jpg',
          completion_note: 'Replaced 100W LED module.',
          verification_status: 'pending',
          uploaded_at: '2026-11-06T10:00:00Z',
        },
      ],
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    apiModule.api.mockImplementation(async (endpoint) => {
      if (endpoint.startsWith('/operations/work-history')) {
        return { items: mockItems, total: 1 };
      }
      if (endpoint.includes('/evidence/note')) {
        return { success: true };
      }
      if (endpoint.includes('/evidence/upload')) {
        return { success: true };
      }
      return {};
    });
  });

  it('renders evidence management view and version history', async () => {
    render(
      <EvidenceManagementView
        lang="en"
        authUser={{ role: 'officer', authority_id: 'AUTH-DNCC', name: 'Field Engineer' }}
        showToast={vi.fn()}
      />
    );

    expect(screen.getByText(/Evidence Management & Version Control/i)).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getAllByText('CP-EVI-001').length).toBeGreaterThan(0);
      expect(screen.getAllByText(/Replaced 100W LED module/i).length).toBeGreaterThan(0);
      expect(screen.getByText(/Version 1/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Edit Note/i })).toBeInTheDocument();
    });
  });

  it('opens edit note modal and saves updated completion note', async () => {
    const toastSpy = vi.fn();
    render(
      <EvidenceManagementView
        lang="en"
        authUser={{ role: 'officer', authority_id: 'AUTH-DNCC', name: 'Field Engineer' }}
        showToast={toastSpy}
      />
    );

    await waitFor(() => {
      expect(screen.getAllByText('CP-EVI-001').length).toBeGreaterThan(0);
    });

    fireEvent.click(screen.getByRole('button', { name: /Edit Note/i }));

    await waitFor(() => {
      expect(screen.getByTestId('edit-note-modal')).toBeInTheDocument();
    });

    const textarea = screen.getByPlaceholderText(/describe work performed/i);
    fireEvent.change(textarea, { target: { value: 'Updated: Replaced driver capacitor and bulb.' } });

    fireEvent.click(screen.getByRole('button', { name: /Save Note/i }));

    await waitFor(() => {
      expect(apiModule.api).toHaveBeenCalledWith(
        expect.stringContaining('/complaints/CP-EVI-001/evidence/note'),
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ completion_note: 'Updated: Replaced driver capacitor and bulb.' }),
        })
      );
    });
  });
});
