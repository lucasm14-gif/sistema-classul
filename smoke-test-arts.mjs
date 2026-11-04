// Testa a leitura de conversa e o motor das artes, com a OpenAI "mockada" e banco em memória.
process.env.API_TOKEN = 'teste-token';

import { newDb } from 'pg-mem';

const ROOT = '/Users/lucasmac/Desktop/sistema classul';
const { _setPoolForTests, setSettings, ensureSchema } = await import(`file://${ROOT}/lib/db.js`);
const mem = newDb();
_setPoolForTests(new (mem.adapters.createPg()).Pool());
const { default: app } = await import(`file://${ROOT}/api/index.js`);
const { ART_TEMPLATES } = await import(`file://${ROOT}/lib/arts.js`);
const { TEMPLATES, SIZES, FONT_FAMILIES, buildScene, checkFields, missingFonts, toSvg } = await import(`file://${ROOT}/web/src/plates/engine.js`);

const check = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ' — ' + extra : ''}`);
  if (!cond) process.exitCode = 1;
};

const realFetch = globalThis.fetch;
let reply = {};
let lastPrompt = '';
globalThis.fetch = async (url, opts) => {
  if (String(url).includes('openai.com')) {
    lastPrompt = JSON.parse(opts.body).messages.map((m) => m.content).join('\n');
    return { ok: true, json: async () => ({ choices: [{ message: { content: typeof reply === 'string' ? reply : JSON.stringify(reply) } }] }) };
  }
  return realFetch(url, opts);
};

const server = app.listen(3131);
const post = (conversation, token = 'teste-token') => realFetch('http://localhost:3131/api/arts/extract', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
  body: JSON.stringify({ conversation })
});

await ensureSchema();
const CONV = '[CLIENTE]: Quero uma placa 14x20 para a Rosie\n[CLIENTE]: Seus ensinamentos transformaram vidas.\n[CLIENTE]: 08/12/2012 a 18/13/2025\n[CLIENTE]: Escola Marechal Luiz Osório';

check('exige login', (await post(CONV, 'errado')).status === 401);
let res = await post(CONV);
check('sem chave da OpenAI avisa', res.status === 400);
await setSettings({ openai_api_key: 'sk-teste' });
check('conversa vazia é recusada', (await post('   ')).status === 400);

reply = { nome: 'Rosie', titulo: null, mensagem: 'Seus ensinamentos transformaram vidas.', data: '08/12/2012 a 18/13/2025', quem_homenageia: 'Escola Marechal Luiz Osório', assinaturas: [], tamanho: '14x20', modelo: 'classica', duvidas: ['Mês 13 não existe.'] };
let data = await (await post(CONV)).json();
check('separa os campos', data.name === 'Rosie' && data.from.includes('Luiz') && data.size === '14x20');
check('repassa as dúvidas', data.doubts.includes('Mês 13 não existe.'));
check('prompt proíbe corrigir e inventar', /Não corrija/.test(lastPrompt) && /Nunca invente/.test(lastPrompt));
check('não duvida do que veio igual da conversa', data.doubts.length === 1);

reply = { nome: 'Rosane', mensagem: 'Texto que ninguém escreveu nesta conversa.', data: '01/01/2020', modelo: 'inexistente', tamanho: '50x50' };
data = await (await post(CONV)).json();
check('nome inventado vira dúvida', data.doubts.some((d) => d.includes('Rosane')));
check('data inventada vira dúvida', data.doubts.some((d) => d.includes('01/01/2020')));
check('mensagem inventada vira dúvida', data.doubts.some((d) => d.includes('mensagem')));
check('modelo e tamanho inválidos são ignorados', data.template === 'classica' && data.size === '');

reply = { nome: 'Rosie', mensagem: 'Obrigado por tudo.', mensagem_sugerida: true, modelo: 'carinho' };
data = await (await post(CONV)).json();
check('texto sugerido pela IA é sinalizado', data.suggestedBody && data.doubts.some((d) => d.includes('sugerida')));

reply = 'isso não é json';
check('resposta inválida vira erro sem derrubar', (await post(CONV)).status === 500);

// Motor
const measure = (text, css) => text.length * parseFloat(css.match(/([\d.]+)px/)[1]) * 0.5;
check('modelos da IA e do motor são os mesmos', Object.keys(ART_TEMPLATES).sort().join() === TEMPLATES.map((t) => t.id).sort().join());
const F = { name: 'Rosie <&> Silva', title: '30 anos', body: 'Seus ensinamentos transformaram vidas.\nCom gratidão.', line: '08/12/2012 a 18/12/2025', from: 'Escola Marechal', signatures: ['Ana - Diretora', 'Bia - Vice'] };
let allOk = true;
for (const t of TEMPLATES) for (const size of SIZES) {
  const scene = buildScene(t.id, F, size, measure);
  const svg = toSvg(scene);
  const texts = scene.ops.filter((o) => o.type === 'text');
  const outside = texts.some((o) => o.y < 0 || o.y > scene.H);
  if (!svg.startsWith('<svg') || !svg.includes('Rosie &lt;&amp;&gt; Silva') && !svg.includes('ROSIE &lt;&amp;&gt; SILVA') || outside || scene.overflow) { allOk = false; console.log('   falhou', t.id, size); }
}
check('todos os modelos e tamanhos geram arte dentro da placa', allOk);
const scene = buildScene('classica', F, '14x20', measure);
check('SVG de produção não leva o metal', !toSvg(scene, { production: true }).includes('linearGradient') && toSvg(scene).includes('linearGradient'));
check('SVG mantém o texto editável', toSvg(scene, { production: true }).includes('<text '));

check('modelos só usam fontes da lista', TEMPLATES.every((t) => t.fonts.every((f) => FONT_FAMILIES.includes(f))));
let fontsMatch = true;
for (const t of TEMPLATES) {
  const used = [...new Set(buildScene(t.id, { ...F, signatures: ['Ana'] }, '14x20', measure).ops.filter((o) => o.type === 'text').map((o) => o.font.family))].sort();
  if (used.join() !== [...t.fonts].sort().join()) { fontsMatch = false; console.log('   fontes divergem', t.id, used); }
}
check('fontes anunciadas são as usadas no desenho', fontsMatch);
const fakeMeasure = (text, css) => (/'Tem'/.test(css) ? 999 : text.length * (css.includes('monospace') ? 40 : 30));
check('fonte ausente é detectada', missingFonts(['Tem', 'Falta'], fakeMeasure).join() === 'Falta');

const LOGO = { src: 'data:image/png;base64,AAAA', w: 400, h: 200 };
let printOk = true;
for (const t of TEMPLATES) for (const size of SIZES) {
  const svg = toSvg(buildScene(t.id, { ...F, logo: LOGO, photo: LOGO }, size, measure), { production: true });
  const [h, w] = size.split('x').map(Number);
  const edge = svg.match(/id="limite-da-placa" x="0" y="0" width="(\d+)" height="(\d+)"/);
  const box = svg.match(/viewBox="0 0 (\d+) (\d+)"/);
  const ok = svg.includes(`width="${w * 10}mm" height="${h * 10}mm"`)
    && svg.includes('xmlns:xlink="http://www.w3.org/1999/xlink"')
    && svg.includes('xlink:href="data:image/png;base64,AAAA"')
    && !/<image href=/.test(svg)
    && edge && box && edge[1] === box[1] && edge[2] === box[2];
  if (!ok) { printOk = false; console.log('   falhou no Corel', t.id, size); }
}
check('SVG do Corel tem medida real, logo e limite em todos os modelos', printOk);
check('prévia na tela não leva o contorno do Corel', !toSvg(scene).includes('limite-da-placa'));
check('modelo com retrato também leva o logo', buildScene('retrato', { ...F, logo: LOGO, photo: LOGO }, '14x20', measure).ops.filter((o) => o.type === 'image').length === 2);

const long = buildScene('classica', { ...F, body: 'palavra '.repeat(400) }, '9x14', measure);
const has = (issues, re) => issues.some((i) => re.test(i.msg));
check('texto grande demais é apontado', has(checkFields({ ...F, body: 'palavra '.repeat(400) }, long), /não coube|pequena/));
check('data impossível é erro', checkFields({ ...F, line: '08/12/2012 a 18/13/2025' }).some((i) => i.level === 'erro' && /18\/13\/2025/.test(i.msg)));
check('31 de fevereiro é erro', has(checkFields({ ...F, line: '31/02/2025' }), /impossível/));
check('datas fora de ordem são aviso', has(checkFields({ ...F, line: '18/12/2025 a 08/12/2012' }), /fora de ordem/));
check('data certa não acusa nada', !has(checkFields(F), /Data|Datas/));
check('falta de nome é erro', checkFields({ ...F, name: ' ' }).some((i) => i.level === 'erro'));
check('modelo com retrato exige foto', has(checkFields(F, buildScene('retrato', F, '14x20', measure)), /foto/));

server.close();
