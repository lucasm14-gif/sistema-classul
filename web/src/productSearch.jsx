import React, { useEffect, useState } from 'react';

// Busca de produtos usada nas Notas fiscais e no Orçamento.
// ------------------------------------------------------------------ busca inteligente

// Normaliza para comparar: sem acento, minúsculo e "12 x 17" vira "12x17".
export const norm = (s) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/(\d+(?:[.,]\d+)?)\s*[x×*]\s*(\d+(?:[.,]\d+)?)/g, '$1x$2')
    .replace(/c\/\s*/g, 'com ');

// Como as pessoas falam × como está escrito no cadastro do C&K.
export const SINONIMOS = {
  homenagem: ['placa'], inauguracao: ['placa'], jazigo: ['placa'], placa: ['placa', 'plaqueta'], plaqueta: ['placa', 'cracha'],
  inox: ['inox', 'aco'], aco: ['aco', 'inox'], metal: ['aco', 'metal', 'latao'], dourada: ['latao', 'dour'], latao: ['latao'],
  pin: ['pin', 'boton'], pins: ['pin', 'boton'], boton: ['boton', 'pin'], botom: ['boton'], botton: ['boton'], broche: ['boton', 'pin', 'broche'],
  estojo: ['estojo', 'est'], caixa: ['estojo'], veludo: ['vel'], com: ['com'], trofeu: ['trofeu'], medalha: ['medalha'],
  cracha: ['cracha'], acrilico: ['acril'], quadro: ['moldura', 'quadro'], moldura: ['moldura'], ima: ['magneto', 'ima'], tapete: ['tapete', 'capacho']
};

export function pontuar(produto, tokens) {
  const palavras = norm(`${produto.codigo || ''} ${produto.descricao}`).split(/[^a-z0-9.,/]+/).filter(Boolean);
  let total = 0;
  for (const t of tokens) {
    const alvos = [t, ...(SINONIMOS[t] || [])];
    let melhor = 0;
    for (const w of palavras) {
      for (const a of alvos) {
        if (w === a) melhor = Math.max(melhor, a === t ? 6 : 4);
        else if (w.startsWith(a)) melhor = Math.max(melhor, a === t ? 4 : 3);
        else if (w.length >= 3 && a.startsWith(w)) melhor = Math.max(melhor, 3);
        else if (a.length >= 3 && w.includes(a)) melhor = Math.max(melhor, 2);
      }
    }
    if (!melhor) return 0; // todo termo digitado precisa aparecer
    total += melhor;
  }
  return total + Math.log2((produto.uso || 0) + 1);
}

export function buscarProdutos(produtos, texto, limite = 8) {
  const tokens = norm(texto).split(/[^a-z0-9.,/]+/).filter((t) => t && t !== 'de' && t !== 'tam' && t !== 'cm');
  // Sempre em ordem alfabética; digitar só filtra.
  const alfa = (a, b) => String(a.descricao).localeCompare(String(b.descricao), 'pt-BR', { sensitivity: 'base' });
  if (!tokens.length) return [...produtos].sort(alfa).slice(0, limite);
  return produtos.filter((p) => pontuar(p, tokens) > 0).sort(alfa).slice(0, limite);
}

// Lista com setas ↑ ↓, Enter escolhe e Esc fecha.
export function useNavegacao(itens, onEscolher) {
  const [ativo, setAtivo] = useState(0);
  useEffect(() => setAtivo(0), [itens.length]);
  const onKeyDown = (e) => {
    if (!itens.length) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setAtivo((a) => (a + 1) % itens.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setAtivo((a) => (a - 1 + itens.length) % itens.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      onEscolher(itens[Math.min(ativo, itens.length - 1)]);
    }
  };
  return { ativo, setAtivo, onKeyDown };
}

// Destaca no texto os termos digitados (comparação sem acento e sem maiúscula).
export const simples = (s) => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
export function Realce({ texto, termos }) {
  const t = simples(termos).split(/[\s,]+/).filter((x) => x.length >= 2);
  const base = simples(texto);
  if (!t.length || base.length !== texto.length) return texto;
  const marcas = new Array(texto.length).fill(false);
  for (const termo of t) {
    let i = base.indexOf(termo);
    while (i >= 0) {
      for (let k = i; k < i + termo.length; k++) marcas[k] = true;
      i = base.indexOf(termo, i + termo.length);
    }
  }
  const partes = [];
  let atual = '';
  let marcado = marcas[0];
  [...texto].forEach((ch, i) => {
    if (marcas[i] !== marcado) {
      partes.push([atual, marcado]);
      atual = '';
      marcado = marcas[i];
    }
    atual += ch;
  });
  partes.push([atual, marcado]);
  return partes.map(([p, m], i) => (m ? <span key={i} className="text-brand-600 underline decoration-2 underline-offset-2">{p}</span> : <span key={i}>{p}</span>));
}

