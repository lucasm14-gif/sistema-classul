// Foto realista: aplica a arte exata na cena do estojo escolhido pelo cliente.
// Roda no navegador de quem aperta o botão, sem custo de imagem. Cenas em public/plate-scenes.
const INK = 0.86;
const RELIEF = 0.28;

// Para cada ponto da foto, onde buscar na arte (perspectiva dos quatro cantos da chapa).
export function homography(dst, src) {
  const a = [];
  for (let i = 0; i < 4; i++) {
    a.push([dst[i][0], dst[i][1], 1, 0, 0, 0, -src[i][0] * dst[i][0], -src[i][0] * dst[i][1], src[i][0]]);
    a.push([0, 0, 0, dst[i][0], dst[i][1], 1, -src[i][1] * dst[i][0], -src[i][1] * dst[i][1], src[i][1]]);
  }
  for (let i = 0; i < 8; i++) {
    let p = i;
    for (let j = i + 1; j < 8; j++) if (Math.abs(a[j][i]) > Math.abs(a[p][i])) p = j;
    [a[i], a[p]] = [a[p], a[i]];
    for (let j = 0; j < 8; j++) {
      if (j === i) continue;
      const f = a[j][i] / a[i][i];
      for (let k = i; k < 9; k++) a[j][k] -= f * a[i][k];
    }
  }
  return a.map((r, n) => r[8] / r[n]);
}

const loadImage = (src) => new Promise((ok, fail) => {
  const img = new Image();
  img.onload = () => ok(img);
  img.onerror = () => fail(new Error('Não foi possível carregar a imagem.'));
  img.src = src;
});

export async function buildRealPhoto(artBlob, color, size) {
  const res = await fetch('/plate-scenes/cenas.json');
  if (!res.ok) throw new Error('Não encontrei as cenas do estojo.');
  const meta = (await res.json())[`${color}-${size}`];
  if (!meta) throw new Error(`Não há cena para estojo ${color} em ${size}.`);

  const artUrl = URL.createObjectURL(artBlob);
  try {
    const [scene, artImg] = await Promise.all([loadImage(`/plate-scenes/${color}-${size}.jpg`), loadImage(artUrl)]);
    const W = scene.naturalWidth;
    const H = scene.naturalHeight;
    const q = meta.q.map(([x, y]) => [x * (W / meta.w), y * (H / meta.h)]);
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(scene, 0, 0);

    const artCanvas = document.createElement('canvas');
    const AW = artImg.naturalWidth;
    const AH = artImg.naturalHeight;
    artCanvas.width = AW;
    artCanvas.height = AH;
    const actx = artCanvas.getContext('2d');
    actx.drawImage(artImg, 0, 0);
    const ad = actx.getImageData(0, 0, AW, AH).data;

    const out = ctx.getImageData(0, 0, W, H);
    const o = out.data;
    const h = homography(q, [[0, 0], [AW, 0], [AW, AH], [0, AH]]);
    const xs = q.map((p) => p[0]);
    const ys = q.map((p) => p[1]);
    const x0 = Math.max(0, Math.floor(Math.min(...xs)));
    const x1 = Math.min(W - 1, Math.ceil(Math.max(...xs)));
    const y0 = Math.max(0, Math.floor(Math.min(...ys)));
    const y1 = Math.min(H - 1, Math.ceil(Math.max(...ys)));
    const OFFS = [0.25, 0.75];

    // Média de 4 amostras, para a letra fina não serrilhar.
    const sample = (px, py, res2) => {
      let r = 0;
      let g = 0;
      let b = 0;
      for (const ox of OFFS) {
        for (const oy of OFFS) {
          const fx = px + ox;
          const fy = py + oy;
          const d = h[6] * fx + h[7] * fy + 1;
          const u = Math.floor((h[0] * fx + h[1] * fy + h[2]) / d);
          const v = Math.floor((h[3] * fx + h[4] * fy + h[5]) / d);
          if (u < 0 || v < 0 || u >= AW || v >= AH) {
            r += 255; g += 255; b += 255;
          } else {
            const a = (v * AW + u) * 4;
            r += ad[a]; g += ad[a + 1]; b += ad[a + 2];
          }
        }
      }
      res2[0] = r / 4; res2[1] = g / 4; res2[2] = b / 4;
    };

    const c0 = [0, 0, 0];
    const c1 = [0, 0, 0];
    for (let py = y0; py <= y1; py++) {
      for (let px = x0; px <= x1; px++) {
        sample(px, py, c0);
        const trace = 255 - (c0[0] + c0[1] + c0[2]) / 3;
        sample(px - 1, py - 1, c1);
        const light = Math.max(0, 255 - (c1[0] + c1[1] + c1[2]) / 3 - trace) * RELIEF;
        const i = (py * W + px) * 4;
        for (let ch = 0; ch < 3; ch++) o[i + ch] = Math.min(255, (o[i + ch] * (255 - (255 - c0[ch]) * INK)) / 255 + light);
      }
    }
    ctx.putImageData(out, 0, 0);
    return await new Promise((ok) => canvas.toBlob(ok, 'image/jpeg', 0.9));
  } finally {
    URL.revokeObjectURL(artUrl);
  }
}
