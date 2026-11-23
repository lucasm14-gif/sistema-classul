// Estudos do app Ideal: aulas de chinês (do zero) e de ENEM 2027.
//
// Todo o conteúdo é escrito pelo Hermes (VPS do Lucas, assinatura da OpenAI dele),
// para não gastar a chave paga. O iPhone pede pela chave do Ideal; a aula e as
// questões são duas chamadas separadas para cada uma caber no tempo da função.
// O Hermes só responde texto de forma síncrona — uma aula inteira levou ~50 s,
// separadas levam ~20 s (teoria) e ~30 s (questões).
import { hermesFetch, parseJsonLoose, QuoteError } from './quotes.js';

const TIMEOUT_MS = 55000; // a função tem maxDuration 60 s (vercel.json)

export class StudyError extends QuoteError {}

const clean = (v, max = 200) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const text = (v, max = 4000) => String(v ?? '').trim().slice(0, max);
// O modelo costuma numerar títulos e enunciados ("1. …"); o app já numera.
const unnumber = (v) => String(v ?? '').replace(/^\s*(?:\d{1,2}|[A-Ea-e])\s*[.)\-–:]\s+/, '');
const list = (v, max) => (Array.isArray(v) ? v.slice(0, max) : []);

const ALUNO = {
  chines:
    'Aluno brasileiro aprendendo chinês mandarim do zero (nível HSK 1), estudando 30 minutos por dia de manhã. ' +
    'Escreva sempre caracteres simplificados com pinyin com marcas de tom (ex.: nǐ hǎo) e tradução em português.',
  enem:
    'Aluno brasileiro que terminou o ensino médio há 4 anos e está retomando tudo do começo para o ENEM 2027. ' +
    'Explique como para quem esqueceu a base, com linguagem simples, exemplos do cotidiano e foco no que mais cai no ENEM. ' +
    'Não use LaTeX nem tabelas: escreva contas com símbolos simples (×, ÷, ², √, %, frações como 3/4).'
};

function header({ track, area, topic, anteriores }) {
  const linhas = [
    'Você é professor particular. Responda SOMENTE com um objeto JSON válido, sem texto fora dele e sem ```.',
    ALUNO[track],
    `Matéria: ${track === 'chines' ? 'Chinês' : area || 'ENEM'}. Tema da aula: "${topic}".`
  ];
  if (anteriores.length) linhas.push(`Temas que ele já estudou (pode usar o vocabulário deles): ${anteriores.join('; ')}.`);
  return linhas.join('\n');
}

function promptAula(ctx) {
  const vocab =
    ctx.track === 'chines'
      ? '"vocab":[{"hanzi":"","pinyin":"","pt":""}],'
      : '';
  const regras =
    ctx.track === 'chines'
      ? 'Use 3 a 4 seções curtas e 5 a 8 palavras novas no vocab (as mais úteis do tema).'
      : 'Use 3 a 4 seções curtas, com pelo menos um exemplo resolvido passo a passo. Em "dicas", 2 a 3 pegadinhas ou atalhos do ENEM.';
  return [
    header(ctx),
    `Formato: {"titulo":"","resumo":"uma frase","secoes":[{"titulo":"","texto":"explicação em português; pode usar **negrito** e listas com - "}],${vocab}"dicas":[""]}`,
    regras
  ].join('\n');
}

function promptQuestoes(ctx) {
  const n = ctx.track === 'chines' ? 4 : 3;
  const alt = ctx.track === 'chines' ? 4 : 5;
  const estilo =
    ctx.track === 'chines'
      ? 'Questões de fixação: significado, pinyin e tom, e completar frases curtas.'
      : 'Questões no estilo do ENEM: texto-base curto com contexto do cotidiano, comando claro.';
  const linhas = [
    header(ctx),
    `Formato: {"questoes":[{"enunciado":"","alternativas":[${Array(alt).fill('""').join(',')}],"correta":0,"explicacao":"por que a certa está certa"}]}`,
    `Escreva ${n} questões com ${alt} alternativas cada, da mais fácil para a mais difícil. ${estilo} "correta" é o índice (começa em 0) da alternativa certa; varie a posição.`
  ];
  if (ctx.evitar.length) linhas.push(`Não repita estas questões que ele já fez: ${ctx.evitar.join(' | ')}`);
  return linhas.join('\n');
}

function promptPergunta(ctx, { pergunta, resumo, historico }) {
  const linhas = [
    'Você é professor particular. Responda em português, direto e didático, em no máximo 3 parágrafos curtos (pode usar listas com - e **negrito**). Responda só em texto.',
    ALUNO[ctx.track],
    `Ele está na aula "${ctx.topic}"${ctx.area ? ` (${ctx.area})` : ''}.${resumo ? ` Resumo da aula: ${resumo}` : ''}`
  ];
  if (historico.length) {
    linhas.push('Conversa até aqui:');
    for (const h of historico) linhas.push(`ALUNO: ${h.p}\nPROFESSOR: ${h.r}`);
  }
  linhas.push(`Pergunta do aluno: ${pergunta}`);
  return linhas.join('\n');
}

function normAula(raw, track) {
  const secoes = list(raw.secoes, 6)
    .map((s) => ({ titulo: clean(unnumber(s?.titulo), 120), texto: text(s?.texto, 3000) }))
    .filter((s) => s.texto);
  if (!secoes.length) throw new StudyError('O Hermes devolveu uma aula vazia. Tente de novo.', 502);
  return {
    titulo: clean(raw.titulo, 140),
    resumo: clean(raw.resumo, 400),
    secoes,
    vocab:
      track === 'chines'
        ? list(raw.vocab, 12)
            .map((v) => ({ hanzi: clean(v?.hanzi, 20), pinyin: clean(v?.pinyin, 60), pt: clean(v?.pt, 120) }))
            .filter((v) => v.hanzi && v.pt)
        : [],
    dicas: list(raw.dicas, 5).map((d) => clean(d, 400)).filter(Boolean)
  };
}

function normQuestoes(raw) {
  const questoes = list(raw.questoes, 6)
    .map((q) => {
      const alternativas = list(q?.alternativas, 5).map((a) => clean(String(a ?? '').replace(/^\s*[A-Ea-e]\s*[.)]\s+/, ''), 500)).filter(Boolean);
      const correta = Number(q?.correta);
      return { enunciado: text(unnumber(q?.enunciado), 2500), alternativas, correta, explicacao: text(q?.explicacao, 1500) };
    })
    .filter((q) => q.enunciado && q.alternativas.length >= 2 && Number.isInteger(q.correta) && q.correta >= 0 && q.correta < q.alternativas.length);
  if (!questoes.length) throw new StudyError('O Hermes não devolveu questões válidas. Tente de novo.', 502);
  return { questoes };
}

async function ask(texto) {
  const data = await hermesFetch('', { method: 'POST', body: JSON.stringify({ texto, modo: 'texto' }) }, TIMEOUT_MS);
  if (!data.texto) {
    throw new StudyError(data.tarefa ? 'O Hermes entendeu o pedido como imagem. Escreva de outro jeito.' : 'O Hermes não respondeu nada.', 502);
  }
  return String(data.texto);
}

// Corpo: { tipo: 'aula'|'questoes'|'pergunta', trilha: 'chines'|'enem', area, tema,
//          anteriores[], evitar[], pergunta, resumo, historico[{p,r}] }
export async function study(body = {}) {
  const tipo = body.tipo;
  const track = body.trilha;
  if (!['chines', 'enem'].includes(track)) throw new StudyError('Trilha inválida.');
  const ctx = {
    track,
    area: clean(body.area, 60),
    topic: clean(body.tema, 160),
    anteriores: list(body.anteriores, 40).map((t) => clean(t, 80)).filter(Boolean),
    evitar: list(body.evitar, 12).map((t) => clean(t, 100)).filter(Boolean)
  };
  if (!ctx.topic) throw new StudyError('Falta o tema.');

  if (tipo === 'aula') return normAula(parseJsonLoose(await ask(promptAula(ctx))), track);
  if (tipo === 'questoes') return normQuestoes(parseJsonLoose(await ask(promptQuestoes(ctx))));
  if (tipo === 'pergunta') {
    const pergunta = text(body.pergunta, 1200);
    if (!pergunta) throw new StudyError('Escreva a pergunta.');
    const historico = list(body.historico, 4).map((h) => ({ p: text(h?.p, 600), r: text(h?.r, 1200) })).filter((h) => h.p && h.r);
    const resposta = text(await ask(promptPergunta(ctx, { pergunta, resumo: clean(body.resumo, 400), historico })), 6000);
    return { resposta };
  }
  throw new StudyError('Tipo de pedido inválido.');
}
