// Limpeza dos dados de cadastro que vieram tortos do C&K (e que a pessoa digita às pressas):
// e-mail sem ponto ("classulrs@gmailcom") e inscrição estadual de mentira ("0", "9").

const DOMINIOS = {
  gmailcom: 'gmail.com', gmailcm: 'gmail.com', gmailcombr: 'gmail.com', gmailco: 'gmail.com', gmai: 'gmail.com',
  'gmail.combr': 'gmail.com', 'gmail.co': 'gmail.com', 'gmail.cm': 'gmail.com', 'gmial.com': 'gmail.com', 'gamil.com': 'gmail.com',
  hotmailcom: 'hotmail.com', hotmailcombr: 'hotmail.com.br', 'hotmail.combr': 'hotmail.com.br', 'hotmail.co': 'hotmail.com',
  yahoocom: 'yahoo.com', yahoocombr: 'yahoo.com.br', 'yahoo.combr': 'yahoo.com.br',
  outlookcom: 'outlook.com', outlookcombr: 'outlook.com.br', livecom: 'live.com', terracombr: 'terra.com.br',
  uolcombr: 'uol.com.br', bolcombr: 'bol.com.br', icloudcom: 'icloud.com'
};

export const emailValido = (e) => /^[^\s@;,]+@[^\s@;,]+\.[a-z]{2,}(\.[a-z]{2,})?$/i.test(String(e || ''));

// Devolve o e-mail corrigido, ou '' quando não dá para aproveitar (nunca bloqueia o cadastro).
export function corrigirEmail(valor) {
  const candidatos = String(valor || '')
    .toLowerCase()
    .split(/[;,\s/]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  for (let bruto of candidatos) {
    // "classulrsgmailcom" (sem @): só dá para recuperar o e-mail da própria Classul.
    if (!bruto.includes('@') && /^clas+ul(rs)?(gmail|hotmail)/.test(bruto)) bruto = 'classulrs@gmail.com';
    if (/@(gmail|hotmail|yahoo|outlook)$/.test(bruto)) bruto += '.com';
    const m = bruto.match(/^([^@]+)@(.+)$/);
    if (!m) continue;
    let [, usuario, dominio] = m;
    dominio = dominio.replace(/\.+$/, '').replace(/\.{2,}/g, '.');
    if (DOMINIOS[dominio]) dominio = DOMINIOS[dominio];
    // "empresacombr" → "empresa.com.br"; "empresacom" → "empresa.com"
    else if (!dominio.includes('.')) dominio = dominio.replace(/combr$/, '.com.br').replace(/(?<!\.)com$/, '.com').replace(/netbr$/, '.net.br').replace(/orgbr$/, '.org.br');
    else dominio = dominio.replace(/\.combr$/, '.com.br');
    // Variações do e-mail da própria Classul (o C&K tinha "clasulrs", "classsulrs", "classul@...").
    if (/^clas+u?l?r?s?$/.test(usuario) && usuario.length >= 6 && /^(gma|gmi|hotm|hota)/.test(dominio)) {
      usuario = 'classulrs';
      dominio = 'gmail.com';
    }
    const email = `${usuario}@${dominio}`;
    if (emailValido(email) && email.length <= 60) return email;
  }
  return '';
}

// IE "0", "9", "000…" ou curta demais não é inscrição: o C&K usava como "não tem".
export function ieDeVerdade(ie) {
  const d = String(ie || '').replace(/\D/g, '');
  if (d.length < 8 || /^0+$/.test(d) || /^9+$/.test(d)) return '';
  return d;
}

// IE do RS: 10 dígitos, o último é o dígito verificador (módulo 11).
export function ieRsValida(ie) {
  const d = String(ie || '').replace(/\D/g, '');
  if (d.length !== 10) return false;
  const pesos = [2, 9, 8, 7, 6, 5, 4, 3, 2];
  const soma = pesos.reduce((s, p, i) => s + p * Number(d[i]), 0);
  const dv = 11 - (soma % 11);
  return (dv >= 10 ? 0 : dv) === Number(d[9]);
}
