// Abre uma conversa de WhatsApp. Se a extensão da Classul estiver instalada,
// ela foca a aba do WhatsApp Web já aberta e abre a conversa lá dentro;
// sem extensão, cai no wa.me em nova aba (comportamento padrão).
export function openWhatsApp(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return;

  let handled = false;
  const onAck = (event) => {
    if (event.source !== window) return;
    if (event.data?.type !== 'CLASSUL_OPEN_CHAT_ACK') return;
    handled = true;
    window.removeEventListener('message', onAck);
  };
  window.addEventListener('message', onAck);
  window.postMessage({ type: 'CLASSUL_OPEN_CHAT', phone: digits }, '*');

  setTimeout(() => {
    window.removeEventListener('message', onAck);
    if (!handled) window.open(`https://wa.me/${digits}`, '_blank', 'noopener');
  }, 450);
}
