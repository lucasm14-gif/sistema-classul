// Abre uma conversa dentro do próprio WhatsApp Web (sem recarregar a página),
// usando a busca nativa. Se não encontrar, cai para /send?phone= na MESMA aba.

const SEARCH_SELECTORS = [
    'div[contenteditable="true"][data-tab="3"]',
    '[data-testid="chat-list-search"]',
    '#side div[contenteditable="true"][role="textbox"]'
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function findSearchBox() {
    for (const sel of SEARCH_SELECTORS) {
        const el = document.querySelector(sel);
        if (el) return el;
    }
    return null;
}

function searchText(box) {
    return (box?.innerText || box?.textContent || '').trim();
}

function pressKey(el, key, keyCode) {
    el.dispatchEvent(
        new KeyboardEvent('keydown', { key, code: key, keyCode, which: keyCode, bubbles: true, cancelable: true })
    );
}

function goToSendPage(digits) {
    window.location.assign('https://web.whatsapp.com/send?phone=' + digits + '&app_absent=0');
}

async function openChatByPhone(rawPhone) {
    const digits = String(rawPhone || '').replace(/\D/g, '');
    if (!digits) return { ok: false, reason: 'sem telefone' };

    // busca sem o DDI 55 costuma casar melhor com contatos brasileiros salvos
    const query = digits.startsWith('55') && digits.length >= 12 ? digits.slice(2) : digits;

    const box = findSearchBox();
    if (!box) {
        goToSendPage(digits);
        return { ok: true, mode: 'send-page' };
    }

    box.focus();
    document.execCommand('selectAll', false, null);
    document.execCommand('delete', false, null);
    document.execCommand('insertText', false, query);

    await sleep(1400); // espera os resultados da busca

    pressKey(box, 'Enter', 13); // Enter abre o primeiro resultado

    await sleep(900);

    // quando a conversa abre, o WhatsApp limpa a busca — esse é o sinal de sucesso
    const stillSearching = searchText(findSearchBox());
    if (stillSearching) {
        // nenhum resultado → limpa a busca e abre via /send na mesma aba
        pressKey(box, 'Escape', 27);
        await sleep(200);
        goToSendPage(digits);
        return { ok: true, mode: 'send-page' };
    }

    return { ok: true, mode: 'in-app' };
}

export function initOpenChat() {
    if (typeof chrome === 'undefined' || !chrome.runtime?.onMessage) return;
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request?.action === 'openChat' && request.phone) {
            openChatByPhone(request.phone)
                .then((result) => sendResponse(result))
                .catch((err) => sendResponse({ ok: false, reason: err.message }));
            return true; // resposta assíncrona
        }
    });
}
