// Helper to wait for elements (WhatsApp loads dynamically)
export const waitForElement = (selector, timeout = 10000) => {
    return new Promise((resolve) => {
        if (document.querySelector(selector)) {
            return resolve(document.querySelector(selector));
        }

        const observer = new MutationObserver((mutations) => {
            if (document.querySelector(selector)) {
                resolve(document.querySelector(selector));
                observer.disconnect();
            }
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true,
        });

        setTimeout(() => {
            observer.disconnect();
            resolve(null);
        }, timeout);
    });
};

export const getActiveChatName = () => {
    // Strategy 1: Look for the specific header in the main panel
    const mainHeader = document.querySelector('#main header');
    if (mainHeader) {
        // Look for the title info (usually the text inside a specific span)
        // WhatsApp Web usually puts the name in a generic span under the header info
        const titleSpan = mainHeader.querySelector('div[role="button"] > div > span[dir="auto"]');
        if (titleSpan) return titleSpan.innerText;

        // Fallback: Look for the biggest text in the header
        const allSpans = Array.from(mainHeader.querySelectorAll('span[dir="auto"]'));
        // The contact name is usually the first one or the one with the largest font/most importance
        if (allSpans.length > 0) return allSpans[0].innerText;
    }

    // Strategy 2: If we can't find #main, look for any header with a profile picture adjacent
    const headers = document.querySelectorAll('header');
    for (let header of headers) {
        if (header.closest('#side')) continue; // Skip sidebar header

        const titleCandidate = header.querySelector('span[title]');
        if (titleCandidate) return titleCandidate.title;
    }

    return "Desconhecido";
};

export const getActiveChatAvatar = () => {
    const header = document.querySelector('#main header');
    if (!header) return null;

    const img = header.querySelector('img');
    if (img) return img.src;

    return null;
};

// Helper for async delays
export const sleep = (ms) => new Promise(r => setTimeout(r, ms));

export const getActiveChatPhone = () => {
    // Strategy 1: Check if the title itself is a phone number (Unsaved contacts)
    const name = getActiveChatName();
    const cleanName = name.replace(/\D/g, '');
    if (cleanName.length >= 10 && cleanName.length <= 15) {
        return cleanName;
    }

    // Strategy 2: Extract from Avatar URL (Saved contacts often have the ID in the URL)
    const avatar = getActiveChatAvatar();
    if (avatar) {
        const uMatch = avatar.match(/u=(\d+)/);
        if (uMatch && uMatch[1]) return uMatch[1];

        const ppsMatch = avatar.match(/pps\/user\/(\d+)/);
        if (ppsMatch && ppsMatch[1]) return ppsMatch[1];
    }

    return null;
};

// Só o telefone (botão de acompanhar conversa).
export const scrapePhoneFromProfile = async () => (await scrapeContactFromProfile()).phone;

// Nossos próprios elementos nunca contam como "painel do contato".
const isOurs = (el) => Boolean(el.closest('.clp, #wa-kanban-root, .classul-nav-group, .clp-toast'));

// Painel de dados do contato que o WhatsApp abre à direita ao clicar no cabeçalho.
function findProfileDrawer() {
    const main = document.querySelector('#main');
    const mainLeft = main ? main.getBoundingClientRect().left : window.innerWidth / 2;
    const candidates = [
        ...document.querySelectorAll('#app aside, #app [role="region"], #app section, #app div[tabindex="-1"]')
    ];
    return (
        candidates.find((el) => {
            if (isOurs(el) || el.closest('#side')) return false;
            const r = el.getBoundingClientRect();
            // à direita do início da conversa (a própria conversa começa em mainLeft)
            return r.width > 200 && r.height > 300 && r.left > mainLeft + 50;
        }) || null
    );
}

const PHONE_RE = /^\+?\d{2,3}[\s-]?\(?\d{2}\)?[\s-]?\d{4,5}[\s-]?\d{4}$/;

// Abre o perfil do contato uma vez, lê nome e telefone e fecha de novo.
// Usado quando a conversa não revela o número (contato salvo / id @lid).
export const scrapeContactFromProfile = async () => {
    const headerTitle =
        document.querySelector('#main header [role="button"][title]') ||
        document.querySelector('#main header div[role="button"]');
    if (!headerTitle) return { name: null, phone: null };

    const wasOpen = findProfileDrawer();
    if (!wasOpen) headerTitle.click();

    let drawer = null;
    for (let i = 0; i < 25 && !drawer; i++) {
        await sleep(100);
        drawer = findProfileDrawer();
    }
    if (!drawer) return { name: null, phone: null };

    const isPhoneLike = (t) => /^[+\d][\d\s()\-]{5,}$/.test(t);
    const isStatus = (t) =>
        /online|visto por|digitando|typing|last seen|recado|clique aqui|toque aqui|tap here|adicionar|add to|dados do contato|contact info/i.test(t);

    let name = null;
    let phone = null;
    // o texto às vezes chega um pouco depois do painel
    for (let tries = 0; tries < 8 && !phone; tries++) {
        if (tries) await sleep(150);
        for (const el of drawer.querySelectorAll('h1, h2, span, div[dir="auto"]')) {
            if (el.children.length > 2) continue;
            const text = (el.innerText || '').trim();
            if (!text || text.length > 40) continue;
            if (!phone && PHONE_RE.test(text) && !text.includes(':')) phone = text.replace(/\D/g, '');
            if (!name && !isPhoneLike(text) && !isStatus(text) && text.length >= 2) name = text.replace(/^~\s*/, '').trim();
        }
    }

    // fecha só se fomos nós que abrimos
    if (!wasOpen) {
        const closeBtn =
            drawer.querySelector('[aria-label="Fechar"], [aria-label="Close"], span[data-icon="x"], span[data-icon="close"]') ||
            document.querySelector('#app [aria-label="Fechar"], #app [aria-label="Close"]');
        (closeBtn?.closest('button, [role="button"]') || closeBtn)?.click();
    }
    if (phone) rememberPhone(getActiveChatName(), phone);
    return { name, phone };
};

// Telefone descoberto por conversa (nome → número), guardado no aparelho para
// não precisar abrir o perfil de novo. Os pedidos ficam no sistema; isto é só atalho.
const PHONE_CACHE_KEY = 'classulPhoneByChat';
const phoneCache = new Map();
try {
    chrome.storage?.local.get([PHONE_CACHE_KEY]).then((r) => {
        for (const [k, v] of Object.entries(r?.[PHONE_CACHE_KEY] || {})) phoneCache.set(k, v);
    });
} catch {
    /* fora da extensão (testes) */
}
const cacheKey = (name) => String(name || '').trim().toLowerCase();
export const rememberPhone = (name, phone) => {
    const k = cacheKey(name);
    if (!k || !phone || phoneCache.get(k) === phone) return;
    phoneCache.set(k, phone);
    try {
        chrome.storage?.local.set({ [PHONE_CACHE_KEY]: Object.fromEntries(phoneCache) });
    } catch {
        /* sem armazenamento */
    }
};
export const cachedPhone = (name) => phoneCache.get(cacheKey(name)) || null;

// Telefone da conversa aberta lido das próprias mensagens: cada balão tem um
// data-id como "false_5551999999999@c.us_ABC…", inclusive de contato salvo.
// Grupos (@g.us) e contas com id oculto (@lid) não revelam número.
export const getChatPhoneFromMessages = () => {
    const nodes = document.querySelectorAll('#main [data-id]');
    for (let i = nodes.length - 1; i >= 0 && i >= nodes.length - 30; i--) {
        const m = /^(?:true|false)_(\d{10,15})@c\.us/.exec(nodes[i].getAttribute('data-id') || '');
        if (m) return m[1];
    }
    return null;
};

// Melhor palpite sem abrir o perfil: mensagens, depois título/foto.
export const getActiveChatPhoneDeep = () =>
    getChatPhoneFromMessages() || cachedPhone(getActiveChatName()) || getActiveChatPhone();

// Conversa aberta é grupo? (não faz sentido buscar pedidos de grupo)
export const isGroupChat = () => Boolean(document.querySelector('#main [data-id*="@g.us"]'));

// Coloca um texto no campo de mensagem da conversa aberta, SEM enviar —
// a pessoa revisa e aperta Enter. Tenta colar (mantém as quebras de linha);
// se o WhatsApp ignorar, digita; em último caso copia para a área de transferência.
export const insertIntoComposer = async (text) => {
    const box =
        document.querySelector('#main footer div[contenteditable="true"]') ||
        document.querySelector('#main div[contenteditable="true"][role="textbox"]');
    if (!box) {
        await navigator.clipboard?.writeText(text).catch(() => {});
        return 'copied';
    }
    box.focus();
    const before = box.innerText;
    try {
        const dt = new DataTransfer();
        dt.setData('text/plain', text);
        box.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    } catch (e) {
        /* segue para o plano B */
    }
    await sleep(60);
    if (box.innerText !== before) return 'inserted';
    if (document.execCommand('insertText', false, text)) return 'inserted';
    await navigator.clipboard?.writeText(text).catch(() => {});
    return 'copied';
};

// O WhatsApp está no tema escuro? (lê a cor de fundo real da página)
export const isWhatsAppDark = () => {
    const el = document.querySelector('#app > div') || document.body;
    const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(getComputedStyle(el).backgroundColor || '');
    if (m && !(m[1] === '0' && m[2] === '0' && m[3] === '0' && /rgba/.test(getComputedStyle(el).backgroundColor))) {
        return 0.299 * m[1] + 0.587 * m[2] + 0.114 * m[3] < 110;
    }
    return document.body.classList.contains('dark') || document.documentElement.classList.contains('dark');
};

// Dados da conversa aberta, do jeito que o painel de pedidos precisa.
export const readActiveContact = () => {
    if (!document.querySelector('#main')) return null;
    const name = (getActiveChatName() || '').trim();
    return {
        name,
        phone: getActiveChatPhoneDeep(),
        avatar: getActiveChatAvatar(),
        group: isGroupChat(),
        nameIsNumber: /^[+\d][\d\s()\-]{5,}$/.test(name)
    };
};
