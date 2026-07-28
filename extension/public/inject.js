// Roda no MUNDO DA PÁGINA do WhatsApp Web (não no mundo isolado da extensão).
// Isso é essencial: só assim o evento de "colar" com as imagens é aceito pelo WhatsApp,
// abrindo o preview de FOTO NORMAL (não figurinha) e permitindo clicar em Enviar.
(function () {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

    function findComposer() {
        return (
            document.querySelector('#main footer div[contenteditable="true"][data-tab]') ||
            document.querySelector('#main footer div[contenteditable="true"]') ||
            document.querySelector('#main div[contenteditable="true"][role="textbox"]')
        );
    }

    function findSendButton() {
        const byAria = document.querySelector(
            'div[role="button"][aria-label="Enviar"], button[aria-label="Enviar"], div[role="button"][aria-label="Send"], button[aria-label="Send"]'
        );
        if (byAria) return byAria;
        const icon = document.querySelector(
            'span[data-icon="send"], span[data-icon="wds-ic-send-filled"], span[data-icon="send-light"]'
        );
        return icon ? icon.closest('div[role="button"], button') || icon : null;
    }

    async function waitFor(finder, timeout = 10000, step = 150) {
        const start = Date.now();
        while (Date.now() - start < timeout) {
            const el = finder();
            if (el) return el;
            await sleep(step);
        }
        return null;
    }

    async function sendPhotos(files) {
        const composer = findComposer();
        if (!composer) return { ok: false, reason: 'Abra uma conversa primeiro.' };

        const dataTransfer = new DataTransfer();
        files.forEach((file) => dataTransfer.items.add(file));

        composer.focus();
        // clica no meio do campo para garantir o foco/caret
        composer.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        composer.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));

        const pasteEvent = new ClipboardEvent('paste', { bubbles: true, cancelable: true });
        Object.defineProperty(pasteEvent, 'clipboardData', { value: dataTransfer });
        composer.dispatchEvent(pasteEvent);

        const sendBtn = await waitFor(findSendButton, 12000);
        if (sendBtn) {
            await sleep(800); // deixa as miniaturas carregarem
            sendBtn.click();
            return { ok: true, count: files.length };
        }
        return { ok: false, reason: 'Fotos coladas, mas não achei o botão Enviar. Aperte Enter.' };
    }

    window.addEventListener('message', async (event) => {
        if (event.source !== window || !event.data || event.data.type !== 'CLASSUL_SEND_PHOTOS') return;
        let result;
        try {
            result = await sendPhotos(event.data.files || []);
        } catch (err) {
            result = { ok: false, reason: err.message };
        }
        window.postMessage({ type: 'CLASSUL_SEND_PHOTOS_RESULT', ...result }, '*');
    });

    window.postMessage({ type: 'CLASSUL_INJECT_READY' }, '*');
})();
