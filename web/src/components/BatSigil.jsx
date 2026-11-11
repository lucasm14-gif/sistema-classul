// Símbolo do morcego. Fica fora de Lucas.jsx porque o rodapé do sistema usa só ele:
// assim a área pessoal inteira só é baixada quando alguém abre.
import React from 'react';

// Metade direita do morcego; a esquerda é a mesma espelhada. Desenhar só um lado
// garante simetria perfeita e mantém o traço editável em um lugar só.
export const BAT_HALF =
  'M100 14 L104 3 C106 13 110 21 116 27 C140 14 170 8 197 14 ' +
  'C176 24 170 40 166 56 C152 54 138 58 130 70 C120 74 110 80 100 92 Z';

export function BatSigil({ className, line = false, style }) {
  return (
    <svg viewBox="0 0 200 100" className={className} style={style} aria-hidden="true">
      <g className={line ? 'btm-sigil-line' : 'btm-sigil-fill'}>
        <path d={BAT_HALF} />
        <path d={BAT_HALF} transform="scale(-1 1) translate(-200 0)" />
      </g>
    </svg>
  );
}
