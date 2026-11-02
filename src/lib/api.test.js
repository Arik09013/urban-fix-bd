import { api } from './api.js';

afterEach(() => {
  vi.restoreAllMocks();
  delete window.URBANFIX_CSRF;
});

test('adds CSRF protection to mutations', async () => {
  window.URBANFIX_CSRF = 'csrf-token';
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
  await api('/offers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  expect(fetchMock).toHaveBeenCalledWith('/api/offers', expect.objectContaining({
    credentials: 'same-origin',
    headers: expect.objectContaining({ 'X-CSRF-Token': 'csrf-token' }),
  }));
});

test('turns validation responses into readable errors', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue({
    ok: false,
    status: 422,
    json: async () => ({ detail: [{ msg: 'A report link is required' }] }),
  });
  await expect(api('/offers/proof', { method: 'POST' })).rejects.toThrow('A report link is required');
});
