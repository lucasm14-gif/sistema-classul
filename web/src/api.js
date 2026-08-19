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
// Lançado quando o PIN das finanças é exigido/expirou (403 com finance_locked).
export class FinanceLockError extends Error {}
// Lançado quando o PIN da área do Lucas é exigido/expirou (403 com lucas_locked).
export class LucasLockError extends Error {}

const FINANCE_TOKEN_KEY = 'classul_finance_token';
export function getFinanceToken() {
  return sessionStorage.getItem(FINANCE_TOKEN_KEY) || '';
}
export function setFinanceToken(token) {
  if (token) sessionStorage.setItem(FINANCE_TOKEN_KEY, token);
  else sessionStorage.removeItem(FINANCE_TOKEN_KEY);
}

const LUCAS_TOKEN_KEY = 'classul_lucas_token';
export function getLucasToken() {
  return sessionStorage.getItem(LUCAS_TOKEN_KEY) || '';
}
export function setLucasToken(token) {
  if (token) sessionStorage.setItem(LUCAS_TOKEN_KEY, token);
  else sessionStorage.removeItem(LUCAS_TOKEN_KEY);
}

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
  if (res.status === 403 && data.finance_locked) throw new FinanceLockError(data.error || 'Finanças bloqueadas');
  if (res.status === 403 && data.lucas_locked) throw new LucasLockError(data.error || 'Área bloqueada');
  if (!res.ok) throw new Error(data.error || `Erro ${res.status}`);
  return data;
}

// Como request(), mas envia o finance token da aba de Finanças.
function financeRequest(path, options = {}) {
  return request(path, {
    ...options,
    headers: { 'X-Finance-Token': getFinanceToken(), ...(options.headers || {}) }
  });
}

// Como request(), mas envia o token da área pessoal do Lucas.
function lucasRequest(path, options = {}) {
  return request(path, {
    ...options,
    headers: { 'X-Lucas-Token': getLucasToken(), ...(options.headers || {}) }
  });
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
  getLeads: () => request('/api/leads'),
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
    request('/api/evolution/test', { method: 'POST', body: JSON.stringify({ number }) }),
  // ---- Finanças ----
  financeStatus: () => request('/api/finance/status'),
  financeSetPin: (pin, currentPin) =>
    request('/api/finance/pin', { method: 'POST', body: JSON.stringify({ pin, current_pin: currentPin }) }),
  financeUnlock: (pin) => request('/api/finance/unlock', { method: 'POST', body: JSON.stringify({ pin }) }),
  financeConfig: () => financeRequest('/api/finance/config'),
  financeSaveConfig: (data) => financeRequest('/api/finance/config', { method: 'PUT', body: JSON.stringify(data) }),
  financeConnectToken: (itemId) =>
    financeRequest('/api/finance/connect-token', { method: 'POST', body: JSON.stringify({ item_id: itemId }) }),
  financeAddItem: (itemId) =>
    financeRequest('/api/finance/items', { method: 'POST', body: JSON.stringify({ item_id: itemId }) }),
  financeRenameItem: (itemId, label) =>
    financeRequest(`/api/finance/items/${itemId}`, { method: 'PUT', body: JSON.stringify({ label }) }),
  financeRemoveItem: (itemId) => financeRequest(`/api/finance/items/${itemId}`, { method: 'DELETE' }),
  financeSummary: (days) => financeRequest(`/api/finance/summary${days ? `?days=${days}` : ''}`),
  // ---- Área pessoal do Lucas ----
  lucasStatus: () => request('/api/lucas/status'),
  lucasSetPin: (pin, currentPin) =>
    request('/api/lucas/pin', { method: 'POST', body: JSON.stringify({ pin, current_pin: currentPin }) }),
  lucasUnlock: (pin) => request('/api/lucas/unlock', { method: 'POST', body: JSON.stringify({ pin }) }),
  lucasOverview: () => lucasRequest('/api/lucas/overview'),
  lucasCreateTask: (data) => lucasRequest('/api/lucas/tasks', { method: 'POST', body: JSON.stringify(data) }),
  lucasUpdateTask: (id, data) =>
    lucasRequest(`/api/lucas/tasks/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  lucasDeleteTask: (id) => lucasRequest(`/api/lucas/tasks/${id}`, { method: 'DELETE' }),
  lucasCreateRoutine: (data) => lucasRequest('/api/lucas/routines', { method: 'POST', body: JSON.stringify(data) }),
  lucasUpdateRoutine: (id, data) =>
    lucasRequest(`/api/lucas/routines/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  lucasDeleteRoutine: (id) => lucasRequest(`/api/lucas/routines/${id}`, { method: 'DELETE' }),
  lucasCheckRoutine: (id, day, done) =>
    lucasRequest(`/api/lucas/routines/${id}/check`, { method: 'POST', body: JSON.stringify({ day, done }) })
};
