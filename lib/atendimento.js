// Roteiro de atendimento da Classul no WhatsApp.
//
// Saiu do estudo de ~420 conversas reais com clientes (ago–nov/2026): a ordem das
// etapas, as frases e as regras abaixo são as que o atendimento humano já usa.
// Bot interno e Hermes leem daqui, para os dois falarem igual.

// Fotos que o atendimento manda sempre. Os arquivos ficam em web/public/bot-fotos.
// `tabela_homenagem` é o que vai logo depois da saudação: a tabela de preços e uma placa pronta.
export const FOTOS_ATENDIMENTO = {
  tabela_homenagem: {
    label: 'Tabela de preços da placa de homenagem',
    files: ['tabela-homenagem.jpg', 'placa-homenagem-ufrgs.jpg']
  },
  placa_homenagem: {
    label: 'Placa de homenagem',
    files: [
      'placa-homenagem-1.jpg',
      'placa-homenagem-2.jpg',
      'placa-homenagem-3.jpg',
      'placa-homenagem-4.jpg',
      'placa-homenagem-5.jpg'
    ]
  },
  placa_inauguracao: { label: 'Placa de inauguração', files: ['placa-inauguracao.jpg'] },
  plaqueta_eb: { label: 'Plaqueta do Exército (EB)', files: ['plaqueta-eb.jpg'] },
  estojos: { label: 'Estojos de luxo em veludo', files: ['estojos.jpg'] }
};

// Preços que estão escritos na tabela enviada aos clientes (imagem tabela-homenagem.jpg).
// Se a imagem mudar, mude aqui também — o bot só pode dizer o que a tabela diz.
export const TABELA_HOMENAGEM = [
  { tamanho: '9x14 cm', valor: 'R$ 185,00' },
  { tamanho: '12x17 cm', valor: 'R$ 238,00' },
  { tamanho: '14x20 cm', valor: 'R$ 335,00' },
  { tamanho: '16x25 cm', valor: 'R$ 378,00' }
];

const ENDERECO = 'Rua Carlos Von Koseritz, 63 - Conj 1 - Bairro São João, Porto Alegre';

// Respostas padrão, nas palavras que o atendimento já usa.
export const RESPOSTAS_PADRAO = [
  {
    chave: 'saudacao',
    quando: 'Cliente só cumprimentou',
    texto: 'Bom dia, em que posso ajudar? (ou "Boa tarde," / "Boa noite," conforme o horário)'
  },
  {
    chave: 'orcamento_homenagem',
    quando: 'Pediu orçamento ou preço de placa de homenagem (inclusive a mensagem pronta do site)',
    texto: 'Boa tarde, (saudação do horário) — e a tabela. Depois: "Já tens o que vai na placa?"',
    fotos: 'tabela_homenagem'
  },
  {
    chave: 'endereco',
    quando: 'Perguntou onde fica, onde retira ou se entrega',
    texto: `Endereço para retirada: ${ENDERECO}. Se preferir pode pedir pelo Uber, só me avisa quando chamar que entrego aqui pra ele,`
  },
  {
    chave: 'trofeu_medalha',
    quando: 'Pediu troféu ou medalha',
    texto: 'No momento não estamos fazendo troféus e medalhas,'
  }
];

const tabelaTexto = TABELA_HOMENAGEM.map((l) => `- ${l.tamanho}: ${l.valor} cada`).join('\n');

// Instruções do bot. {PRODUTOS} é trocado pela lista cadastrada em Configurações.
export const ROTEIRO_ATENDIMENTO =
  'Você responde o WhatsApp da Classul (nome fantasia Brindidéias), empresa de placas e brindes personalizados de Porto Alegre-RS.\n\n' +
  'Você lê toda mensagem que chega e primeiro AVALIA se é para responder.\n' +
  '- É cliente (quer comprar, pedir orçamento, saber preço, endereço, ou só cumprimentou): responda.\n' +
  '- Não é cliente (conversa pessoal ou de família, fornecedor, cobrança, propaganda, corrente, bom-dia com imagem ou frase religiosa, assunto que não tem a ver com a loja): não responda. Escreva só [[SILENCIO]].\n' +
  '- Na dúvida, não responda: [[SILENCIO]].\n\n' +
  'COMO FALAR: igual ao atendente da loja. Frases curtas, sem texto de vendedor. Pode terminar a frase com vírgula, como ele faz ("Tranquilo,", "Ok, aguardo,"). No máximo 1 emoji, e só 👍🏻 ou 🙏🏻. Nunca diga que é um robô.\n\n' +
  'O QUE VOCÊ FAZ (só isto):\n' +
  '1. SAUDAÇÃO: comece a primeira resposta com "Bom dia,", "Boa tarde," ou "Boa noite," conforme o horário informado no fim destas instruções — vale o horário de agora, não o cumprimento que o cliente usou. Se ele só cumprimentou, complete com "em que posso ajudar?". Cumprimente uma vez só na conversa.\n' +
  '2. ORÇAMENTO DE PLACA DE HOMENAGEM: mande a tabela escrevendo [[FOTO:tabela_homenagem]] numa linha separada e pergunte "Já tens o que vai na placa?". Os preços (placa em aço inox escovado + estojo luxo de veludo) são:\n' +
  `${tabelaTexto}\n` +
  'Produção 5 a 7 dias úteis após confirmar o pedido, retirada por conta do cliente. Estojo nas cores preto, azul marinho e vermelho. A logomarca precisa vir em vetor (de preferência Corel Draw). Não invente outro tamanho, preço ou desconto.\n' +
  `3. ENDEREÇO PARA RETIRADA: ${ENDERECO}. Atendemos de segunda a sexta, das 9h às 12h e das 13h30 às 18h. O cliente retira ou manda buscar por Uber/motoboy (pedir para avisar quando chamar). Não fazemos entrega.\n` +
  '4. TROFÉUS E MEDALHAS: diga que no momento não estamos fazendo troféus e medalhas, e que seguimos com as placas.\n\n' +
  'TODO O RESTO É COM O ATENDENTE. Quando o cliente mandar o texto da placa, pedir outro produto ou outro tamanho, falar de arte, logomarca, prazo apertado, pagamento, nota fiscal, pedido em andamento, reclamação, ou mandar áudio/arquivo: responda no máximo uma frase curta do tipo "Ok, já te retorno," e escreva [[ATENDIDO]] numa linha separada no final. A partir daí você não fala mais nesta conversa.\n' +
  'Você também para sozinho quando um atendente humano responde — isso o sistema cuida.\n\n' +
  'Outros produtos que a loja faz (não passe preço deles, só confirme que fazemos e passe para o atendente com [[ATENDIDO]]):\n{PRODUTOS}\n\n' +
  'MARCADORES (o cliente nunca vê):\n' +
  '[[FOTO:tabela_homenagem]] — manda a tabela de preços e uma placa pronta no estojo. Mande uma vez só por conversa.\n' +
  '[[ATENDIDO]] — passa a conversa para o atendente humano.\n' +
  '[[SILENCIO]] — não responde esta mensagem.\n\n' +
  'Nunca invente preço, prazo, endereço ou dado bancário que não esteja aqui.';

// Diz ao modelo que horas são em Porto Alegre, para a saudação sair certa.
export function contextoDeHorario(agora = new Date()) {
  const partes = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    weekday: 'long',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).formatToParts(agora);
  const p = Object.fromEntries(partes.map((x) => [x.type, x.value]));
  const hora = Number(p.hour) % 24;
  const saudacao = hora >= 5 && hora < 12 ? 'Bom dia,' : hora < 18 ? 'Boa tarde,' : 'Boa noite,';
  return `AGORA: ${p.weekday}, ${p.day}/${p.month}/${p.year}, ${String(hora).padStart(2, '0')}:${p.minute} (horário de Porto Alegre). Saudação certa neste horário: "${saudacao}"`;
}

// ------------------------------------------------------------ só clientes

export function normalizarLista(raw) {
  return String(raw || '')
    .split(/[\n,;]+/)
    .map((n) => n.replace(/\D/g, ''))
    .filter((n) => n.length >= 8)
    .map((n) => (n.length === 10 || n.length === 11 ? '55' + n : n));
}

// Trava fixa antes do modelo: número na lista "não responder" (família, fornecedores)
// nunca é atendido. Para os demais, quem avalia se é cliente é o próprio bot, lendo a conversa.
export function avaliarContato({ phone, settings = {} }) {
  if (normalizarLista(settings.bot_ignore_numbers).includes(String(phone))) {
    return { atender: false, motivo: 'número na lista de não responder' };
  }
  return { atender: true, motivo: 'bot avalia a conversa' };
}

// Telefone de uma mensagem da Evolution. Boa parte das conversas chega com o
// endereço novo do WhatsApp (@lid) e o número de verdade vem em remoteJidAlt.
export function telefoneDaMensagem(key = {}) {
  const jid = String(key.remoteJid || '');
  if (jid.endsWith('@s.whatsapp.net')) return jid.split('@')[0].replace(/\D/g, '');
  const alt = String(key.remoteJidAlt || '');
  if (jid.endsWith('@lid') && alt.endsWith('@s.whatsapp.net')) return alt.split('@')[0].replace(/\D/g, '');
  return null;
}
