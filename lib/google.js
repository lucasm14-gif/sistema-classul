import crypto from 'crypto';
import { q, getSettings, setSettings } from './db.js';
import { formatOrderNumber } from './whatsapp.js';

const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';

// Estado do OAuth derivado do API_TOKEN — impede callbacks forjados.
export function oauthState() {
  return crypto
    .createHash('sha256')
    .update('classul-oauth:' + (process.env.API_TOKEN || ''))
    .digest('hex')
    .slice(0, 40);
}

export function buildAuthUrl(clientId, redirectUri) {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: DRIVE_SCOPE,
    access_type: 'offline',
    prompt: 'consent',
    state: oauthState()
  });
  return 'https://accounts.google.com/o/oauth2/v2/auth?' + params.toString();
}

export async function exchangeCode(code, redirectUri) {
  const s = await getSettings();
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: s.google_client_id,
      client_secret: s.google_client_secret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code'
    })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error('Google recusou o código: ' + (data.error_description || data.error || res.status));
  }
  return data;
}

let cachedToken = null; // { token, exp, refresh }

export async function getAccessToken() {
  const s = await getSettings();
  if (!s.google_client_id || !s.google_client_secret) {
    throw new Error('Google Drive não configurado. Preencha Client ID e Client Secret em Configurações.');
  }
  if (!s.google_refresh_token) {
    throw new Error('Google Drive não conectado. Use o botão "Conectar Google Drive" em Configurações.');
  }
  if (cachedToken && cachedToken.refresh === s.google_refresh_token && Date.now() < cachedToken.exp) {
    return cachedToken.token;
  }
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: s.google_client_id,
      client_secret: s.google_client_secret,
      refresh_token: s.google_refresh_token,
      grant_type: 'refresh_token'
    })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      'Google recusou a autenticação (reconecte o Drive em Configurações): ' +
        (data.error_description || data.error || res.status)
    );
  }
  cachedToken = {
    token: data.access_token,
    exp: Date.now() + Math.max(0, (data.expires_in || 3600) - 60) * 1000,
    refresh: s.google_refresh_token
  };
  return data.access_token;
}

async function driveJson(url, opts = {}) {
  const token = await getAccessToken();
  const res = await fetch(url, {
    ...opts,
    headers: { Authorization: `Bearer ${token}`, ...(opts.headers || {}) }
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`Google Drive respondeu ${res.status}: ${JSON.stringify(data).slice(0, 300)}`);
  }
  return data;
}

async function createFolder(name, parentId) {
  return driveJson('https://www.googleapis.com/drive/v3/files?fields=id,name', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name,
      mimeType: 'application/vnd.google-apps.folder',
      ...(parentId ? { parents: [parentId] } : {})
    })
  });
}

export async function ensureRootFolder() {
  const s = await getSettings();
  if (s.google_folder_id) return s.google_folder_id;
  const folder = await createFolder('Classul - Pedidos');
  await setSettings({ google_folder_id: folder.id });
  return folder.id;
}

export async function ensureOrderFolder(order) {
  if (order.drive_folder_id) return order.drive_folder_id;
  const rootId = await ensureRootFolder();
  const folder = await createFolder(`Pedido ${formatOrderNumber(order.id)} - ${order.customer_name}`, rootId);
  await q('UPDATE orders SET drive_folder_id = $1 WHERE id = $2', [folder.id, order.id]);
  return folder.id;
}

// Cria a sessão de upload retomável; o navegador envia o arquivo direto ao Google.
export async function createUploadSession(order, { name, mimeType, size }, origin) {
  const folderId = await ensureOrderFolder(order);
  const token = await getAccessToken();
  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json; charset=UTF-8',
    'X-Upload-Content-Type': mimeType || 'application/octet-stream'
  };
  if (size) headers['X-Upload-Content-Length'] = String(size);
  if (origin) headers['Origin'] = origin; // libera o CORS para o PUT feito pelo navegador
  const res = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name,mimeType,size,webViewLink',
    { method: 'POST', headers, body: JSON.stringify({ name, parents: [folderId] }) }
  );
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Falha ao iniciar upload no Drive (${res.status}): ${body.slice(0, 200)}`);
  }
  const uploadUrl = res.headers.get('location');
  if (!uploadUrl) throw new Error('Google não devolveu a URL de upload.');
  return uploadUrl;
}

export async function getFileMeta(fileId) {
  return driveJson(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=id,name,mimeType,size,webViewLink`
  );
}

export async function deleteFile(fileId) {
  const token = await getAccessToken();
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok && res.status !== 404) {
    throw new Error(`Falha ao excluir arquivo no Drive (${res.status}).`);
  }
}
