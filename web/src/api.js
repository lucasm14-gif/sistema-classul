const TOKEN_KEY = 'classul_token';
const USER_KEY = 'classul_user';

export function getToken() {
  return localStorage.getItem(TOKEN_KEY) || '';
}

export function setToken(token) {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

export function getUser() {
  return localStorage.getItem(USER_KEY) || '';
}

export function setUser(name) {
  if (name) localStorage.setItem(USER_KEY, name);
  else localStorage.removeItem(USER_KEY);
  window.dispatchEvent(new Event('classul-user-changed'));
}

export class AuthError extends Error {}

async function request(path, options = {}) {
  const user = getUser();
  const res = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${getToken()}`,
      ...(user ? { 'X-Classul-User': user } : {}),
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
  listClients: (search = '') =>
    request(`/api/clients${search ? `?search=${encodeURIComponent(search)}` : ''}`),
  getClient: (id) => request(`/api/clients/${id}`),
  createClient: (data) => request('/api/clients', { method: 'POST', body: JSON.stringify(data) }),
  updateClient: (id, data) => request(`/api/clients/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteClient: (id) => request(`/api/clients/${id}`, { method: 'DELETE' }),
  googleStatus: () => request('/api/google/status'),
  googleAuthUrl: () => request('/api/google/auth-url'),
  createUploadSession: (orderId, meta) =>
    request(`/api/orders/${orderId}/attachments/session`, { method: 'POST', body: JSON.stringify(meta) }),
  registerAttachment: (orderId, fileId, category = 'arquivo') =>
    request(`/api/orders/${orderId}/attachments`, {
      method: 'POST',
      body: JSON.stringify({ file_id: fileId, category })
    }),
  getStats: (month) => request(`/api/stats${month ? `?month=${month}` : ''}`),
  deleteAttachment: (id) => request(`/api/attachments/${id}`, { method: 'DELETE' }),
  getSettings: () => request('/api/settings'),
  saveSettings: (data) => request('/api/settings', { method: 'PUT', body: JSON.stringify(data) }),
  listEmployees: () => request('/api/employees'),
  createEmployee: (data) => request('/api/employees', { method: 'POST', body: JSON.stringify(data) }),
  deleteEmployee: (id) => request(`/api/employees/${id}`, { method: 'DELETE' }),
  addComment: (orderId, body) =>
    request(`/api/orders/${orderId}/comments`, { method: 'POST', body: JSON.stringify({ body }) }),
  deleteComment: (id) => request(`/api/comments/${id}`, { method: 'DELETE' }),
  botStatus: () => request('/api/bot/status'),
  botSetupWebhook: () => request('/api/bot/setup-webhook', { method: 'POST' }),
  botConversations: () => request('/api/bot/conversations'),
  botConversation: (phone) => request(`/api/bot/conversations/${phone}`),
  botReactivate: (phone) => request(`/api/bot/conversations/${phone}/reactivate`, { method: 'POST' }),
  listInstances: () => request('/api/evolution/instances'),
  testMessage: (number) =>
    request('/api/evolution/test', { method: 'POST', body: JSON.stringify({ number }) })
};
