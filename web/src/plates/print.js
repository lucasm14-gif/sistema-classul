// Prepara as imagens da cena para o CorelDRAW, que só garante PNG e JPEG embutidos.
// O SVG não leva filtro para o Corel, então a foto gravada já sai em tons de cinza.
const CAN_EMBED = /^data:image\/(png|jpe?g);/i;

async function toImage(asset) {
  if (asset.el) return asset.el;
  const el = new Image();
  el.src = asset.src;
  await el.decode();
  return el;
}

async function reencode(asset, gray) {
  const el = await toImage(asset);
  const canvas = document.createElement('canvas');
  canvas.width = asset.w;
  canvas.height = asset.h;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(el, 0, 0, asset.w, asset.h);
  if (gray) {
    const img = ctx.getImageData(0, 0, asset.w, asset.h);
    const px = img.data;
    for (let i = 0; i < px.length; i += 4) {
      const y = Math.round(0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]);
      px[i] = y; px[i + 1] = y; px[i + 2] = y;
    }
    ctx.putImageData(img, 0, 0);
  }
  return canvas.toDataURL('image/png');
}

export async function sceneForCorel(scene) {
  const ops = await Promise.all(scene.ops.map(async (op) => {
    if (op.type !== 'image' || (!op.gray && CAN_EMBED.test(op.asset.src))) return op;
    return { ...op, asset: { ...op.asset, src: await reencode(op.asset, op.gray) } };
  }));
  return { ...scene, ops };
}
