import React, { useMemo } from 'react';

// Morcego do Ideal (o mesmo do app do iPhone): silhueta num espaço 100×50,
// espelhada em x = 50, desenhada como grade de pontos.
const START = [50, 14];
const RIGHT = [
  [[52, 14]],
  [[54.5, 3]],
  [[57, 15]],
  [[63, 16], [60, 17]],
  [[98, 6], [82, 17]],
  [[92, 20], [97, 14]],
  [[81, 22], [86, 16.5]],
  [[71, 30], [73, 22.5]],
  [[59, 34], [63, 27.5]],
  [[50, 46], [53, 36]]
];

export function batPath() {
  const m = ([x, y]) => [100 - x, y];
  const pts = [START, ...RIGHT.map((s) => s[0])];
  let d = `M${START.join(' ')}`;
  for (const [to, c] of RIGHT) d += c ? ` Q${c.join(' ')} ${to.join(' ')}` : ` L${to.join(' ')}`;
  for (let i = RIGHT.length - 1; i >= 0; i--) {
    const c = RIGHT[i][1];
    const to = m(pts[i]);
    d += c ? ` Q${m(c).join(' ')} ${to.join(' ')}` : ` L${to.join(' ')}`;
  }
  return d + ' Z';
}

const cache = new Map();
function dots(columns) {
  if (cache.has(columns)) return cache.get(columns);
  const out = [];
  try {
    const ctx = document.createElement('canvas').getContext('2d');
    const path = new Path2D(batPath());
    const pitch = 100 / columns;
    const rows = Math.floor(50 / pitch);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < columns; c++) {
        const x = (c + 0.5) * pitch;
        const y = (r + 0.5) * pitch;
        if (ctx.isPointInPath(path, x, y)) out.push([x, y]);
      }
    }
  } catch {
    /* sem canvas: fica sem pontos */
  }
  const res = { dots: out, r: (100 / columns) * 0.36 };
  cache.set(columns, res);
  return res;
}

export function IdealMark({ columns = 30, className, style, title }) {
  const { dots: list, r } = useMemo(() => dots(columns), [columns]);
  return (
    <svg viewBox="0 0 100 50" className={className} style={style} role={title ? 'img' : undefined} aria-label={title} aria-hidden={title ? undefined : true}>
      {list.map(([x, y]) => (
        <circle key={`${x}-${y}`} cx={x} cy={y} r={r} />
      ))}
    </svg>
  );
}
