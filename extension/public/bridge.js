// Ponte entre o sistema Classul (site) e a extensão.
// O site faz window.postMessage({type:'CLASSUL_OPEN_CHAT', phone}) e a extensão
// abre a conversa na aba do WhatsApp Web que já está aberta.
window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  if (!event.data || event.data.type !== 'CLASSUL_OPEN_CHAT') return;
  try {
    chrome.runtime.sendMessage(
      { action: 'openWhatsAppChat', phone: event.data.phone },
      (response) => {
        if (chrome.runtime.lastError) return; // sem ACK → o site usa o fallback
        window.postMessage(
          { type: 'CLASSUL_OPEN_CHAT_ACK', ok: Boolean(response && response.success), mode: response && response.mode },
          '*'
        );
      }
    );
  } catch (e) {
    // extensão recarregada/indisponível: sem ACK, o site abre o wa.me normal
  }
});
