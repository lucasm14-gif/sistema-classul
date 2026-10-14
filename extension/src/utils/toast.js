// Aviso rápido no rodapé da tela (usado pelos botões e pelo painel).
let current = null;
export function toast(text, tone = '') {
    current?.remove();
    const t = document.createElement('div');
    t.className = 'clp-toast' + (tone ? ' ' + tone : '');
    t.textContent = text;
    document.body.appendChild(t);
    current = t;
    setTimeout(() => {
        t.style.transition = 'opacity .25s';
        t.style.opacity = '0';
        setTimeout(() => t.remove(), 260);
    }, 2800);
}

// A extensão foi recarregada/atualizada, mas esta aba ainda roda o script antigo:
// o Chrome corta a ligação ("Extension context invalidated") e nada funciona
// até recarregar a página. Avisa uma vez, de forma clara, com o botão de F5.
export function extensionAlive() {
    try {
        return Boolean(chrome.runtime?.id);
    } catch {
        return false;
    }
}

export function showReloadBanner() {
    if (document.getElementById('classul-reload')) return;
    const b = document.createElement('div');
    b.id = 'classul-reload';
    b.className = 'clp-toast';
    b.style.cssText = 'bottom:auto;top:16px;padding:12px 14px 12px 18px;gap:12px;';
    b.innerHTML =
        '<span>A extensão Classul foi atualizada. Recarregue o WhatsApp para usar a versão nova.</span>' +
        '<button style="border:0;border-radius:8px;padding:7px 12px;background:#62bb46;color:#fff;font-weight:700;cursor:pointer">Recarregar</button>';
    b.querySelector('button').onclick = () => location.reload();
    document.body.appendChild(b);
}
