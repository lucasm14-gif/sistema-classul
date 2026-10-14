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
