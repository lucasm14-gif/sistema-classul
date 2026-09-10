// Service worker da extensão Classul.
// Faz as chamadas à API do sistema (evita CORS) usando a URL e o token
// configurados na página de opções da extensão.

async function getConfig() {
  const { apiUrl, apiToken } = await chrome.storage.sync.get(['apiUrl', 'apiToken']);
  if (!apiUrl || !apiToken) {
    throw new Error('Configure a URL do sistema e a senha nas opções da extensão (clique com o botão direito no ícone da extensão > Opções).');
  }
  return { apiUrl: apiUrl.replace(/\/+$/, ''), apiToken };
}

async function apiRequest(path, options = {}) {
  const { apiUrl, apiToken } = await getConfig();
  const { classulUser } = await chrome.storage.sync.get(['classulUser']);
  const res = await fetch(`${apiUrl}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiToken}`,
      ...(classulUser ? { 'X-Classul-User': classulUser } : {}),
      ...(options.headers || {})
    }
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) throw new Error('Senha (token) incorreta. Verifique as opções da extensão.');
  if (!res.ok) throw new Error(data.error || `Erro ${res.status} na API do sistema.`);
  return data;
}

// Conteúdo servido pelo sistema (mensagens rápidas, fotos e catálogo).
// Guarda uma cópia local para o painel abrir instantâneo e continuar
// funcionando se a internet cair; a cópia é atualizada a cada busca.
const CONFIG_CACHE_KEY = 'classulExtensionConfig';

async function fetchExtensionConfig() {
  const data = await apiRequest('/api/extension/config');
  await chrome.storage.local.set({ [CONFIG_CACHE_KEY]: { data, at: Date.now() } });
  return data;
}

async function getExtensionConfig({ refresh } = {}) {
  const cached = (await chrome.storage.local.get([CONFIG_CACHE_KEY]))[CONFIG_CACHE_KEY];
  if (!refresh && cached?.data) {
    // devolve o que está em cache e atualiza em segundo plano
    fetchExtensionConfig().catch(() => {});
    return cached.data;
  }
  try {
    return await fetchExtensionConfig();
  } catch (err) {
    if (cached?.data) return cached.data; // offline: segue com a última cópia
    throw err;
  }
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'getExtensionConfig') {
    getExtensionConfig({ refresh: request.refresh })
      .then((data) => sendResponse({ success: true, data }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.action === 'createOrder') {
    apiRequest('/api/orders', {
      method: 'POST',
      body: JSON.stringify(request.data)
    })
      .then((result) => sendResponse({ success: true, data: result }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true; // mantém o canal aberto para resposta assíncrona
  }

  // Funcionários e etiquetas de conversa (compartilhadas)
  if (request.action === 'listEmployees') {
    apiRequest('/api/employees')
      .then((data) => sendResponse({ success: true, data }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.action === 'getChat') {
    apiRequest('/api/chats/' + encodeURIComponent(request.phone))
      .then((data) => sendResponse({ success: true, data }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.action === 'listChats') {
    apiRequest('/api/chats')
      .then((data) => sendResponse({ success: true, data }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.action === 'setChat') {
    apiRequest('/api/chats/' + encodeURIComponent(request.phone), {
      method: 'PUT',
      body: JSON.stringify({ employee: request.employee, status: request.status, name: request.name })
    })
      .then((data) => sendResponse({ success: true, data }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.action === 'clearChat') {
    apiRequest('/api/chats/' + encodeURIComponent(request.phone), { method: 'DELETE' })
      .then(() => sendResponse({ success: true }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.action === 'testConnection') {
    apiRequest('/api/orders')
      .then(() => sendResponse({ success: true }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  // Abre a conversa na aba do WhatsApp Web já aberta (pedido vindo do sistema via bridge.js)
  if (request.action === 'openWhatsAppChat') {
    (async () => {
      const phone = String(request.phone || '').replace(/\D/g, '');
      if (!phone) return sendResponse({ success: false, error: 'sem telefone' });

      const tabs = await chrome.tabs.query({ url: 'https://web.whatsapp.com/*' });
      if (tabs.length) {
        const tab = tabs[0];
        await chrome.windows.update(tab.windowId, { focused: true });
        await chrome.tabs.update(tab.id, { active: true });
        try {
          // pede pro content script abrir a conversa dentro da página (sem recarregar)
          await chrome.tabs.sendMessage(tab.id, { action: 'openChat', phone });
        } catch (e) {
          // content script indisponível (aba antiga?) → navega a própria aba
          await chrome.tabs.update(tab.id, { url: 'https://web.whatsapp.com/send?phone=' + phone });
        }
        sendResponse({ success: true, mode: 'existing-tab' });
      } else {
        await chrome.tabs.create({ url: 'https://web.whatsapp.com/send?phone=' + phone });
        sendResponse({ success: true, mode: 'new-tab' });
      }
    })().catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }
});

console.log('Classul Background Service Worker carregado');
