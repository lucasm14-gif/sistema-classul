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
  const res = await fetch(`${apiUrl}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiToken}`,
      ...(options.headers || {})
    }
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) throw new Error('Senha (token) incorreta. Verifique as opções da extensão.');
  if (!res.ok) throw new Error(data.error || `Erro ${res.status} na API do sistema.`);
  return data;
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'createOrder') {
    apiRequest('/api/orders', {
      method: 'POST',
      body: JSON.stringify(request.data)
    })
      .then((result) => sendResponse({ success: true, data: result }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true; // mantém o canal aberto para resposta assíncrona
  }

  if (request.action === 'testConnection') {
    apiRequest('/api/orders')
      .then(() => sendResponse({ success: true }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }
});

console.log('Classul Background Service Worker carregado');
