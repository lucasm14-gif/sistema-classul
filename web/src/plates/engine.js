// Motor das artes de placa: cada modelo vira uma lista de operações vetoriais
// (cena), desenhada igual em SVG (tela e CorelDRAW) e em canvas (PNG para o WhatsApp).
// Não depende do navegador: quem chama informa como medir o texto.

export const W = 2000;
export const SIZES = ['9x14', '12x17', '14x20', '16x25', '20x30'];
export const INK = '#17171a';

const METAL_STOPS = [
  [0, '#c3c3c6'], [0.06, '#d6d7d6'], [0.17, '#f5f6f3'], [0.23, '#ffffff'], [0.3, '#e7e9e5'], [0.4, '#d3d5d2'], [0.5, '#c9c8ca'],
  [0.58, '#b9b6ba'], [0.66, '#d8dad7'], [0.76, '#ffffff'], [0.84, '#dfe1dd'], [0.91, '#bfc2be'], [0.96, '#8a8f8b'], [1, '#676c68']
];

export function plateHeight(size) {
  const [h, w] = String(size).split('x').map(Number);
  return Math.round((W * h) / w);
}

// O tamanho é "altura x largura" em cm, como em plateHeight.
export function plateMm(size) {
  const [h, w] = String(size).split('x').map(Number);
  return { w: w * 10, h: h * 10 };
}

export function fontCss(f, size) {
  return `${f.style === 'italic' ? 'italic ' : ''}${f.weight || 400} ${size}px '${f.family}'`;
}

export function wrapText(text, maxW, measure, font, size, spacing = 0) {
  const css = fontCss(font, size);
  const width = (t) => measure(t, css) + spacing * t.length;
  const out = [];
  String(text).split('\n').forEach((par) => {
    let line = '';
    par.split(/\s+/).filter(Boolean).forEach((word) => {
      const next = line ? `${line} ${word}` : word;
      if (width(next) > maxW && line) { out.push(line); line = word; } else line = next;
    });
    out.push(line);
  });
  return out;
}

// Empilha os textos dentro de uma caixa, centralizados na vertical, e reduz tudo
// junto até caber. `fit` abaixo de 0,55 vira aviso: a letra ficaria pequena demais.
function stack({ x, y, w, h, align = 'center', items, measure }) {
  const list = items.filter((i) => i.text && String(i.text).trim());
  const build = (k) => {
    let total = 0;
    const rows = list.map((it, idx) => {
      let size = it.size * k;
      const spacing = (it.spacing || 0) * size;
      if (it.oneLine) {
        const css = fontCss(it.font, size);
        const tw = measure(it.text, css) + spacing * it.text.length;
        if (tw > w) size = (size * w) / tw;
      }
      const text = it.upper ? String(it.text).toLocaleUpperCase('pt-BR') : it.text;
      const lines = it.oneLine ? [text] : wrapText(text, w, measure, it.font, size, spacing);
      const lh = size * (it.leading || 1.2);
      const gap = idx === 0 ? 0 : (it.gap || 0) * k;
      total += gap + lines.length * lh;
      return { it, size, spacing, lines, lh, gap };
    });
    return { rows, total };
  };
  let k = 1;
  let layout = build(k);
  while (layout.total > h && k > 0.3) { k -= 0.02; layout = build(k); }
  let cy = y + Math.max(0, (h - layout.total) / 2);
  const ax = align === 'center' ? x + w / 2 : align === 'end' ? x + w : x;
  const ops = [];
  layout.rows.forEach((r) => {
    cy += r.gap;
    r.lines.forEach((line) => {
      ops.push({ type: 'text', x: ax, y: cy + r.size * 0.94, text: line, font: r.it.font, size: r.size, spacing: r.spacing, anchor: align, fill: r.it.fill || INK });
      cy += r.lh;
    });
  });
  return { ops, fit: k, overflow: layout.total > h + 1, bottom: cy };
}

function imageBox(asset, x, y, w, h, opts = {}) {
  const scale = Math.min(w / asset.w, h / asset.h);
  const iw = asset.w * scale;
  const ih = asset.h * scale;
  const ix = opts.align === 'start' ? x : opts.align === 'end' ? x + w - iw : x + (w - iw) / 2;
  return { type: 'image', asset, x: ix, y: y + (h - ih) / 2, w: iw, h: ih, gray: opts.gray };
}

const stroke = (d, width, extra = {}) => ({ type: 'path', d, stroke: INK, width, ...extra });
const fill = (d, extra = {}) => ({ type: 'path', d, fill: INK, ...extra });

// ---- Molduras ----
function frameScoop(H) {
  const m = 83, t = 71, r = 83, B = H - 71, sag = 68, x1 = 344, x2 = W - 344;
  return [
    stroke(`M${m + r} ${t}Q${W / 2} ${t + sag} ${W - m - r} ${t}A${r} ${r} 0 0 0 ${W - m} ${t + r}L${W - m} ${B - r}A${r} ${r} 0 0 0 ${W - m - r} ${B}Q${W / 2} ${B - sag} ${m + r} ${B}A${r} ${r} 0 0 0 ${m} ${B - r}L${m} ${t + r}A${r} ${r} 0 0 0 ${m + r} ${t}Z`, 10),
    fill(`M${x1} 68L${x2} 68Q${W / 2} 106 ${x1} 68Z`),
    fill(`M${x1} ${H - 68}L${x2} ${H - 68}Q${W / 2} ${H - 106} ${x1} ${H - 68}Z`)
  ];
}

function frameDouble(H) {
  const q = 30;
  const rect = (x, y, w, h) => `M${x} ${y}H${x + w}V${y + h}H${x}Z`;
  return [
    stroke(rect(84, 84, W - 168, H - 168), 9),
    stroke(rect(110, 110, W - 220, H - 220), 3),
    ...[[84, 84], [W - 84, 84], [84, H - 84], [W - 84, H - 84]].map(([x, y]) => fill(rect(x - q / 2, y - q / 2, q, q)))
  ];
}

function frameFlourish(H) {
  const m = 96;
  const corner = 'M0 150C0 62 62 0 150 0M0 150C0 212 72 226 96 176C116 134 62 100 42 136M150 0C212 0 226 72 176 96C134 116 100 62 136 42M34 34C72 12 118 62 82 92C58 112 24 80 48 58';
  const place = (sx, sy, tx, ty) => stroke(corner, 6, { transform: [sx, sy, tx, ty] });
  return [
    stroke(`M${m + 190} ${m + 12}H${W - m - 190}M${m + 190} ${H - m - 12}H${W - m - 190}M${m + 12} ${m + 190}V${H - m - 190}M${W - m - 12} ${m + 190}V${H - m - 190}`, 5),
    place(1, 1, m, m), place(-1, 1, W - m, m), place(1, -1, m, H - m), place(-1, -1, W - m, H - m)
  ];
}

function frameThin(H) {
  const r = 36, m = 90;
  return [stroke(`M${m + r} ${m}H${W - m - r}A${r} ${r} 0 0 1 ${W - m} ${m + r}V${H - m - r}A${r} ${r} 0 0 1 ${W - m - r} ${H - m}H${m + r}A${r} ${r} 0 0 1 ${m} ${H - m - r}V${m + r}A${r} ${r} 0 0 1 ${m + r} ${m}Z`, 5)];
}

function frameSweep(H) {
  return [stroke(`M90 ${H * 0.28}C150 ${H * 0.72} 230 ${H * 0.8} 420 ${H * 0.8}H${W - 90}`, 5)];
}

// ---- Fontes ----
const F = {
  pinyon: { family: 'Pinyon Script' },
  vibes: { family: 'Great Vibes' },
  dancing: { family: 'Dancing Script', weight: 600 },
  carlito: { family: 'Carlito' },
  carlitoB: { family: 'Carlito', weight: 700 },
  carlitoI: { family: 'Carlito', style: 'italic' },
  corm: { family: 'Cormorant Garamond', weight: 500 },
  cormB: { family: 'Cormorant Garamond', weight: 700 },
  cormI: { family: 'Cormorant Garamond', weight: 500, style: 'italic' },
  eb: { family: 'EB Garamond' },
  ebI: { family: 'EB Garamond', style: 'italic' },
  mont: { family: 'Montserrat', weight: 500 },
  montB: { family: 'Montserrat', weight: 700 },
  man: { family: 'Manrope', weight: 500 },
  manX: { family: 'Manrope', weight: 800 }
};

export const FONT_FAMILIES = [...new Set(Object.values(F).map((f) => f.family))];
export const FONTS_URL =
  'https://fonts.googleapis.com/css2?family=Carlito:ital,wght@0,400;0,700;1,400&family=Cormorant+Garamond:ital,wght@0,500;0,700;1,500&family=Dancing+Script:wght@600&family=EB+Garamond:ital,wght@0,400;1,400&family=Great+Vibes&family=Manrope:wght@500;800&family=Montserrat:wght@500;700&family=Pinyon+Script&display=swap';
export const FONT_LOADS = Object.values(F).map((f) => fontCss(f, 40));

const logoOps = (f, x, y, w, h, align) => (f.logo ? [imageBox(f.logo, x, y, w, h, { align })] : []);
const dy = (H) => H / 1400; // medidas pensadas na placa 14x20, escaladas pela altura

// ---- Modelos ----
export const TEMPLATES = [
  {
    id: 'classica', name: 'Clássica', fonts: ['Pinyon Script', 'Carlito'], desc: 'Moldura de cantos recortados e nome cursivo',
    build(f, H, measure) {
      const s = dy(H), logo = f.logo ? 130 * s : 0;
      const r = stack({ x: 220, y: 150, w: W - 440, h: H - 300 - logo, measure, items: [
        { text: f.name, font: F.pinyon, size: 200 * s, oneLine: true, leading: 1.1 },
        { text: f.title, font: F.carlitoB, size: 72 * s, gap: 24 * s },
        { text: f.body, font: F.carlito, size: 70 * s, gap: 30 * s },
        { text: f.line, font: F.carlitoI, size: 66 * s, gap: 46 * s },
        { text: f.from, font: F.carlito, size: 68 * s, gap: 40 * s }
      ] });
      return { ops: [...frameScoop(H), ...r.ops, ...logoOps(f, W / 2 - 220, H - 150 - logo, 440, logo)], fit: r.fit, overflow: r.overflow };
    }
  },
  {
    id: 'filete', name: 'Filete duplo', fonts: ['Cormorant Garamond'], desc: 'Sóbria, com filete duplo e nome em maiúsculas',
    build(f, H, measure) {
      const s = dy(H), logo = f.logo ? 130 * s : 0;
      const r = stack({ x: 220, y: 170, w: W - 440, h: H - 340 - logo, measure, items: [
        { text: f.name, font: F.cormB, size: 124 * s, oneLine: true, upper: true, spacing: 0.05, leading: 1.1 },
        { text: f.title, font: F.cormI, size: 82 * s, gap: 14 * s },
        { text: f.body, font: F.corm, size: 76 * s, gap: 38 * s },
        { text: f.line, font: F.cormI, size: 66 * s, gap: 42 * s },
        { text: f.from, font: F.cormB, size: 66 * s, gap: 24 * s }
      ] });
      return { ops: [...frameDouble(H), ...r.ops, ...logoOps(f, W / 2 - 220, H - 170 - logo, 440, logo)], fit: r.fit, overflow: r.overflow };
    }
  },
  {
    id: 'ornamento', name: 'Ornamentos', fonts: ['Great Vibes', 'EB Garamond'], desc: 'Arabescos nos cantos, tradicional',
    build(f, H, measure) {
      const s = dy(H), logo = f.logo ? 120 * s : 0;
      const r = stack({ x: 300, y: 150, w: W - 600, h: H - 300 - logo, measure, items: [
        { text: f.name, font: F.vibes, size: 180 * s, oneLine: true, leading: 1.15 },
        { text: f.title, font: F.ebI, size: 76 * s, gap: 20 * s },
        { text: f.body, font: F.eb, size: 68 * s, gap: 30 * s },
        { text: f.line, font: F.ebI, size: 60 * s, gap: 40 * s },
        { text: f.from, font: F.eb, size: 62 * s, gap: 30 * s, upper: true, spacing: 0.04 }
      ] });
      return { ops: [...frameFlourish(H), ...r.ops, ...logoOps(f, W / 2 - 220, H - 150 - logo, 440, logo)], fit: r.fit, overflow: r.overflow };
    }
  },
  {
    id: 'institucional', name: 'Institucional', fonts: ['Montserrat'], desc: 'Logo no topo e texto direto, para entidades',
    build(f, H, measure) {
      const s = dy(H), logo = f.logo ? 230 * s : 0;
      const top = 140 + logo + (f.logo ? 20 * s : 0);
      const r = stack({ x: 210, y: top, w: W - 420, h: H - top - 140, measure, items: [
        { text: f.title, font: F.montB, size: 62 * s, upper: true, spacing: 0.03 },
        { text: f.name, font: F.montB, size: 92 * s, oneLine: true, gap: 22 * s, upper: true },
        { text: f.body, font: F.mont, size: 54 * s, gap: 30 * s, leading: 1.32 },
        { text: f.line, font: F.mont, size: 50 * s, gap: 36 * s },
        { text: f.from, font: F.montB, size: 52 * s, gap: 26 * s, upper: true }
      ] });
      return { ops: [...frameThin(H), ...logoOps(f, W / 2 - 340, 140, 680, logo), ...r.ops], fit: r.fit, overflow: r.overflow };
    }
  },
  {
    id: 'corporativa', name: 'Corporativa', fonts: ['Manrope'], desc: 'Alinhada à esquerda, com linha em curva',
    build(f, H, measure) {
      const s = dy(H), logoH = f.logo ? 210 * s : 0;
      const r = stack({ x: 240, y: 110 + logoH, w: W - 400, h: H * 0.78 - 130 - logoH, align: 'start', measure, items: [
        { text: f.title, font: F.man, size: 58 * s },
        { text: f.name, font: F.manX, size: 104 * s, oneLine: true, gap: 10 * s, leading: 1.15 },
        { text: f.body, font: F.man, size: 56 * s, gap: 26 * s, leading: 1.32 }
      ] });
      const foot = stack({ x: 420, y: H * 0.81, w: W - 510, h: H * 0.15, align: 'end', measure, items: [
        { text: f.from, font: F.manX, size: 50 * s },
        { text: f.line, font: F.man, size: 46 * s, gap: 8 * s }
      ] });
      return { ops: [...frameSweep(H), ...logoOps(f, 240, 90, 620, logoH, 'start'), ...r.ops, ...foot.ops], fit: Math.min(r.fit, foot.fit), overflow: r.overflow || foot.overflow };
    }
  },
  {
    id: 'retrato', name: 'Com retrato', fonts: ['Pinyon Script', 'Carlito'], desc: 'Foto gravada à esquerda e texto ao lado', needsPhoto: true,
    build(f, H, measure) {
      const s = dy(H), photoW = 700, gap = 56, logo = f.logo ? 130 * s : 0;
      const photo = f.photo
        ? [imageBox(f.photo, 150, 170, photoW, H - 340, { gray: true })]
        : [stroke(`M150 170H${150 + photoW}V${H - 170}H150Z`, 4, { dash: '18 14', draft: true })];
      const x = 150 + photoW + gap;
      const r = stack({ x, y: 170, w: W - x - 160, h: H - 340 - logo, measure, items: [
        { text: f.name, font: F.pinyon, size: 150 * s, oneLine: true, leading: 1.12 },
        { text: f.title, font: F.carlitoB, size: 66 * s, gap: 22 * s },
        { text: f.body, font: F.carlito, size: 58 * s, gap: 24 * s },
        { text: f.line, font: F.carlitoI, size: 54 * s, gap: 26 * s },
        { text: f.from, font: F.carlito, size: 54 * s, gap: 18 * s }
      ] });
      return { ops: [...frameDouble(H), ...photo, ...r.ops, ...logoOps(f, x, H - 170 - logo, W - x - 160, logo)], fit: r.fit, overflow: r.overflow };
    }
  },
  {
    id: 'certificado', name: 'Certificado', fonts: ['Great Vibes', 'EB Garamond'], desc: 'Título de reconhecimento e linhas de assinatura',
    build(f, H, measure) {
      const s = dy(H), signs = (f.signatures || []).filter(Boolean).slice(0, 3), signH = signs.length ? 190 * s : 0;
      const r = stack({ x: 240, y: 160, w: W - 480, h: H - 320 - signH, measure, items: [
        { text: f.title || 'Certificado de Reconhecimento', font: F.ebI, size: 88 * s },
        { text: f.name, font: F.vibes, size: 170 * s, oneLine: true, gap: 16 * s, leading: 1.15 },
        { text: f.body, font: F.eb, size: 60 * s, gap: 24 * s },
        { text: f.from, font: F.eb, size: 56 * s, gap: 24 * s },
        { text: f.line, font: F.ebI, size: 52 * s, gap: 14 * s }
      ] });
      const ops = [...frameDouble(H), ...r.ops];
      const baseY = H - 150 - signH + 90 * s;
      const cw = (W - 400) / Math.max(1, signs.length);
      signs.forEach((sig, i) => {
        const cx = 200 + cw * i + cw / 2;
        ops.push(stroke(`M${cx - cw * 0.38} ${baseY}H${cx + cw * 0.38}`, 3));
        const size = Math.min(44 * s, (cw * 0.9) / Math.max(1, measure(sig, fontCss(F.eb, 1))));
        ops.push({ type: 'text', x: cx, y: baseY + size * 1.3, text: sig, font: F.eb, size, spacing: 0, anchor: 'center', fill: INK });
      });
      return { ops: [...ops, ...logoOps(f, 180, 150, 280, 180 * s, 'start')], fit: r.fit, overflow: r.overflow };
    }
  },
  {
    id: 'carinho', name: 'Mensagem longa', fonts: ['Dancing Script', 'Cormorant Garamond'], desc: 'Para textos longos e despedidas com carinho',
    build(f, H, measure) {
      const s = dy(H), logo = f.logo ? 120 * s : 0;
      const r = stack({ x: 230, y: 130, w: W - 460, h: H - 260 - logo, measure, items: [
        { text: f.name, font: F.dancing, size: 118 * s, oneLine: true, leading: 1.15 },
        { text: f.title, font: F.cormB, size: 64 * s, gap: 16 * s },
        { text: f.body, font: F.cormI, size: 72 * s, gap: 24 * s, leading: 1.22 },
        { text: f.from, font: F.cormB, size: 62 * s, gap: 30 * s },
        { text: f.line, font: F.cormI, size: 54 * s, gap: 10 * s }
      ] });
      return { ops: [...frameFlourish(H), ...r.ops, ...logoOps(f, W / 2 - 220, H - 130 - logo, 440, logo)], fit: r.fit, overflow: r.overflow };
    }
  }
];

export function buildScene(templateId, fields, size, measure) {
  const tpl = TEMPLATES.find((t) => t.id === templateId) || TEMPLATES[0];
  const H = plateHeight(size);
  const result = tpl.build(fields, H, measure);
  return { H, size, ops: result.ops, fit: result.fit, overflow: result.overflow, template: tpl };
}

// ---- Saídas ----
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const n = (v) => Math.round(v * 100) / 100;

// `production`: o arquivo para o Corel, sem o metal de fundo. Leva a medida real da
// placa e um contorno vermelho nesse tamanho, porque o Corel mede o que foi importado,
// não a página. O texto continua editável, desde que a fonte esteja instalada.
export function toSvg(scene, { production = false, attrs = '', idPrefix = 'p' } = {}) {
  const { H, ops } = scene;
  const gid = `${idPrefix}-metal`;
  const fid = `${idPrefix}-gray`;
  const defs = production
    ? ''
    : `<defs><linearGradient id="${gid}" x1="0" x2="1" y1="0" y2="0">${METAL_STOPS.map(([o, c]) => `<stop offset="${o}" stop-color="${c}"/>`).join('')}</linearGradient><filter id="${fid}"><feColorMatrix type="saturate" values="0"/></filter></defs>`;
  const bg = production ? '' : `<rect width="${W}" height="${H}" fill="url(#${gid})"/><rect x="1.5" y="1.5" width="${W - 3}" height="${H - 3}" fill="none" stroke="#2b2b2e" stroke-width="3"/>`;
  const body = ops
    .filter((op) => !(production && op.draft))
    .map((op) => {
      if (op.type === 'path') {
        const t = op.transform ? ` transform="matrix(${op.transform[0]} 0 0 ${op.transform[1]} ${op.transform[2]} ${op.transform[3]})"` : '';
        const dash = op.dash ? ` stroke-dasharray="${op.dash}"` : '';
        return `<path d="${op.d}" fill="${op.fill || 'none'}"${op.stroke ? ` stroke="${op.stroke}" stroke-width="${op.width}"` : ''}${dash}${t}/>`;
      }
      if (op.type === 'image') {
        const filter = op.gray && !production ? ` filter="url(#${fid})"` : '';
        return `<image ${production ? 'xlink:href' : 'href'}="${esc(op.asset.src)}" x="${n(op.x)}" y="${n(op.y)}" width="${n(op.w)}" height="${n(op.h)}"${filter}/>`;
      }
      const f = op.font;
      const anchor = op.anchor === 'center' ? 'middle' : op.anchor === 'end' ? 'end' : 'start';
      return `<text x="${n(op.x)}" y="${n(op.y)}" font-family="${esc(f.family)}" font-size="${n(op.size)}"${f.weight ? ` font-weight="${f.weight}"` : ''}${f.style ? ` font-style="${f.style}"` : ''}${op.spacing ? ` letter-spacing="${n(op.spacing)}"` : ''} text-anchor="${anchor}" fill="${op.fill}">${esc(op.text)}</text>`;
    })
    .join('');
  if (production) {
    const mm = plateMm(scene.size);
    const edge = `<rect id="limite-da-placa" x="0" y="0" width="${W}" height="${H}" fill="none" stroke="#ff0000" stroke-width="1"/>`;
    return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" version="1.1" width="${mm.w}mm" height="${mm.h}mm" viewBox="0 0 ${W} ${H}">${edge}${body}</svg>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" ${attrs}>${defs}${bg}${body}</svg>`;
}

export function drawScene(ctx, scene, Path2DImpl) {
  const { H, ops } = scene;
  const g = ctx.createLinearGradient(0, 0, W, 0);
  METAL_STOPS.forEach(([o, c]) => g.addColorStop(o, c));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = '#2b2b2e';
  ctx.lineWidth = 3;
  ctx.strokeRect(1.5, 1.5, W - 3, H - 3);
  ops.forEach((op) => {
    if (op.draft) return;
    ctx.save();
    if (op.type === 'path') {
      if (op.transform) ctx.transform(op.transform[0], 0, 0, op.transform[1], op.transform[2], op.transform[3]);
      const p = new Path2DImpl(op.d);
      if (op.fill) { ctx.fillStyle = op.fill; ctx.fill(p); }
      if (op.stroke) { ctx.strokeStyle = op.stroke; ctx.lineWidth = op.width; ctx.stroke(p); }
    } else if (op.type === 'image') {
      if (op.gray) ctx.filter = 'grayscale(1)';
      ctx.drawImage(op.asset.el, op.x, op.y, op.w, op.h);
    } else {
      ctx.font = fontCss(op.font, op.size);
      ctx.fillStyle = op.fill;
      ctx.textAlign = op.anchor === 'center' ? 'center' : op.anchor === 'end' ? 'right' : 'left';
      if ('letterSpacing' in ctx) ctx.letterSpacing = `${op.spacing || 0}px`;
      ctx.fillText(op.text, op.x, op.y);
    }
    ctx.restore();
  });
}

// ---- Conferência automática ----
// `erro` precisa ser resolvido ou conferido; `aviso` só chama atenção.
export function checkFields(fields, scene) {
  const issues = [];
  const text = [fields.name, fields.title, fields.body, fields.line, fields.from, ...(fields.signatures || [])].filter(Boolean).join('\n');
  if (!String(fields.name || '').trim()) issues.push({ level: 'erro', msg: 'Falta o nome do homenageado.' });

  const dates = [...text.matchAll(/\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})\b/g)];
  const parsed = [];
  dates.forEach((m) => {
    const d = +m[1], mo = +m[2], y = +(m[3].length === 2 ? `20${m[3]}` : m[3]);
    const real = new Date(y, mo - 1, d);
    if (real.getFullYear() !== y || real.getMonth() !== mo - 1 || real.getDate() !== d) {
      issues.push({ level: 'erro', msg: `Data impossível: ${m[0]}.` });
    } else parsed.push({ raw: m[0], real });
  });
  for (let i = 1; i < parsed.length; i++) {
    if (parsed[i].real < parsed[i - 1].real) issues.push({ level: 'aviso', msg: `Datas fora de ordem: ${parsed[i - 1].raw} vem antes de ${parsed[i].raw}.` });
  }
  if (/ {2,}/.test(text)) issues.push({ level: 'aviso', msg: 'Há espaços duplos no texto.' });
  if (/\b(a definir|xxx+|nome aqui)\b/i.test(text)) issues.push({ level: 'erro', msg: 'Ainda há texto provisório na arte.' });
  if (scene) {
    if (scene.overflow) issues.push({ level: 'erro', msg: 'O texto não coube neste modelo e tamanho.' });
    else if (scene.fit < 0.55) issues.push({ level: 'aviso', msg: 'A letra ficou pequena: considere um tamanho maior ou menos texto.' });
    if (scene.template.needsPhoto && !fields.photo) issues.push({ level: 'erro', msg: 'Este modelo precisa da foto para o retrato.' });
  }
  return issues;
}
