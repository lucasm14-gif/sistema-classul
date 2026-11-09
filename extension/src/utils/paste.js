// Cola arquivos no campo de mensagem da conversa aberta pelo script da página
// (public/inject.js), SEM enviar: o WhatsApp abre a prévia e a pessoa confere e envia.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let ready = false;
if (typeof window !== 'undefined') {
    window.addEventListener('message', (e) => {
        if (e.source === window && e.data?.type === 'CLASSUL_INJECT_READY') ready = true;
    });
}

async function ensurePageScript() {
    if (!document.getElementById('classul-inject')) {
        const s = document.createElement('script');
        s.id = 'classul-inject';
        s.src = chrome.runtime.getURL('inject.js');
        (document.head || document.documentElement).appendChild(s);
        for (let i = 0; i < 30 && !ready; i++) await sleep(100);
    }
}

export async function pasteFilesIntoChat(files) {
    if (!document.querySelector('#main')) throw new Error('Abra a conversa primeiro.');
    await ensurePageScript();
    const result = await new Promise((resolve) => {
        const onResult = (e) => {
            if (e.source !== window || e.data?.type !== 'CLASSUL_PASTE_FILES_RESULT') return;
            window.removeEventListener('message', onResult);
            resolve(e.data);
        };
        window.addEventListener('message', onResult);
        window.postMessage({ type: 'CLASSUL_PASTE_FILES', files }, '*');
        setTimeout(() => {
            window.removeEventListener('message', onResult);
            resolve({ ok: false, reason: 'Tempo esgotado. Recarregue o WhatsApp Web (F5).' });
        }, 15000);
    });
    if (!result.ok) throw new Error(result.reason || 'Não consegui anexar o arquivo.');
    return result;
}
