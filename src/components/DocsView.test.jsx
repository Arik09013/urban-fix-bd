import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import DocsView from './DocsView.jsx';
import * as apiModule from '../lib/api.js';

vi.mock('../lib/api.js', () => ({
  api: vi.fn(),
  API_BASE: '/api',
}));

describe('DocsView Component Unit Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    apiModule.api.mockImplementation(async (endpoint) => {
      if (endpoint === '/health') {
        return {
          status: 'operational',
          database: 'MongoDB Atlas',
          ai_service: 'Google Gemini 2.5 Flash Lite',
          storage: 'Cloudinary Media CDN',
          mode: 'production',
        };
      }
      if (endpoint === '/analytics') {
        return {
          total_complaints: 45,
          resolved_count: 38,
          avg_resolution_hours: 3.8,
        };
      }
      if (endpoint === '/authorities') {
        return [
          { authority_id: 'AUTH-CCC', name: 'Chattogram City Corporation' },
          { authority_id: 'AUTH-DNCC', name: 'Dhaka North City Corporation' },
        ];
      }
      return {};
    });
  });

  it('renders executive pitch deck, badge, and value pillars', async () => {
    render(<DocsView lang="en" onNavigate={vi.fn()} />);

    expect(screen.getByText(/AI Builders Congress 2026 Edition/i)).toBeInTheDocument();
    expect(screen.getByText(/Urban Fix BD: AI-Powered Civic Governance/i)).toBeInTheDocument();
    expect(screen.getByText(/1. Zero-Friction Reporting/i)).toBeInTheDocument();
    expect(screen.getByText(/2. Multi-Modal AI Triage/i)).toBeInTheDocument();
    expect(screen.getByText(/3. Cryptographic Verification/i)).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText(/Backend Health/i)).toBeInTheDocument();
    });
  });

  it('loads and displays live system telemetry from backend endpoints', async () => {
    render(<DocsView lang="en" onNavigate={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText(/Backend Health/i)).toBeInTheDocument();
      expect(screen.getAllByText(/Operational/i).length).toBeGreaterThan(0);
      expect(screen.getAllByText(/MongoDB/i).length).toBeGreaterThan(0);
    });

    expect(apiModule.api).toHaveBeenCalledWith('/health');
    expect(apiModule.api).toHaveBeenCalledWith('/analytics');
    expect(apiModule.api).toHaveBeenCalledWith('/authorities');
  });

  it('filters feature matrix by implementation status tabs and search query', async () => {
    render(<DocsView lang="en" onNavigate={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText(/Backend Health/i)).toBeInTheDocument();
    });

    // Initially displays all features
    expect(screen.getByText(/AI Multi-Modal Civic Triage/i)).toBeInTheDocument();

    // Filter by 'In Progress'
    const inProgressTab = screen.getByRole('button', { name: /^In Progress/i });
    fireEvent.click(inProgressTab);

    expect(screen.getByText(/WhatsApp Bot Citizen Ingestion Pipeline/i)).toBeInTheDocument();
    expect(screen.queryByText(/AI Multi-Modal Civic Triage/i)).not.toBeInTheDocument();

    // Filter by 'Planned'
    const plannedTab = screen.getByRole('button', { name: /^Planned/i });
    fireEvent.click(plannedTab);

    expect(screen.getByText(/Autonomous Multi-Agent Contractor Swarm/i)).toBeInTheDocument();
    expect(screen.queryByText(/WhatsApp Bot Citizen Ingestion Pipeline/i)).not.toBeInTheDocument();

    // Switch back to All and test search input
    fireEvent.click(screen.getByRole('button', { name: /^All \(16\)$/i }));
    const searchInput = screen.getByPlaceholderText(/Search documentation/i);
    fireEvent.change(searchInput, { target: { value: 'Pillow' } });

    expect(screen.getByText(/Zero-Knowledge Privacy & EXIF Stripper/i)).toBeInTheDocument();
    expect(screen.queryByText(/Autonomous Multi-Agent Contractor Swarm/i)).not.toBeInTheDocument();
  });

  it('filters API endpoints by HTTP method buttons', async () => {
    render(<DocsView lang="en" onNavigate={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText(/Backend Health/i)).toBeInTheDocument();
    });

    // Click GET method filter
    const getBtn = screen.getByRole('button', { name: /^GET$/i });
    fireEvent.click(getBtn);

    expect(screen.getByText('/api/authorities')).toBeInTheDocument();
    expect(screen.queryByText('/api/complaints/analyze')).not.toBeInTheDocument();

    // Click POST method filter
    const postBtn = screen.getByRole('button', { name: /^POST$/i });
    fireEvent.click(postBtn);

    expect(screen.getByText('/api/complaints/analyze')).toBeInTheDocument();
    expect(screen.queryByText('/api/authorities')).not.toBeInTheDocument();
  });

  it('calls onNavigate callback when Back to App is clicked', async () => {
    const onNavigateMock = vi.fn();
    render(<DocsView lang="en" onNavigate={onNavigateMock} />);

    await waitFor(() => {
      expect(screen.getByText(/Backend Health/i)).toBeInTheDocument();
    });

    const backBtn = screen.getByRole('button', { name: /Back to App/i });
    fireEvent.click(backBtn);

    expect(onNavigateMock).toHaveBeenCalledWith('landing');
  });

  it('supports copying the Gemini prompt schema to clipboard', async () => {
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: { writeText: writeTextMock },
    });

    render(<DocsView lang="en" onNavigate={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText(/Backend Health/i)).toBeInTheDocument();
    });

    const copyBtn = screen.getByRole('button', { name: /Copy Schema/i });
    fireEvent.click(copyBtn);

    expect(writeTextMock).toHaveBeenCalled();
  });
});
