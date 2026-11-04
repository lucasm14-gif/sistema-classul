// Leitura de conversa para a montagem de arte de placa.
//
// A IA não desenha nada: só separa os textos que o cliente mandou e sugere um
// modelo. Quem confere e envia a arte é o atendente, na aba Artes.

import { getSettings } from './db.js';

export const ART_TEMPLATES = {
  classica: 'homenagem pessoal, aposentadoria, tempo de casa, escolas; é o padrão quando não houver motivo para outro',
  filete: 'homenagem sóbria e formal, tom sério',
  ornamento: 'homenagem tradicional, religiosa ou a instituições antigas',
  institucional: 'entidades, sindicatos e associações, quando houver logotipo em destaque',
  corporativa: 'empresa homenageando empresa, aniversário de empresa, parceria comercial',
  retrato: 'somente se o cliente quiser foto ou retrato da pessoa gravado na placa',
  certificado: 'certificado, menção honrosa, com assinaturas de diretores ou responsáveis',
  carinho: 'mensagem longa e afetuosa, despedida entre colegas'
};
const SIZES = ['9x14', '12x17', '14x20', '16x25', '20x30'];
const MAX_INPUT = 12000;

function buildPrompt() {
  const modelos = Object.entries(ART_TEMPLATES).map(([id, uso]) => `- ${id}: ${uso}`).join('\n');
  return (
    'Você separa os textos de uma placa de homenagem a partir de uma conversa de WhatsApp da Classul, ' +
    'fábrica de placas de Porto Alegre-RS. A placa será gravada em aço: um erro não pode ser desfeito. Responda APENAS com JSON.\n\n' +
    'REGRAS:\n' +
    '- Copie nomes, datas e textos EXATAMENTE como o cliente escreveu. Não corrija, não melhore, não complete.\n' +
    '- Nunca invente. O que não estiver na conversa fica null.\n' +
    '- Só crie texto de mensagem se o cliente pedir uma sugestão; nesse caso marque "mensagem_sugerida": true.\n' +
    '- Se algo parecer errado (grafia estranha, data impossível, duas versões do mesmo nome), NÃO conserte: ' +
    'explique em "duvidas" para o atendente perguntar ao cliente.\n' +
    '- Use a versão mais recente quando o cliente corrigir algo durante a conversa.\n' +
    '- Quebras de linha que o cliente usou na mensagem podem ser mantidas com \\n.\n\n' +
    'MODELOS:\n' + modelos + '\n\n' +
    'CAMPOS:\n{\n' +
    '  "nome": quem recebe a homenagem,\n' +
    '  "titulo": chamada curta (ex: "30 anos de dedicação"), ou null,\n' +
    '  "mensagem": corpo do texto da placa,\n' +
    '  "data": data gravada na placa, como o cliente escreveu, ou null,\n' +
    '  "quem_homenageia": empresa ou pessoas que oferecem a placa, ou null,\n' +
    '  "assinaturas": lista de quem assina (["Nome - Cargo"]), ou [],\n' +
    '  "tamanho": um de ' + SIZES.join(', ') + ' se o cliente citou, senão null,\n' +
    '  "modelo": o id do modelo mais adequado,\n' +
    '  "precisa_logo": true se o cliente quer logotipo na placa,\n' +
    '  "precisa_foto": true se o cliente quer foto gravada,\n' +
    '  "mensagem_sugerida": true somente se o texto da mensagem foi escrito por você,\n' +
    '  "duvidas": lista de frases curtas com o que conferir com o cliente\n}'
  );
}

const clean = (v, max = 400) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : '');
const norm = (s) => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').toLowerCase();

export async function extractArtData(conversation) {
  const text = String(conversation || '').trim();
  if (!text) { const e = new Error('Cole a conversa ou os dados da placa.'); e.status = 400; throw e; }
  const settings = await getSettings();
  if (!settings.openai_api_key) { const e = new Error('Configure a chave da OpenAI em Configurações.'); e.status = 400; throw e; }

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${settings.openai_api_key}` },
    body: JSON.stringify({
      model: settings.openai_model || 'gpt-4o-mini',
      temperature: 0.1,
      response_format: { type: 'json_object' },
      max_tokens: 900,
      messages: [
        { role: 'system', content: buildPrompt() },
        { role: 'user', content: text.slice(0, MAX_INPUT) }
      ]
    })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error?.message || `OpenAI respondeu ${res.status}`);

  let parsed;
  try {
    parsed = JSON.parse(data.choices?.[0]?.message?.content || '');
  } catch {
    throw new Error('A IA devolveu uma resposta inválida. Tente de novo.');
  }

  const result = {
    name: clean(parsed.nome, 80),
    title: clean(parsed.titulo, 120),
    body: clean(parsed.mensagem, 900),
    line: clean(parsed.data, 60),
    from: clean(parsed.quem_homenageia, 160),
    signatures: Array.isArray(parsed.assinaturas) ? parsed.assinaturas.map((s) => clean(s, 80)).filter(Boolean).slice(0, 3) : [],
    size: SIZES.includes(parsed.tamanho) ? parsed.tamanho : '',
    template: ART_TEMPLATES[parsed.modelo] ? parsed.modelo : 'classica',
    needsLogo: parsed.precisa_logo === true,
    needsPhoto: parsed.precisa_foto === true,
    suggestedBody: parsed.mensagem_sugerida === true
  };

  // A IA não pode ter inventado nome ou data: o que não está na conversa vira dúvida.
  const doubts = Array.isArray(parsed.duvidas) ? parsed.duvidas.map((d) => clean(d, 240)).filter(Boolean).slice(0, 8) : [];
  const source = norm(text);
  if (result.name && !source.includes(norm(result.name))) doubts.unshift(`O nome "${result.name}" não aparece igual na conversa: confira.`);
  if (result.line && !source.includes(norm(result.line))) doubts.unshift(`A data "${result.line}" não aparece igual na conversa: confira.`);
  if (result.body && !result.suggestedBody && !source.includes(norm(result.body).slice(0, 40))) {
    doubts.unshift('A mensagem não é cópia exata do que o cliente escreveu: confira.');
  }
  if (result.suggestedBody) doubts.unshift('A mensagem foi sugerida pela IA: o cliente precisa aprovar o texto.');
  result.doubts = doubts;
  return result;
}
