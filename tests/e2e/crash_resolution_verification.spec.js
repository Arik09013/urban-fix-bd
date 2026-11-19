import { expect, test } from '@playwright/test';

// Common test fixtures
const mockOfficerUser = {
  id: 'usr_officer_ccc',
  username: 'officer.ccc',
  role: 'officer',
  authority_id: 'AUTH-CCC',
  name: 'Engr. Nazmul Huda',
  department: 'Chittagong City Corporation (CCC)',
  csrf_token: 'test-csrf-token',
};

const mockAdminUser = {
  id: 'usr_admin',
  username: 'admin',
  role: 'admin',
  name: 'System Administrator',
  csrf_token: 'test-csrf-token',
};

const mockComplaintsResponse = {
  complaints: [
    {
      id: 'CP-101',
      category: 'Road Infrastructure',
      title: 'Damaged pavement',
      description: 'Pothole on access road',
      location: { area: 'Agrabad, Chattogram', latitude: 22.32, longitude: 91.81 },
      status: 'In Progress',
      severity: 'High',
      priority_score: 85,
      reportedAt: '2026-11-01T10:00:00Z',
    },
  ],
  total: 1,
  pagination: { has_more: false },
};

const mockWorkHistoryResponse = {
  items: [
    {
      id: 'CP-HIST-001',
      complaint_id: 'CP-HIST-001',
      category: 'Road Infrastructure',
      title: 'Pavement Restoration',
      description: 'Bitumen resurfacing complete.',
      location: { area: 'Agrabad Commercial Area', latitude: 22.32, longitude: 91.81 },
      status: 'Resolved',
      admin_verified: true,
      verification_status: 'Verified',
      created_at: '2026-11-01T10:00:00Z',
      work_completed_at: '2026-11-02T15:30:00Z',
      after_image_url: 'https://images.unsplash.com/photo-1578985545062-69928b1d9587?w=400',
      evidence_versions: [
        {
          version: 1,
          image_url: 'https://images.unsplash.com/photo-1578985545062-69928b1d9587?w=400',
          completion_note: 'Initial patch test.',
          verification_status: 'rejected',
          admin_note: 'Compaction was incomplete.',
          uploaded_at: '2026-11-02T10:00:00Z',
          uploaded_by: 'officer.ccc',
        },
        {
          version: 2,
          image_url: 'https://images.unsplash.com/photo-1578985545062-69928b1d9587?w=400',
          completion_note: 'Full bitumen layer rolled and compacted.',
          verification_status: 'verified',
          uploaded_at: '2026-11-02T15:30:00Z',
          uploaded_by: 'officer.ccc',
        },
      ],
    },
  ],
  total: 1,
  total_pages: 1,
  stats: {
    total_assigned: 1,
    in_progress: 0,
    pending_verification: 0,
    verified: 1,
    rejected: 0,
  },
};

const mockVerificationQueueResponse = {
  items: [
    {
      id: 'CP-VER-001',
      complaint_id: 'CP-VER-001',
      category: 'Drainage & Waterlogging',
      title: 'Culvert Unblocking',
      description: 'Culvert sediment removed.',
      location: { area: 'Jubilee Road', latitude: 22.33, longitude: 91.83 },
      status: 'Evidence Uploaded',
      created_at: '2026-11-05T10:00:00Z',
      after_image_url: 'https://images.unsplash.com/photo-1578985545062-69928b1d9587?w=400',
      evidence_versions: [
        {
          version: 1,
          image_url: 'https://images.unsplash.com/photo-1578985545062-69928b1d9587?w=400',
          completion_note: 'Excavated 400kg silt from main box culvert.',
          verification_status: 'pending',
          uploaded_at: '2026-11-05T16:00:00Z',
          uploaded_by: 'officer.ccc',
        },
      ],
    },
  ],
  total: 1,
  total_pages: 1,
  stats: {
    pending_count: 1,
    approved_count: 0,
    rejected_count: 0,
  },
};

test.describe('Blank-Screen Crash Resolution - Browser Verification Suite', () => {

  test('Scenario 1: Authority opens Work History and waits 15 seconds with zero crashes', async ({ page }) => {
    test.setTimeout(45000);

    const consoleErrors = [];
    page.on('console', msg => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await page.route('**/api/auth/me', route => route.fulfill({ json: mockOfficerUser }));
    await page.route('**/api/complaints', route => route.fulfill({ json: mockComplaintsResponse }));
    await page.route('**/api/operations/work-history*', route => route.fulfill({ json: mockWorkHistoryResponse }));

    await page.goto('/');

    // Navigate to Authority portal / Admin
    await page.getByRole('button', { name: /Authority Portal|Admin/i }).click();

    // Verify Authority Workspace loaded
    await expect(page.getByText('Engr. Nazmul Huda Workspace').first()).toBeVisible();

    // Click 'Work History' tab
    await page.getByRole('button', { name: /Work History|কাজের ইতিহাস/i }).first().click();

    // Verify Work History view loaded
    await expect(page.getByText('CP-HIST-001')).toBeVisible();
    await expect(page.getByText('Pavement Restoration')).toBeVisible();

    // Wait full 15 seconds to monitor for interval timers, memory leaks, or unhandled crashes
    await page.waitForTimeout(15000);

    // Assert the component is still actively rendered and healthy
    await expect(page.getByText('CP-HIST-001')).toBeVisible();
    await expect(page.getByTestId('error-boundary-fallback')).not.toBeVisible();

    // Filter out expected network or favicon logs
    const fatalErrors = consoleErrors.filter(e => !e.includes('favicon') && !e.includes('net::ERR_') && !e.includes('Failed to load resource'));
    expect(fatalErrors).toHaveLength(0);
  });

  test('Scenario 2: Authority opens Evidence Management and waits 15 seconds with zero crashes', async ({ page }) => {
    test.setTimeout(45000);

    const consoleErrors = [];
    page.on('console', msg => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await page.route('**/api/auth/me', route => route.fulfill({ json: mockOfficerUser }));
    await page.route('**/api/complaints', route => route.fulfill({ json: mockComplaintsResponse }));
    await page.route('**/api/operations/work-history*', route => route.fulfill({ json: mockWorkHistoryResponse }));

    await page.goto('/');
    await page.getByRole('button', { name: /Authority Portal|Admin/i }).click();

    // Click 'Evidence Management' tab
    await page.getByRole('button', { name: /Evidence Management|প্রমাণ ব্যবস্থাপনা/i }).first().click();

    // Verify Evidence Management workbench loaded
    await expect(page.getByTestId('evidence-management-view')).toBeVisible();
    await expect(page.getByText('Immutable Evidence Version History')).toBeVisible();
    await expect(page.getByText('CP-HIST-001').first()).toBeVisible();

    // Wait full 15 seconds
    await page.waitForTimeout(15000);

    // Verify component remains stable
    await expect(page.getByTestId('evidence-management-view')).toBeVisible();
    await expect(page.getByTestId('error-boundary-fallback')).not.toBeVisible();

    const fatalErrors = consoleErrors.filter(e => !e.includes('favicon') && !e.includes('net::ERR_') && !e.includes('Failed to load resource'));
    expect(fatalErrors).toHaveLength(0);
  });

  test('Scenario 3: Admin opens Verification Queue and waits 15 seconds with zero crashes', async ({ page }) => {
    test.setTimeout(45000);

    const consoleErrors = [];
    page.on('console', msg => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await page.route('**/api/auth/me', route => route.fulfill({ json: mockAdminUser }));
    await page.route('**/api/complaints', route => route.fulfill({ json: mockComplaintsResponse }));
    await page.route('**/api/operations/verification-queue*', route => route.fulfill({ json: mockVerificationQueueResponse }));
    await page.route('**/api/operations/work-history*', route => route.fulfill({ json: mockWorkHistoryResponse }));

    await page.goto('/');
    await page.getByRole('button', { name: /Authority Portal|Admin/i }).click();

    // Click 'Verification Queue' tab
    await page.getByRole('button', { name: /Verification Queue|যাচাইকরণ কিউ/i }).first().click();

    // Verify Admin Verification queue is displayed
    await expect(page.getByTestId('admin-verification-queue')).toBeVisible();
    await expect(page.getByText('CP-VER-001')).toBeVisible();
    await expect(page.getByText('Culvert Unblocking')).toBeVisible();

    // Wait full 15 seconds
    await page.waitForTimeout(15000);

    // Assert queue is still active
    await expect(page.getByTestId('admin-verification-queue')).toBeVisible();
    await expect(page.getByTestId('error-boundary-fallback')).not.toBeVisible();

    const fatalErrors = consoleErrors.filter(e => !e.includes('favicon') && !e.includes('net::ERR_') && !e.includes('Failed to load resource'));
    expect(fatalErrors).toHaveLength(0);
  });

  test('Scenario 4: Switch between all three sections repeatedly without race conditions', async ({ page }) => {
    test.setTimeout(60000);

    await page.route('**/api/auth/me', route => route.fulfill({ json: mockAdminUser }));
    await page.route('**/api/complaints', route => route.fulfill({ json: mockComplaintsResponse }));
    await page.route('**/api/operations/verification-queue*', route => route.fulfill({ json: mockVerificationQueueResponse }));
    await page.route('**/api/operations/work-history*', route => route.fulfill({ json: mockWorkHistoryResponse }));

    await page.goto('/');
    await page.getByRole('button', { name: /Authority Portal|Admin/i }).click();

    // Repeat 5 cycles across Work History -> Verification Queue -> Evidence Management
    for (let cycle = 1; cycle <= 5; cycle++) {
      // 1. Work History
      await page.getByRole('button', { name: /Work History|কাজের ইতিহাস/i }).first().click();
      await expect(page.getByText('CP-HIST-001')).toBeVisible();
      await expect(page.getByTestId('error-boundary-fallback')).not.toBeVisible();

      // 2. Verification Queue
      await page.getByRole('button', { name: /Verification Queue|যাচাইকরণ কিউ/i }).first().click();
      await expect(page.getByTestId('admin-verification-queue')).toBeVisible();
      await expect(page.getByTestId('error-boundary-fallback')).not.toBeVisible();

      // 3. Evidence Management
      await page.getByRole('button', { name: /Evidence Management|প্রমাণ ব্যবস্থাপনা/i }).first().click();
      await expect(page.getByTestId('evidence-management-view')).toBeVisible();
      await expect(page.getByTestId('error-boundary-fallback')).not.toBeVisible();
    }
  });

  test('Scenario 5: Test empty API responses', async ({ page }) => {
    await page.route('**/api/auth/me', route => route.fulfill({ json: mockAdminUser }));
    await page.route('**/api/complaints', route => route.fulfill({ json: { complaints: [], total: 0 } }));
    await page.route('**/api/operations/verification-queue*', route => route.fulfill({ json: { items: [], total: 0, total_pages: 1 } }));
    await page.route('**/api/operations/work-history*', route => route.fulfill({ json: { items: [], total: 0, total_pages: 1 } }));

    await page.goto('/');
    await page.getByRole('button', { name: /Authority Portal|Admin/i }).click();

    // 1. Work History with 0 items
    await page.getByRole('button', { name: /Work History|কাজের ইতিহাস/i }).first().click();
    await expect(page.getByText(/No work history records found|কোনো রেকর্ড পাওয়া যায়নি/i)).toBeVisible();
    await expect(page.getByTestId('error-boundary-fallback')).not.toBeVisible();

    // 2. Verification Queue with 0 items
    await page.getByRole('button', { name: /Verification Queue|যাচাইকরণ কিউ/i }).first().click();
    await expect(page.getByText(/No submissions in the queue/i)).toBeVisible();
    await expect(page.getByTestId('error-boundary-fallback')).not.toBeVisible();

    // 3. Evidence Management with 0 items
    await page.getByRole('button', { name: /Evidence Management|প্রমাণ ব্যবস্থাপনা/i }).first().click();
    await expect(page.getByText(/Tasks \(0\)/i)).toBeVisible();
    await expect(page.getByText(/Select a task from the left column to view its evidence records/i)).toBeVisible();
    await expect(page.getByTestId('error-boundary-fallback')).not.toBeVisible();
  });

  test('Scenario 6: Test API 401, 403, and 500 error responses gracefully', async ({ page }) => {
    await page.route('**/api/auth/me', route => route.fulfill({ json: mockAdminUser }));
    await page.route('**/api/complaints', route => route.fulfill({ json: mockComplaintsResponse }));

    let currentStatusCode = 500;
    await page.route('**/api/operations/work-history*', route => {
      route.fulfill({
        status: currentStatusCode,
        contentType: 'application/json',
        body: JSON.stringify({ detail: `Simulated server error (${currentStatusCode})` }),
      });
    });

    await page.goto('/');
    await page.getByRole('button', { name: /Authority Portal|Admin/i }).click();

    // Test 500
    currentStatusCode = 500;
    await page.getByRole('button', { name: /Work History|কাজের ইতিহাস/i }).first().click();
    // Error boundary should NOT catch, normal toast/UI handles network errors
    await expect(page.getByTestId('error-boundary-fallback')).not.toBeVisible();

    // Test 403
    currentStatusCode = 403;
    await page.getByRole('button', { name: /Work History|কাজের ইতিহাস/i }).first().click();
    await expect(page.getByTestId('error-boundary-fallback')).not.toBeVisible();

    // Test 401
    currentStatusCode = 401;
    await page.getByRole('button', { name: /Work History|কাজের ইতিহাস/i }).first().click();
    await expect(page.getByTestId('error-boundary-fallback')).not.toBeVisible();
  });

  test('Scenario 7: Test missing and malformed location values (null, 0 coords, nested objects)', async ({ page }) => {
    const malformedLocationItems = [
      {
        id: 'CP-LOC-001',
        complaint_id: 'CP-LOC-001',
        category: 'Road Infrastructure',
        title: 'Zero Lat Lng Coords',
        description: 'Testing coordinate 0,0',
        location: { latitude: 0, longitude: 0 },
        status: 'In Progress',
      },
      {
        id: 'CP-LOC-002',
        complaint_id: 'CP-LOC-002',
        category: 'Street Lighting',
        title: 'Zero Lat, valid Lng',
        description: 'Testing coordinate 0,90.37',
        location: { latitude: 0, longitude: 90.37 },
        status: 'In Progress',
      },
      {
        id: 'CP-LOC-003',
        complaint_id: 'CP-LOC-003',
        category: 'Drainage',
        title: 'Valid Lat, zero Lng',
        description: 'Testing coordinate 23.75,0',
        location: { latitude: 23.75, longitude: 0 },
        status: 'In Progress',
      },
      {
        id: 'CP-LOC-004',
        complaint_id: 'CP-LOC-004',
        category: 'Waste Management',
        title: 'Malformed Object Area',
        description: 'Area is an object rather than a string',
        location: { area: { name: 'Dhanmondi', zone: 5 } },
        status: 'In Progress',
      },
      {
        id: 'CP-LOC-005',
        complaint_id: 'CP-LOC-005',
        category: 'Public Health',
        title: 'Null and undefined location',
        description: 'Location is null',
        location: null,
        status: 'In Progress',
      },
      {
        id: 'CP-LOC-006',
        complaint_id: 'CP-LOC-006',
        category: 'Water Supply',
        title: 'Array location',
        description: 'Location is an array',
        location: ['Dhaka', 'Bangladesh'],
        status: 'In Progress',
      },
    ];

    await page.route('**/api/auth/me', route => route.fulfill({ json: mockAdminUser }));
    await page.route('**/api/complaints', route => route.fulfill({ json: mockComplaintsResponse }));
    await page.route('**/api/operations/work-history*', route => route.fulfill({
      json: { items: malformedLocationItems, total: malformedLocationItems.length, total_pages: 1 },
    }));

    await page.goto('/');
    await page.getByRole('button', { name: /Authority Portal|Admin/i }).click();

    // 1. Open Work History with malformed items
    await page.getByRole('button', { name: /Work History|কাজের ইতিহাস/i }).first().click();

    // Verify all 6 items render without throwing fatal react child error
    await expect(page.getByText('CP-LOC-001')).toBeVisible();
    await expect(page.getByText('0, 0')).toBeVisible();
    await expect(page.getByText('0, 90.37')).toBeVisible();
    await expect(page.getByText('23.75, 0')).toBeVisible();
    await expect(page.getByText('CP-LOC-004')).toBeVisible();
    await expect(page.getByText('CP-LOC-005')).toBeVisible();
    await expect(page.getByText('CP-LOC-006')).toBeVisible();
    await expect(page.getByTestId('error-boundary-fallback')).not.toBeVisible();

    // 2. Open Evidence Management with malformed items
    await page.getByRole('button', { name: /Evidence Management|প্রমাণ ব্যবস্থাপনা/i }).first().click();
    await expect(page.getByTestId('evidence-management-view')).toBeVisible();
    await expect(page.getByText('CP-LOC-001').first()).toBeVisible();
    await expect(page.getByText('Tasks (6)')).toBeVisible();

    // Test search filter with formatLocation lowercase
    const searchInput = page.getByPlaceholder('Search tasks...');
    await searchInput.fill('0, 0');
    await expect(page.getByText('Tasks (1)')).toBeVisible();
    await searchInput.clear();
    await expect(page.getByText('Tasks (6)')).toBeVisible();

    // Zero error boundary triggers
    await expect(page.getByTestId('error-boundary-fallback')).not.toBeVisible();
  });

  test('Scenario 8: Test evidence upload, note update, and version history', async ({ page }) => {
    let currentWorkHistory = JSON.parse(JSON.stringify(mockWorkHistoryResponse));

    await page.route('**/api/auth/me', route => route.fulfill({ json: mockOfficerUser }));
    await page.route('**/api/complaints', route => route.fulfill({ json: mockComplaintsResponse }));
    await page.route('**/api/operations/work-history*', route => route.fulfill({ json: currentWorkHistory }));

    // Mock note edit endpoint
    await page.route('**/api/complaints/CP-HIST-001/evidence/note', async route => {
      const payload = JSON.parse(route.request().postData());
      currentWorkHistory.items[0].completion_description = payload.completion_note;
      currentWorkHistory.items[0].evidence_versions[1].completion_note = payload.completion_note;
      await route.fulfill({ json: { success: true } });
    });

    // Mock evidence upload endpoint
    await page.route('**/api/complaints/CP-HIST-001/evidence/upload', async route => {
      currentWorkHistory.items[0].evidence_versions.push({
        version: 3,
        image_url: 'https://images.unsplash.com/photo-1578985545062-69928b1d9587?w=400',
        completion_note: 'Submitted 3rd revised compaction verification.',
        verification_status: 'pending',
        uploaded_at: '2026-11-06T12:00:00Z',
        uploaded_by: 'officer.ccc',
      });
      await route.fulfill({ json: { success: true } });
    });

    await page.goto('/');
    await page.getByRole('button', { name: /Authority Portal|Admin/i }).click();
    await page.getByRole('button', { name: /Evidence Management|প্রমাণ ব্যবস্থাপনা/i }).click();

    // 1. Inspect version history
    await expect(page.getByText('Active Version: v2')).toBeVisible();
    await expect(page.getByText('Immutable Evidence Version History (2)')).toBeVisible();

    // 2. Edit Completion Note
    await page.getByRole('button', { name: /Edit Note/i }).first().click();
    await expect(page.getByTestId('edit-note-modal')).toBeVisible();
    const textarea = page.getByPlaceholder(/describe work performed/i);
    await textarea.fill('E2E Note: Compaction passed laser grade inspection.');
    await page.getByRole('button', { name: /Save Note/i }).click();

    // Verify modal closes and updated note appears
    await expect(page.getByTestId('edit-note-modal')).not.toBeVisible();
    await expect(page.getByText('E2E Note: Compaction passed laser grade inspection.').first()).toBeVisible();

    // 3. Upload Revised Evidence
    await page.getByRole('button', { name: /Upload Revised Evidence|Resubmit Correction/i }).first().click();
    await expect(page.getByTestId('replace-evidence-modal')).toBeVisible();

    // Upload a dummy image file
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles({
      name: 'compaction_proof_v3.png',
      mimeType: 'image/png',
      buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'),
    });

    const noteInput = page.getByPlaceholder(/Detail the corrective actions/i);
    await noteInput.fill('Submitted 3rd revised compaction verification.');

    await page.getByRole('button', { name: /Upload & Submit for Verification/i }).click();

    // Verify modal closes and new version v3 appears in version history list
    await expect(page.getByTestId('replace-evidence-modal')).not.toBeVisible();
    await expect(page.getByText('Active Version: v3')).toBeVisible();
    await expect(page.getByText('Immutable Evidence Version History (3)')).toBeVisible();
    await expect(page.getByText('Submitted 3rd revised compaction verification.')).toBeVisible();

    // Zero crashes
    await expect(page.getByTestId('error-boundary-fallback')).not.toBeVisible();
  });
});
