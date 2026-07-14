const TOKEN_KEY = 'classul_token';

export function getToken() {
  return localStorage.getItem(TOKEN_KEY) || '';
}

export function setToken(token) {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

export class AuthError extends Error {}

async function request(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${getToken()}`,
      ...(options.headers || {})
    }
  });
  if (res.status === 401) throw new AuthError('Sessão inválida');
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Erro ${res.status}`);
  return data;
}

export const api = {
  listOrders: (archived = false) => request(`/api/orders${archived ? '?archived=1' : ''}`),
  getOrder: (id) => request(`/api/orders/${id}`),
  createOrder: (data) => request('/api/orders', { method: 'POST', body: JSON.stringify(data) }),
  updateOrder: (id, data) => request(`/api/orders/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  moveOrder: (id, status) =>
    request(`/api/orders/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }),
  notifyOrder: (id, status) =>
    request(`/api/orders/${id}/notify`, { method: 'POST', body: JSON.stringify({ status }) }),
  archiveOrder: (id, archived) =>
    request(`/api/orders/${id}/archive`, { method: 'PATCH', body: JSON.stringify({ archived }) }),
  deleteOrder: (id) => request(`/api/orders/${id}`, { method: 'DELETE' }),
  getSettings: () => request('/api/settings'),
  saveSettings: (data) => request('/api/settings', { method: 'PUT', body: JSON.stringify(data) }),
  listInstances: () => request('/api/evolution/instances'),
  testMessage: (number) =>
    request('/api/evolution/test', { method: 'POST', body: JSON.stringify({ number }) })
};
