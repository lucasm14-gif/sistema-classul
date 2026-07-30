const apiUrlInput = document.getElementById('apiUrl');
const apiTokenInput = document.getElementById('apiToken');
const employeeSelect = document.getElementById('employee');
const saveBtn = document.getElementById('save');
const statusEl = document.getElementById('status');

chrome.storage.sync.get(['apiUrl', 'apiToken', 'classulUser']).then(({ apiUrl, apiToken, classulUser }) => {
  if (apiUrl) apiUrlInput.value = apiUrl;
  if (apiToken) apiTokenInput.value = apiToken;
  if (apiUrl && apiToken) loadEmployees(classulUser);
});

function loadEmployees(selected) {
  chrome.runtime.sendMessage({ action: 'listEmployees' }, (response) => {
    if (!response?.success) return;
    const current = selected || employeeSelect.value;
    employeeSelect.innerHTML = '<option value="">— nenhum —</option>';
    (response.data || []).forEach((e) => {
      const opt = document.createElement('option');
      opt.value = e.name;
      opt.textContent = e.name;
      if (e.name === current) opt.selected = true;
      employeeSelect.appendChild(opt);
    });
  });
}

// salva o funcionário escolhido na hora
employeeSelect.addEventListener('change', () => {
  chrome.storage.sync.set({ classulUser: employeeSelect.value });
});

saveBtn.addEventListener('click', async () => {
  const apiUrl = apiUrlInput.value.trim().replace(/\/+$/, '');
  const apiToken = apiTokenInput.value.trim();

  if (!apiUrl || !apiToken) {
    statusEl.className = 'err';
    statusEl.textContent = 'Preencha a URL e a senha.';
    return;
  }

  await chrome.storage.sync.set({ apiUrl, apiToken, classulUser: employeeSelect.value });
  statusEl.className = '';
  statusEl.textContent = 'Testando conexão…';

  chrome.runtime.sendMessage({ action: 'testConnection' }, (response) => {
    if (response?.success) {
      statusEl.className = 'ok';
      statusEl.textContent = '✓ Conectado ao sistema Classul!';
      loadEmployees(employeeSelect.value);
    } else {
      statusEl.className = 'err';
      statusEl.textContent = response?.error || 'Falha na conexão.';
    }
  });
});
