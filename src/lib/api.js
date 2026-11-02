export const API_BASE = window.URBANFIX_API_BASE || '/api';

export async function api(path, options = {}) {
  const method = (options.method || 'GET').toUpperCase();
  const response = await fetch(`${API_BASE}${path}`, {
    credentials: 'same-origin',
    ...options,
    headers: {
      ...(options.headers || {}),
      ...(!['GET', 'HEAD', 'OPTIONS'].includes(method) && window.URBANFIX_CSRF
        ? { 'X-CSRF-Token': window.URBANFIX_CSRF }
        : {}),
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = Array.isArray(body.detail)
      ? body.detail.map(item => item.msg || item.message || String(item)).join(' · ')
      : body.detail;
    const error = new Error(detail || `Request failed (${response.status})`);
    error.status = response.status;
    throw error;
  }
  return body;
}
