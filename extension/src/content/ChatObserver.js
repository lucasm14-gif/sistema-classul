import { eventBus } from '../utils/events';
import { getActiveChatName, getActiveChatAvatar, getActiveChatPhone, scrapePhoneFromProfile } from '../utils/dom';

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

        // 1. Basic Data
        const name = getActiveChatName();
        const avatar = getActiveChatAvatar();

        // 2. Try Smart Phone Scraping
        let phone = getActiveChatPhone();

        const originalIcon = btn.innerHTML;
        btn.innerHTML = `<div style="animation: spin 1s linear infinite">⌛</div>`;

        if (!phone) {
            try {
                phone = await scrapePhoneFromProfile();
            } catch (err) {
                console.error("Smart Scrape failed:", err);
            }
        }

        btn.innerHTML = originalIcon;

        // Emit event to show modal
        eventBus.emit('SHOW_ORDER_MODAL', {
            name: name || "Novo Cliente",
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

// Procura um <input type=file> que aceite imagens (o WhatsApp usa esse input no anexo).
function findImageFileInput() {
    const inputs = [...document.querySelectorAll('input[type="file"]')];
    return (
        inputs.find((i) => /image/i.test(i.getAttribute('accept') || '')) ||
        inputs.find((i) => !i.getAttribute('accept')) ||
        inputs[0] ||
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

// Anexa todas as fotos no input de arquivo do WhatsApp e clica em Enviar.
async function sendHomenagemPhotos() {
    if (!document.querySelector('#main')) throw new Error('Abra uma conversa primeiro.');

    const files = await Promise.all(
        HOMENAGEM_PHOTOS.map((path, i) => fetchAssetAsFile(path, `placa-homenagem-${i + 1}.jpg`))
    );
    console.log('[Classul] fotos carregadas:', files.map((f) => `${f.name} (${f.size}b)`));

    // 1. acha o input de imagem (ou abre o menu de anexo para revelá-lo)
    let input = findImageFileInput();
    if (!input) {
        const attach = findAttachButton();
        console.log('[Classul] input não encontrado direto; botão de anexo:', attach);
        if (attach) {
            attach.click();
            input = await waitForElement2(findImageFileInput, 3500);
        }
    }
    if (!input) throw new Error('Não encontrei onde anexar no WhatsApp. Recarregue a página do WhatsApp Web.');
    console.log('[Classul] usando input de arquivo:', input, 'accept=', input.getAttribute('accept'));

    // 2. injeta os arquivos e avisa o WhatsApp (evento change)
    const dataTransfer = new DataTransfer();
    files.forEach((file) => dataTransfer.items.add(file));
    try {
        input.files = dataTransfer.files;
    } catch (err) {
        Object.defineProperty(input, 'files', { value: dataTransfer.files, configurable: true });
    }
    input.dispatchEvent(new Event('change', { bubbles: true }));

    // 3. espera o preview abrir com as miniaturas e clica em Enviar
    const sendBtn = await waitForElement2(findPreviewSendButton, 10000);
    console.log('[Classul] botão enviar do preview:', sendBtn);
    if (sendBtn) {
        await sleep(600); // deixa as miniaturas terminarem de carregar
        sendBtn.click();
        return { sent: true, count: files.length };
    }
    return { sent: false, count: files.length }; // preview aberto — Enter envia
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

export function initChatObserver() {
    // Observe the main app area for header changes
    const observer = new MutationObserver(() => {
        const header = document.querySelector('header');
        if (header) {
            // Check if we already injected
            if (header.querySelector('.kanban-header-btn')) return;

            // Find the actions container (usually has search/menu icons)
            const actionsContainer = header.lastElementChild;
            if (actionsContainer) {
                const imageCopyBtn = createImageCopyButton();
                const quickMsgBtn = createQuickMessagesButton();
                const orderBtn = createOrderButton();
                actionsContainer.prepend(imageCopyBtn);
                actionsContainer.prepend(quickMsgBtn);
                actionsContainer.prepend(orderBtn);
            }
        }
    });

    const appElement = document.getElementById('app'); // WhatsApp usually mounts here
    if (appElement) {
        observer.observe(appElement, {
            childList: true,
            subtree: true
        });
    } else {
        // Fallback or wait
        document.body.addEventListener('DOMNodeInserted', (e) => {
            if (e.target.id === 'app') {
                observer.observe(e.target, { childList: true, subtree: true });
            }
        });
    }
}
