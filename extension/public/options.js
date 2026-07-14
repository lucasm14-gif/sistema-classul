const apiUrlInput = document.getElementById('apiUrl');
const apiTokenInput = document.getElementById('apiToken');
const saveBtn = document.getElementById('save');
const statusEl = document.getElementById('status');

chrome.storage.sync.get(['apiUrl', 'apiToken']).then(({ apiUrl, apiToken }) => {
  if (apiUrl) apiUrlInput.value = apiUrl;
  if (apiToken) apiTokenInput.value = apiToken;
});

saveBtn.addEventListener('click', async () => {
  const apiUrl = apiUrlInput.value.trim().replace(/\/+$/, '');
  const apiToken = apiTokenInput.value.trim();

  if (!apiUrl || !apiToken) {
    statusEl.className = 'err';
    statusEl.textContent = 'Preencha a URL e a senha.';
    return;
  }

  await chrome.storage.sync.set({ apiUrl, apiToken });
  statusEl.className = '';
  statusEl.textContent = 'Testando conexão…';

  chrome.runtime.sendMessage({ action: 'testConnection' }, (response) => {
    if (response?.success) {
      statusEl.className = 'ok';
      statusEl.textContent = '✓ Conectado ao sistema Classul!';
    } else {
      statusEl.className = 'err';
      statusEl.textContent = response?.error || 'Falha na conexão.';
    }
  });
});
