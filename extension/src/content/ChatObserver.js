import { eventBus } from '../utils/events';
import { getActiveChatName, getActiveChatAvatar, getActiveChatPhone, scrapePhoneFromProfile, scrapeContactFromProfile, sleep } from '../utils/dom';

let currentButton = null;

function getExtensionAssetUrl(path) {
    if (typeof chrome !== 'undefined' && chrome.runtime?.getURL) {
        return chrome.runtime.getURL(path);
    }

    if (typeof browser !== 'undefined' && browser.runtime?.getURL) {
        return browser.runtime.getURL(path);
    }

    return path;
}

async function svgUrlToPngBlob(url) {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Falha ao carregar imagem: ${response.status}`);
    }

    const svgText = await response.text();
    const svgBlob = new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' });
    const objectUrl = URL.createObjectURL(svgBlob);

    try {
        const image = await new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = () => reject(new Error('Nao foi possivel renderizar a imagem.'));
            img.src = objectUrl;
        });

        const canvas = document.createElement('canvas');
        canvas.width = image.naturalWidth || 1907;
        canvas.height = image.naturalHeight || 1068;

        const context = canvas.getContext('2d');
        if (!context) {
            throw new Error('Canvas indisponivel para copiar imagem.');
        }

        context.fillStyle = '#ffffff';
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(image, 0, 0);

        const pngBlob = await new Promise((resolve, reject) => {
            canvas.toBlob((blob) => {
                if (blob) {
                    resolve(blob);
                    return;
                }

                reject(new Error('Nao foi possivel gerar PNG da imagem.'));
            }, 'image/png');
        });

        return pngBlob;
    } finally {
        URL.revokeObjectURL(objectUrl);
    }
}

// Converte qualquer imagem (JPG/PNG) para PNG — o clipboard do Chrome só aceita image/png.
async function rasterUrlToPngBlob(url) {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Falha ao carregar imagem: ${response.status}`);
    }

    const blob = await response.blob();
    if (!blob.type.startsWith('image/')) {
        throw new Error('O arquivo selecionado nao e uma imagem valida.');
    }
    if (blob.type === 'image/png') return blob;

    const bitmap = await createImageBitmap(blob);
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext('2d');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0);

    return new Promise((resolve, reject) => {
        canvas.toBlob((png) => {
            if (png) resolve(png);
            else reject(new Error('Nao foi possivel converter a imagem.'));
        }, 'image/png');
    });
}

async function copyImageAssetToClipboard(assetPath) {
    if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') {
        throw new Error('Seu navegador nao suporta copia de imagem pela area de transferencia.');
    }

    const assetUrl = getExtensionAssetUrl(assetPath);
    const pngBlob = assetPath.toLowerCase().endsWith('.svg')
        ? await svgUrlToPngBlob(assetUrl)
        : await rasterUrlToPngBlob(assetUrl);

    await navigator.clipboard.write([
        new ClipboardItem({
            'image/png': pngBlob
        })
    ]);
}

function createOrderButton() {
    const btn = document.createElement('button');
    btn.innerHTML = `
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <rect x="3" y="3" width="7" height="7" rx="1"></rect>
      <rect x="14" y="3" width="7" height="7" rx="1"></rect>
      <rect x="3" y="14" width="7" height="7" rx="1"></rect>
      <line x1="17.5" y1="14" x2="17.5" y2="21"></line>
      <line x1="14" y1="17.5" x2="21" y2="17.5"></line>
    </svg>
  `;
    btn.title = "Criar pedido no Classul";
    btn.className = "kanban-header-btn notion-btn";
    btn.style.marginRight = '8px';
    btn.onclick = async (e) => {
        e.preventDefault();
        e.stopPropagation();

        let name = getActiveChatName();
        const avatar = getActiveChatAvatar();
        let phone = getActiveChatPhone();

        // Contato não salvo mostra o número no lugar do nome.
        const nameIsNumber = /^[+\d][\d\s()\-]{5,}$/.test((name || '').trim());

        const originalIcon = btn.innerHTML;
        btn.innerHTML = `<div style="animation: spin 1s linear infinite">⌛</div>`;

        // Abre o perfil só quando precisa (sem nome de verdade ou sem telefone)
        if (nameIsNumber || !phone) {
            try {
                const info = await scrapeContactFromProfile();
                if (!phone && info.phone) phone = info.phone;
                if (nameIsNumber && info.name) name = info.name; // usa o nome do WhatsApp
            } catch (err) {
                console.error('Falha ao ler o perfil:', err);
            }
        }

        btn.innerHTML = originalIcon;

        eventBus.emit('SHOW_ORDER_MODAL', {
            name: name || 'Novo Cliente',
            avatar: avatar,
            phone: phone
        });
    };
    return btn;
}

function createQuickMessagesButton() {
    const btn = document.createElement('button');
    btn.innerHTML = `
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
      <line x1="9" y1="10" x2="15" y2="10"></line>
      <line x1="12" y1="7" x2="12" y2="13"></line>
    </svg>
  `;
    btn.title = "Mensagens Rápidas";
    btn.className = "kanban-header-btn quick-messages-btn";
    btn.style.marginRight = '8px';
    btn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();

        // Emit event to show quick messages panel
        eventBus.emit('SHOW_QUICK_MESSAGES');
    };
    return btn;
}

// Fotos de placa de homenagem enviadas todas de uma vez na conversa aberta
const HOMENAGEM_PHOTOS = [
    'bot-fotos/placa-homenagem-1.jpg',
    'bot-fotos/placa-homenagem-2.jpg',
    'bot-fotos/placa-homenagem-3.jpg',
    'bot-fotos/placa-homenagem-4.jpg',
    'bot-fotos/placa-homenagem-5.jpg'
];

async function fetchAssetAsFile(path, name) {
    const response = await fetch(getExtensionAssetUrl(path));
    if (!response.ok) throw new Error(`Falha ao carregar ${name}: ${response.status}`);
    const blob = await response.blob();
    return new File([blob], name, { type: blob.type || 'image/jpeg' });
}

async function waitForElement2(finder, timeout = 8000, step = 150) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
        const el = finder();
        if (el) return el;
        await sleep(step);
    }
    return null;
}

const inputAccept = (i) => (i.getAttribute('accept') || '').toLowerCase();

// Input de "Fotos e vídeos" — o único que aceita vídeo. É o que envia em qualidade normal.
// (o input de "Figurinha" aceita só imagem; usá-lo mandaria as fotos como figurinha.)
function findPhotosVideosInput() {
    return (
        [...document.querySelectorAll('input[type="file"]')].find((i) => /video/.test(inputAccept(i))) || null
    );
}

// Fallback: qualquer input que aceite imagem, evitando o de figurinha (webp puro).
function findAnyImageInput() {
    const inputs = [...document.querySelectorAll('input[type="file"]')];
    return (
        inputs.find((i) => /image/.test(inputAccept(i)) && inputAccept(i) !== 'image/webp') ||
        inputs.find((i) => /image/.test(inputAccept(i))) ||
        inputs.find((i) => !inputAccept(i)) ||
        null
    );
}

// Botão "+" / clipe de anexar, para revelar os inputs de arquivo caso não existam ainda.
function findAttachButton() {
    const iconSelectors = [
        'plus', 'plus-rounded', 'attach-menu-plus', 'clip', 'attach', 'wds-ic-plus-filled'
    ].map((n) => `#main footer span[data-icon="${n}"]`);
    for (const sel of iconSelectors) {
        const icon = document.querySelector(sel);
        if (icon) return icon.closest('div[role="button"], button, span[role="button"]') || icon;
    }
    const labelled = document.querySelector(
        '#main footer [aria-label="Anexar"], #main footer [title="Anexar"], #main footer [aria-label="Attach"], #main footer [title="Attach"]'
    );
    return labelled || null;
}

function findPreviewSendButton() {
    // botão de enviar do preview de mídia (várias variações do WhatsApp Web)
    const byAria = document.querySelector(
        'div[role="button"][aria-label="Enviar"], button[aria-label="Enviar"], div[role="button"][aria-label="Send"], button[aria-label="Send"]'
    );
    if (byAria) return byAria;
    const byTestId = document.querySelector('[data-testid="send"]');
    if (byTestId) return byTestId;
    const icon = document.querySelector(
        'span[data-icon="send"], span[data-icon="wds-ic-send-filled"], span[data-icon="send-light"]'
    );
    return icon ? icon.closest('div[role="button"], button') || icon : null;
}

// Mostra um quadro de diagnóstico na tela (o usuário tira print e manda).
function showDiag(lines) {
    document.getElementById('classul-diag')?.remove();
    const box = document.createElement('div');
    box.id = 'classul-diag';
    box.style.cssText = `
        position: fixed; top: 16px; left: 50%; transform: translateX(-50%);
        z-index: 2147483647; background: #0f172a; color: #fff; padding: 14px 18px;
        border-radius: 12px; box-shadow: 0 8px 32px rgba(0,0,0,.4); max-width: 92vw;
        font-family: -apple-system, sans-serif; font-size: 12px; line-height: 1.5;
        border: 1px solid rgba(255,255,255,.15); white-space: pre-wrap;`;
    box.textContent = 'CLASSUL — diagnóstico (tire um print e mande):\n\n' + lines.join('\n');
    const close = document.createElement('div');
    close.textContent = '✕ fechar';
    close.style.cssText = 'margin-top:10px;cursor:pointer;color:#82c953;font-weight:700;';
    close.onclick = () => box.remove();
    box.appendChild(close);
    document.body.appendChild(box);
    setTimeout(() => box.remove(), 30000);
}

function listFileInputs() {
    return [...document.querySelectorAll('input[type="file"]')].map(
        (i, n) => `#${n + 1} accept="${i.getAttribute('accept') || '(vazio)'}"`
    );
}

function setInputFiles(input, files) {
    const dt = new DataTransfer();
    files.forEach((f) => dt.items.add(f));
    try {
        input.files = dt.files;
    } catch (e) {
        Object.defineProperty(input, 'files', { value: dt.files, configurable: true });
    }
    input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    input.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
}

// Injeta o inject.js no MUNDO DA PÁGINA (necessário para a colagem funcionar).
let injectReady = false;
function ensurePageScript() {
    if (document.getElementById('classul-inject')) return;
    const s = document.createElement('script');
    s.id = 'classul-inject';
    s.src = getExtensionAssetUrl('inject.js');
    (document.head || document.documentElement).appendChild(s);
}

if (typeof window !== 'undefined') {
    window.addEventListener('message', (e) => {
        if (e.source === window && e.data?.type === 'CLASSUL_INJECT_READY') injectReady = true;
    });
}

// Cola as 5 fotos no campo de mensagem (via script na página) e envia como FOTO normal.
async function sendHomenagemPhotos() {
    if (!document.querySelector('#main')) throw new Error('Abra uma conversa primeiro.');

    ensurePageScript();
    // espera o script da página ficar pronto
    for (let i = 0; i < 30 && !injectReady; i++) await sleep(100);

    const files = await Promise.all(
        HOMENAGEM_PHOTOS.map((path, i) => fetchAssetAsFile(path, `placa-homenagem-${i + 1}.jpg`))
    );

    const result = await new Promise((resolve) => {
        const onResult = (e) => {
            if (e.source !== window || e.data?.type !== 'CLASSUL_SEND_PHOTOS_RESULT') return;
            window.removeEventListener('message', onResult);
            resolve(e.data);
        };
        window.addEventListener('message', onResult);
        window.postMessage({ type: 'CLASSUL_SEND_PHOTOS', files }, '*');
        setTimeout(() => {
            window.removeEventListener('message', onResult);
            resolve({ ok: false, reason: 'Tempo esgotado. Recarregue o WhatsApp Web (F5).' });
        }, 20000);
    });

    if (result.ok) return { sent: true, count: files.length };
    if (/Enter/.test(result.reason || '')) return { sent: false, count: files.length };
    throw new Error(result.reason || 'Não foi possível enviar as fotos.');
}

function createImageCopyButton() {
    const btn = document.createElement('button');
    const defaultIcon = `
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2"></rect>
      <circle cx="8.5" cy="8.5" r="1.5"></circle>
      <path d="M21 15l-5-5L5 21"></path>
    </svg>
  `;

    btn.innerHTML = defaultIcon;
    btn.title = "Enviar as fotos de placa de homenagem nesta conversa";
    btn.className = "kanban-header-btn quick-image-btn";
    btn.style.marginRight = '8px';
    btn.onclick = async (e) => {
        e.preventDefault();
        e.stopPropagation();

        const originalTitle = btn.title;
        btn.disabled = true;
        btn.style.opacity = '0.7';
        btn.innerHTML = `<div style="animation: spin 1s linear infinite">⌛</div>`;

        try {
            const result = await sendHomenagemPhotos();
            btn.innerHTML = `
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M20 6L9 17l-5-5"></path>
            </svg>
          `;
            btn.title = result.sent
                ? `${result.count} fotos enviadas!`
                : 'Fotos anexadas — aperte Enter para enviar.';
        } catch (error) {
            console.error('Falha ao enviar fotos:', error);
            btn.innerHTML = `
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="10"></circle>
              <line x1="15" y1="9" x2="9" y2="15"></line>
              <line x1="9" y1="9" x2="15" y2="15"></line>
            </svg>
          `;
            btn.title = error.message || "Erro ao enviar fotos";
        } finally {
            window.setTimeout(() => {
                btn.disabled = false;
                btn.style.opacity = '1';
                btn.innerHTML = defaultIcon;
                btn.title = originalTitle;
            }, 2500);
        }
    };

    return btn;
}

function bgSend(msg) {
    return new Promise((resolve) => {
        try {
            chrome.runtime.sendMessage(msg, (r) => resolve(chrome.runtime.lastError ? null : r));
        } catch (e) {
            resolve(null);
        }
    });
}

async function getMyName() {
    try {
        const { classulUser } = await chrome.storage.sync.get(['classulUser']);
        return classulUser || '';
    } catch (e) {
        return '';
    }
}

const ASSIGN_COLORS = ['#4a9c33', '#ee3b33', '#eabf00', '#2563eb', '#7c3aed', '#db2777', '#0891b2'];
function assignmentColor(name) {
    let h = 0;
    for (let i = 0; i < (name || '').length; i++) h = (h * 31 + name.charCodeAt(i)) % ASSIGN_COLORS.length;
    return ASSIGN_COLORS[h] || ASSIGN_COLORS[0];
}

const normName = (s) => (s || '').trim().toLowerCase();
function chatKeyFor(name, phone) {
    return phone || 'n_' + normName(name);
}

// Aviso rápido no canto da tela.
function classulToast(text, color = '#0f172a') {
    const t = document.createElement('div');
    t.textContent = text;
    t.style.cssText =
        'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);z-index:2147483647;' +
        `background:${color};color:#fff;padding:10px 18px;border-radius:12px;font-size:13px;font-weight:700;` +
        'font-family:-apple-system,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.3)';
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 3000);
}

// Mapa compartilhado de etiquetas (nome da conversa -> atribuição).
let assignmentsByName = new Map();

async function refreshAssignments() {
    const r = await bgSend({ action: 'listChats' });
    if (!r || !r.success) return;
    const map = new Map();
    for (const a of r.data || []) {
        if (a.chat_name) map.set(normName(a.chat_name), a);
    }
    assignmentsByName = map;
    paintChatList();
}

function chatListPane() {
    return (
        document.querySelector('#pane-side') ||
        document.querySelector('[aria-label="Lista de conversas"]') ||
        document.querySelector('[aria-label="Chat list"]') ||
        document.querySelector('div[role="grid"]')
    );
}

function chatListRows() {
    const pane = chatListPane();
    if (!pane) return [];
    let rows = [...pane.querySelectorAll('[role="listitem"]')];
    if (!rows.length) rows = [...pane.querySelectorAll('[role="row"]')];
    return rows;
}

function rowTitle(row) {
    const t = row.querySelector('span[title]');
    if (t) return t.getAttribute('title') || t.textContent || '';
    const s = row.querySelector('span[dir="auto"]');
    return s ? s.textContent || '' : '';
}

function makeBadge(employee) {
    const b = document.createElement('span');
    b.className = 'classul-assign-badge';
    b.style.cssText =
        'display:inline-flex;align-items:center;margin-left:6px;padding:1px 7px;border-radius:9px;' +
        'font-size:10px;font-weight:700;color:#fff;vertical-align:middle;white-space:nowrap;' +
        `background:${assignmentColor(employee)}`;
    b.textContent = employee;
    return b;
}

// Coloca/atualiza a etiqueta do funcionário em cada linha da lista de conversas.
function paintChatList() {
    // Nada marcado e nada pintado: não há o que fazer (caso mais comum).
    if (assignmentsByName.size === 0 && !document.querySelector('.classul-assign-badge')) return;

    for (const row of chatListRows()) {
        const a = assignmentsByName.get(normName(rowTitle(row)));
        const existing = row.querySelector('.classul-assign-badge');
        if (a && a.employee) {
            if (existing) {
                existing.textContent = a.employee;
                existing.style.background = assignmentColor(a.employee);
            } else {
                const titleEl = row.querySelector('span[title]') || row.querySelector('span[dir="auto"]');
                if (titleEl && titleEl.parentElement) titleEl.parentElement.appendChild(makeBadge(a.employee));
            }
        } else if (existing) {
            existing.remove();
        }
    }
}

let lastAssignmentsFetch = 0;

// Sincroniza as etiquetas com o servidor no máximo 1x por minuto e só com a aba visível.
async function maybeRefreshAssignments() {
    if (document.hidden) return;
    const now = Date.now();
    if (now - lastAssignmentsFetch < 60000) return;
    lastAssignmentsFetch = now;
    await refreshAssignments();
}

// Etiqueta "quem está atendendo" desta conversa (compartilhada entre a equipe).
function createAssignmentButton() {
    const btn = document.createElement('button');
    btn.className = 'kanban-header-btn classul-assign-btn';
    btn.style.marginRight = '8px';

    const userIconSvg = (color) => `
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
      <circle cx="12" cy="7" r="4"></circle>
    </svg>`;

    // O botão vive na barra lateral (fixa), então lê a conversa ativa a cada
    // atualização em vez de guardar o valor de quando foi criado.
    let assignment = null;

    const render = () => {
        if (assignment && assignment.employee) {
            btn.innerHTML = userIconSvg(assignmentColor(assignment.employee));
            btn.title = `Atendendo: ${assignment.employee}. Clique para assumir/limpar.`;
        } else {
            btn.innerHTML = userIconSvg('currentColor');
            btn.title = 'Marcar quem está atendendo esta conversa';
        }
    };

    // Chamada pelo laço principal: reflete a conversa aberta no momento.
    btn.classulSync = () => {
        const atual = assignmentsByName.get(normName(getActiveChatName())) || null;
        const mudou = (atual?.employee || null) !== (assignment?.employee || null);
        assignment = atual;
        if (mudou || !btn.innerHTML) render();
    };
    render();

    btn.onclick = async (e) => {
        e.preventDefault();
        e.stopPropagation();

        if (!document.querySelector('#main')) {
            classulToast('Abra uma conversa primeiro', '#b71f19');
            return;
        }

        const me = await getMyName();
        if (!me) {
            alert('Escolha seu nome nas Opções da extensão (botão direito no ícone > Opções > "Quem é você?").');
            return;
        }

        const name = getActiveChatName();
        const phone = getActiveChatPhone();
        const key = chatKeyFor(name, phone);

        if (assignment && assignment.employee === me) {
            const r = await bgSend({ action: 'clearChat', phone: key });
            if (r?.success) {
                assignment = null;
                render();
                await refreshAssignments();
                classulToast('Atendimento removido desta conversa');
            } else {
                classulToast('Erro ao remover: ' + (r?.error || 'sem conexão'), '#b71f19');
            }
        } else {
            const r = await bgSend({ action: 'setChat', phone: key, employee: me, status: 'atendendo', name });
            if (r?.success) {
                assignment = r.data;
                render();
                await refreshAssignments();
                classulToast(`✓ Você (${me}) está atendendo "${name}"`, '#3a7a2a');
            } else {
                classulToast('Erro ao marcar: ' + (r?.error || 'sem conexão'), '#b71f19');
            }
        }
    };

    return btn;
}

// Barra lateral esquerda do WhatsApp (conversas, status, canais, configurações).
// É o lugar mais estável para nossos botões: não muda ao abrir/fechar conversa
// e não disputa espaço com os ícones do cabeçalho.
const NAV_ICONS = [
    'chats-outline', 'chats-filled', 'chat-outline', 'status-outline', 'status-refreshed',
    'channels-outline', 'newsletter-outline', 'community-outline', 'communities-outline',
    'settings-outline', 'settings-refreshed', 'meta-ai-outline'
];

function findNavRail() {
    const icon = document.querySelector(NAV_ICONS.map((n) => `span[data-icon="${n}"]`).join(', '));
    const item = icon?.closest('li, button, a, div[role="button"]');
    const container = item?.parentElement;
    if (!container) return null;
    // precisa ser a coluna vertical (mais alta que larga)
    const r = container.getBoundingClientRect();
    return r.height > r.width * 1.5 ? container : null;
}

let sidebarButtons = null;

function injectSidebarButtons() {
    const nav = findNavRail();
    if (!nav) return false;
    if (sidebarButtons && nav.contains(sidebarButtons)) return true;

    if (!sidebarButtons) sidebarButtons = buildButtonGroup();
    sidebarButtons.classList.remove('classul-inline'); // coluna na barra lateral
    nav.appendChild(sidebarButtons);
    return true;
}

function buildButtonGroup() {
    const group = document.createElement('div');
    group.className = 'classul-nav-group';
    group.append(
        createAssignmentButton(),
        createOrderButton(),
        createQuickMessagesButton(),
        createImageCopyButton()
    );
    return group;
}

// Mantém o botão de atendimento coerente com a conversa aberta.
function syncSidebarButtons() {
    sidebarButtons?.querySelector('.classul-assign-btn')?.classulSync?.();
}

// Reserva: em versões do WhatsApp sem a barra lateral, usa o cabeçalho da conversa.
function injectHeaderFallback() {
    const header = document.querySelector('#main header');
    if (!header || header.querySelector('.kanban-header-btn')) return;
    const icon = header.querySelector('span[data-icon="search"], span[data-icon="menu"]');
    const actions = icon?.closest('div[role="button"], button, li')?.parentElement || header.lastElementChild;
    if (!actions) return;
    if (!sidebarButtons) sidebarButtons = buildButtonGroup();
    sidebarButtons.classList.add('classul-inline'); // em linha no cabeçalho
    actions.prepend(sidebarButtons);
}

export function initChatObserver() {
    // Um único laço leve cuida de tudo. Antes usávamos MutationObserver com
    // subtree no app inteiro (dispara milhares de vezes/segundo no WhatsApp) e
    // o evento DOMNodeInserted, que é obsoleto e trava o carregamento da página.
    // Um querySelector por segundo custa praticamente nada.
    let semBarraLateral = 0;
    const tick = () => {
        if (document.hidden) return;
        try {
            if (!injectSidebarButtons()) {
                // depois de ~8s sem achar a barra lateral, usa o cabeçalho
                if (++semBarraLateral > 8) injectHeaderFallback();
            } else {
                semBarraLateral = 0;
            }
            syncSidebarButtons();
            paintChatList();
            maybeRefreshAssignments();
        } catch (err) {
            console.error('[Classul] tick:', err);
        }
    };

    tick();
    setInterval(tick, 1000);
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) tick();
    });
}
