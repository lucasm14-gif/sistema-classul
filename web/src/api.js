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
// Lançado quando o PIN da aba Notas é exigido/expirou (403 com nfe_locked).
export class NfeLockError extends Error {}

const NFE_TOKEN_KEY = 'classul_nfe_token';
export function getNfeToken() {
  return sessionStorage.getItem(NFE_TOKEN_KEY) || '';
}
export function setNfeToken(token) {
  if (token) sessionStorage.setItem(NFE_TOKEN_KEY, token);
  else sessionStorage.removeItem(NFE_TOKEN_KEY);
}

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
  if (res.status === 403 && data.nfe_locked) throw new NfeLockError(data.error || 'Notas bloqueadas');
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

// Como request(), mas envia o token da aba Notas.
function nfeRequest(path, options = {}) {
  return request(path, {
    ...options,
    headers: { 'X-Nfe-Token': getNfeToken(), ...(options.headers || {}) }
  });
}

// Baixa um arquivo da aba Notas (PDF/XML) como Blob.
async function nfeBlob(path) {
  const user = getUser();
  const res = await fetch(path, {
    headers: {
      Authorization: `Bearer ${getToken()}`,
      'X-Nfe-Token': getNfeToken(),
      ...(user ? { 'X-Classul-User': user } : {})
    }
  });
  if (res.status === 401) throw new AuthError('Sessão inválida');
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    if (res.status === 403 && data.nfe_locked) throw new NfeLockError(data.error);
    throw new Error(data.error || `Erro ${res.status}`);
  }
  return res.blob();
}

const json = (body) => JSON.stringify(body);

export const nfeApi = {
  status: () => request('/api/nfe/status'),
  setPin: (pin, currentPin) => request('/api/nfe/pin', { method: 'POST', body: json({ pin, current_pin: currentPin }) }),
  unlock: (pin) => request('/api/nfe/unlock', { method: 'POST', body: json({ pin }) }),
  config: () => nfeRequest('/api/nfe/config'),
  saveConfig: (data) => nfeRequest('/api/nfe/config', { method: 'PUT', body: json(data) }),
  saveCert: (pfx, senha) => nfeRequest('/api/nfe/certificado', { method: 'POST', body: json({ pfx, senha }) }),
  sefazStatus: () => nfeRequest('/api/nfe/sefaz-status'),
  produtos: () => nfeRequest('/api/nfe/produtos'),
  saveProduto: (id, data) =>
    nfeRequest(id ? `/api/nfe/produtos/${id}` : '/api/nfe/produtos', { method: id ? 'PUT' : 'POST', body: json(data) }),
  clientes: (q = '') => nfeRequest(`/api/nfe/clientes${q ? `?q=${encodeURIComponent(q)}` : ''}`),
  saveCliente: (id, data) =>
    nfeRequest(id ? `/api/nfe/clientes/${id}` : '/api/nfe/clientes', { method: id ? 'PUT' : 'POST', body: json(data) }),
  ultimaDoCliente: (id) => nfeRequest(`/api/nfe/clientes/${id}/ultima`),
  copiaNota: (id) => nfeRequest(`/api/nfe/notas/${id}/copia`),
  resumo: () => nfeRequest('/api/nfe/resumo'),
  notas: (params = {}) => {
    const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== '' && v != null)).toString();
    return nfeRequest(`/api/nfe/notas${qs ? `?${qs}` : ''}`);
  },
  nota: (id) => nfeRequest(`/api/nfe/notas/${id}`),
  emitir: (data) => nfeRequest('/api/nfe/emitir', { method: 'POST', body: json(data) }),
  consultar: (id) => nfeRequest(`/api/nfe/notas/${id}/consultar`, { method: 'POST' }),
  cancelar: (id, justificativa) => nfeRequest(`/api/nfe/notas/${id}/cancelar`, { method: 'POST', body: json({ justificativa }) }),
  cce: (id, correcao) => nfeRequest(`/api/nfe/notas/${id}/cce`, { method: 'POST', body: json({ correcao }) }),
  whatsapp: (id, telefone, mensagem) =>
    nfeRequest(`/api/nfe/notas/${id}/whatsapp`, { method: 'POST', body: json({ telefone, mensagem }) }),
  danfe: (id) => nfeBlob(`/api/nfe/notas/${id}/danfe`),
  xml: (id) => nfeBlob(`/api/nfe/notas/${id}/xml`),
  eventoXml: (id) => nfeBlob(`/api/nfe/eventos/${id}/xml`),
  inutilizar: (data) => nfeRequest('/api/nfe/inutilizar', { method: 'POST', body: json(data) }),
  inutilizacoes: () => nfeRequest('/api/nfe/inutilizacoes'),
  consultarChave: (chave) => nfeRequest('/api/nfe/consultar-chave', { method: 'POST', body: json({ chave }) }),
  importar: (lote) => nfeRequest('/api/nfe/importar', { method: 'POST', body: json(lote) })
};

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
  getPlates: () => request('/api/plates'),
  savePlatesSettings: (data) => request('/api/plates-settings', { method: 'PUT', body: JSON.stringify(data) }),
  getPlateArt: async (id) => {
    const res = await fetch(`/api/plates/${id}/file/arte`, { headers: { Authorization: `Bearer ${getToken()}` } });
    if (res.status === 401) throw new AuthError('Sessão inválida');
    if (!res.ok) throw new Error('Não encontrei a arte desta placa.');
    return res.blob();
  },
  savePlatePhoto: (id, jpg) => request(`/api/plates/${id}/foto`, { method: 'POST', body: JSON.stringify({ jpg }) }),
  downloadPlateFile: async (id, kind) => {
    const res = await fetch(`/api/plates/${id}/file/${kind}`, { headers: { Authorization: `Bearer ${getToken()}` } });
    if (res.status === 401) throw new AuthError('Sessão inválida');
    if (!res.ok) throw new Error('Não foi possível baixar o arquivo.');
    const name = (res.headers.get('Content-Disposition') || '').match(/filename="([^"]+)"/)?.[1] || `placa-${id}.${kind}`;
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  },
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
  // ---- Hermes (bot na VPS) ----
  hermesConfig: () => request('/api/hermes/config'),
  hermesSaveConfig: (data) => request('/api/hermes/config', { method: 'PUT', body: JSON.stringify(data) }),
  hermesRotateToken: () => request('/api/hermes/rotate-token', { method: 'POST' }),
  hermesTest: () => request('/api/hermes/test', { method: 'POST' }),
  hermesEvents: (limit = 40) => request(`/api/hermes/events?limit=${limit}`),
  // Conteúdo servido à extensão
  getExtensionConfig: () => request('/api/extension/config'),
  listQuickMessages: () => request('/api/quick-messages'),
  createQuickMessage: (data) => request('/api/quick-messages', { method: 'POST', body: JSON.stringify(data) }),
  updateQuickMessage: (id, data) =>
    request(`/api/quick-messages/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteQuickMessage: (id) => request(`/api/quick-messages/${id}`, { method: 'DELETE' }),
  reorderQuickMessages: (ids) => request('/api/quick-messages-order', { method: 'PUT', body: JSON.stringify({ ids }) }),
  listCatalog: () => request('/api/catalog'),
  createCatalogProduct: (data) => request('/api/catalog', { method: 'POST', body: JSON.stringify(data) }),
  updateCatalogProduct: (id, data) => request(`/api/catalog/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteCatalogProduct: (id) => request(`/api/catalog/${id}`, { method: 'DELETE' }),
  listPhotoSets: () => request('/api/photo-sets'),
  createPhotoSet: (name) => request('/api/photo-sets', { method: 'POST', body: JSON.stringify({ name }) }),
  updatePhotoSet: (id, name) => request(`/api/photo-sets/${id}`, { method: 'PUT', body: JSON.stringify({ name }) }),
  deletePhotoSet: (id) => request(`/api/photo-sets/${id}`, { method: 'DELETE' }),
  createPhotoSession: (setId, meta) =>
    request(`/api/photo-sets/${setId}/photos/session`, { method: 'POST', body: JSON.stringify(meta) }),
  registerPhoto: (setId, fileId) =>
    request(`/api/photo-sets/${setId}/photos`, { method: 'POST', body: JSON.stringify({ file_id: fileId }) }),
  deletePhoto: (id) => request(`/api/photos/${id}`, { method: 'DELETE' }),
  // Observador de conversas do WhatsApp
  listWatchedChats: () => request('/api/watched-chats'),
  getWatchedChat: (phone) => request(`/api/watched-chats/${phone}`),
  unwatchChat: (phone) => request(`/api/watched-chats/${phone}`, { method: 'DELETE' }),
  listSuggestions: () => request('/api/suggestions'),
  acceptSuggestion: (id, data = {}) =>
    request(`/api/suggestions/${id}/accept`, { method: 'POST', body: JSON.stringify(data) }),
  dismissSuggestion: (id) => request(`/api/suggestions/${id}/dismiss`, { method: 'POST' }),
  analyzeChat: (phone) => request(`/api/watched-chats/${phone}/analyze`, { method: 'POST' }),
  listInboxFiles: () => request('/api/inbox-files'),
  attachInboxFile: (id, orderId, category = 'arquivo') =>
    request(`/api/inbox-files/${id}/attach`, {
      method: 'POST',
      body: JSON.stringify({ order_id: orderId, category })
    }),
  deleteInboxFile: (id) => request(`/api/inbox-files/${id}`, { method: 'DELETE' }),
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
    lucasRequest(`/api/lucas/routines/${id}/check`, { method: 'POST', body: JSON.stringify({ day, done }) }),
  artExtract: (conversation) => request('/api/arts/extract', { method: 'POST', body: JSON.stringify({ conversation }) }),
  lucasYear: () => lucasRequest('/api/lucas/year'),
  lucasUpdateYear: (data) => lucasRequest('/api/lucas/year', { method: 'PUT', body: JSON.stringify(data) }),
  lucasCreateGoal: (data) => lucasRequest('/api/lucas/goals', { method: 'POST', body: JSON.stringify(data) }),
  lucasUpdateGoal: (id, data) =>
    lucasRequest(`/api/lucas/goals/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  lucasDeleteGoal: (id) => lucasRequest(`/api/lucas/goals/${id}`, { method: 'DELETE' }),
  lucasJournal: (day) => lucasRequest(`/api/lucas/journal/${day}`),
  lucasSaveJournal: (data) => lucasRequest('/api/lucas/journal', { method: 'PUT', body: JSON.stringify(data) })
};
