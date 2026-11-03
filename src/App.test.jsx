import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import App, { normalizeReport } from './App.jsx';
import * as apiModule from './lib/api.js';

vi.mock('./lib/api.js', () => ({
  api: vi.fn(),
}));

describe('normalizeReport unit tests', () => {
  it('prefers citizen description over AI summary and title for tracking title (Requirement 7)', () => {
    const report = {
      complaint_id: 'CP-1001',
      description: 'Citizen manually reported broken sidewalk and exposed rebar',
      summary: 'Damaged pedestrian pathway near market',
      title: 'Old Title',
    };
    const normalized = normalizeReport(report);
    expect(normalized.title).toBe('Citizen manually reported broken sidewalk and exposed rebar');
  });

  it('falls back to title or summary for older/demo records without description (Requirement 8)', () => {
    const demoWithTitle = {
      id: 'CP-DEMO-1',
      title: 'Overflowing Municipal Garbage Bin',
      summary: 'Commercial waste spill overflowing onto pedestrian walkway',
    };
    expect(normalizeReport(demoWithTitle).title).toBe('Overflowing Municipal Garbage Bin');

    const demoWithSummaryOnly = {
      complaint_id: 'CP-DEMO-2',
      summary: 'Uncollected waste is spreading near homes',
    };
    expect(normalizeReport(demoWithSummaryOnly).title).toBe('Uncollected waste is spreading near homes');

    const emptyReport = { id: 'CP-DEMO-3' };
    expect(normalizeReport(emptyReport).title).toBe('Civic Issue');
  });

  it('preserves assigned_authority metadata correctly', () => {
    const report = {
      complaint_id: 'CP-2001',
      description: 'Pothole in Agrabad',
      assigned_authority: {
        authority_id: 'AUTH-CCC',
        authority_name: 'Chattogram City Corporation',
        short_code: 'CCC',
        department: 'Engineering Department (Road Maintenance)',
        routing_status: 'assigned',
        data_status: 'pending_verification',
      },
    };
    const normalized = normalizeReport(report);
    expect(normalized.assigned_authority).toBeDefined();
    expect(normalized.assigned_authority.authority_id).toBe('AUTH-CCC');
    expect(normalized.assigned_authority.short_code).toBe('CCC');
    expect(normalized.assigned_authority.department).toBe('Engineering Department (Road Maintenance)');
  });
});

describe('Complaint Flow & AI Suggestion UX', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    apiModule.api.mockImplementation(async (endpoint) => {
      if (endpoint === '/auth/me') {
        const err = new Error('Unauthorized');
        err.status = 401;
        throw err;
      }
      if (endpoint === '/complaints' || endpoint.startsWith('/complaints?')) {
        return { complaints: [], pagination: { total: 0 } };
      }
      if (endpoint === '/contractors') return [];
      if (endpoint === '/repair-requests') return [];
      if (endpoint === '/discussions') return [];
      if (endpoint === '/stats/dashboard') return {};
      return {};
    });
  });

  it('renders report flow, keeps description empty after AI analysis, copies via button, and preserves edits', async () => {
    const fakeAiSummary = 'Massive accumulation of garbage and plastic waste dumped openly alongside a public road.';

    apiModule.api.mockImplementation(async (endpoint, options = {}) => {
      if (endpoint === '/auth/me') {
        const err = new Error('Unauthorized');
        err.status = 401;
        throw err;
      }
      if (endpoint === '/complaints/analyze') {
        return {
          category: 'Waste Management',
          severity: 'High',
          confidence: 0.95,
          department: 'Sanitation Department',
          summary: fakeAiSummary,
          reasoning: 'Roadside garbage dump visible.',
          is_civic_issue: true,
          analysis_token: 'valid-test-token',
        };
      }
      if (endpoint === '/complaints/with-image') {
        return {
          complaint_id: 'CP-9999',
          description: options.body?.get ? options.body.get('description') : 'default',
          summary: fakeAiSummary,
          category: 'Waste Management',
          severity: 'High',
          status: 'Submitted',
        };
      }
      if (endpoint === '/complaints' || endpoint.startsWith('/complaints?')) {
        return { complaints: [], pagination: { total: 0 } };
      }
      if (endpoint === '/contractors') return [];
      if (endpoint === '/repair-requests') return [];
      if (endpoint === '/discussions') return [];
      return {};
    });

    render(<App />);

    // 1. Navigate to report tab
    const reportButtons = screen.getAllByRole('button', { name: /Report an issue|Report Issue|Report a Problem/i });
    fireEvent.click(reportButtons[0]);

    // 2. Upload photo
    const file = new File(['fake-image-bytes'], 'test-photo.jpg', { type: 'image/jpeg' });
    const fileInput = document.querySelector('input[type="file"]');
    expect(fileInput).not.toBeNull();
    fireEvent.change(fileInput, { target: { files: [file] } });

    // Wait for Step 2 to appear
    await waitFor(() => {
      expect(screen.getByText(/Suggested description \(AI-generated\)/i)).toBeInTheDocument();
    });

    // Requirement 1: Successful Gemini analysis does NOT populate the citizen description textarea
    const textarea = screen.getByPlaceholderText(/Briefly describe the problem/i);
    expect(textarea.value).toBe('');

    // Requirement 2: AI suggestion appears in the Suggested description card
    expect(screen.getByText(fakeAiSummary)).toBeInTheDocument();

    // Requirement 3: Clicking "Use this suggestion" copies the AI summary into the textarea
    const useSuggestionBtn = screen.getByRole('button', { name: /Use this suggestion/i });
    expect(useSuggestionBtn).toBeInTheDocument();
    fireEvent.click(useSuggestionBtn);

    expect(textarea.value).toBe(fakeAiSummary);

    // Requirement 4: User can edit the copied suggestion
    fireEvent.change(textarea, { target: { value: 'My custom citizen description: garbage near my gate.' } });
    expect(textarea.value).toBe('My custom citizen description: garbage near my gate.');

    // Requirement 5: Editing the textarea does NOT modify aiAnalysis.summary
    expect(screen.getByText(fakeAiSummary)).toBeInTheDocument();

    // Enter required location
    const locationInput = screen.getByPlaceholderText(/Enter street, area or landmark/i);
    fireEvent.change(locationInput, { target: { value: 'Dhanmondi 27, Dhaka' } });

    // Requirement 6: User-entered description is preserved in the final submission payload
    const submitBtn = screen.getByRole('button', { name: /Submit report/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      const submissionCall = apiModule.api.mock.calls.find(c => c[0] === '/complaints/with-image');
      expect(submissionCall).toBeDefined();
      const body = submissionCall[1].body;
      expect(body.get('description')).toBe('My custom citizen description: garbage near my gate.');
      expect(body.get('area')).toBe('Dhanmondi 27, Dhaka');
      expect(body.get('analysis_token')).toBe('valid-test-token');
    });
  });

  it('renders Citizen Verification Gate and confirms resolution with valid token', async () => {
    sessionStorage.setItem('urbanfix-reporter-CP-7777', 'test-token-xyz');

    const mockComplaint = {
      complaint_id: 'CP-7777',
      description: 'Pothole on Main Road Agrabad',
      location: { area: 'Agrabad, Chattogram' },
      category: 'Road Infrastructure',
      severity: 'High',
      status: 'Evidence Uploaded',
      beforeImage: '/uploads/before.jpg',
      afterImage: '/uploads/after.jpg',
      resolution_evidence: {
        url: '/uploads/after.jpg',
        completion_note: 'Road patch work completed satisfactorily.',
      },
      status_history: [
        { status: 'Evidence Uploaded', note: 'Road patch work completed satisfactorily.', at: new Date().toISOString() },
      ],
      timeline: [
        { status: 'Evidence Uploaded', note: 'Road patch work completed satisfactorily.', time: 'Just now' },
      ],
    };

    apiModule.api.mockImplementation(async (endpoint, options = {}) => {
      if (endpoint === '/auth/me') {
        const err = new Error('Unauthorized');
        err.status = 401;
        throw err;
      }
      if (endpoint === '/complaints' || endpoint.startsWith('/complaints?')) {
        return { complaints: [mockComplaint], pagination: { total: 1 } };
      }
      if (endpoint === '/track/CP-7777' || endpoint === '/tracking/CP-7777') {
        return mockComplaint;
      }
      if (endpoint === '/complaints/CP-7777/reporter-verification') {
        return {
          ...mockComplaint,
          status: 'Resolved',
          citizen_verification: { fixed: true, note: 'Citizen verified resolution on site.' },
          fully_verified: true,
        };
      }
      return {};
    });

    render(<App />);

    // Navigate to Track Tab
    const trackTabBtn = screen.getAllByRole('button', { name: /Track Report/i })[0];
    fireEvent.click(trackTabBtn);

    // Enter case ID
    const trackingInput = screen.getByPlaceholderText(/CP-ABC123 or ABC123/i);
    fireEvent.change(trackingInput, { target: { value: 'CP-7777' } });

    // Trigger tracking via Enter key
    fireEvent.keyDown(trackingInput, { key: 'Enter', code: 'Enter' });

    // Wait for the Citizen Verification Card and InteractiveBeforeAfter to render
    await waitFor(() => {
      expect(screen.getByTestId('citizen-verification-card')).toBeInTheDocument();
      expect(screen.getByTestId('interactive-before-after')).toBeInTheDocument();
    });

    // Check that completion note is shown
    expect(screen.getAllByText(/Road patch work completed satisfactorily/i).length).toBeGreaterThan(0);

    // Check token is auto-filled from sessionStorage
    const tokenInput = screen.getByPlaceholderText(/Paste or verify reporter token/i);
    expect(tokenInput.value).toBe('test-token-xyz');

    // Click Confirm Fixed button
    const confirmBtn = screen.getByRole('button', { name: /Confirm Fixed/i });
    fireEvent.click(confirmBtn);

    // Verify API was called
    await waitFor(() => {
      const verifyCall = apiModule.api.mock.calls.find(c => c[0] === '/complaints/CP-7777/reporter-verification');
      expect(verifyCall).toBeDefined();
      const payload = JSON.parse(verifyCall[1].body);
      expect(payload.token).toBe('test-token-xyz');
      expect(payload.outcome).toBe('fixed');
    });
  });
});
