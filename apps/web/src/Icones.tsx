/**
 * Ícones da interface: Tabler Icons (https://tabler.io/icons, licença MIT; aviso legal só aqui, nunca na tela),
 * família escolhida pela regra de interface do Studio Workflow (Iconoir, Phosphor, Tabler ou Font Awesome Free).
 * Identificadores: "plus", "archive", "microphone".
 */
const base = { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true } as const;

export const IconeMais = () => (
  <svg {...base}>
    <path d="M12 5l0 14" />
    <path d="M5 12l14 0" />
  </svg>
);

export const IconeArquivo = () => (
  <svg {...base}>
    <path d="M3 4m0 2a2 2 0 0 1 2 -2h14a2 2 0 0 1 2 2v0a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2z" />
    <path d="M5 8v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2 -2v-10" />
    <path d="M10 12l4 0" />
  </svg>
);

export const IconeMicrofone = () => (
  <svg {...base} width={20} height={20}>
    <path d="M9 2m0 3a3 3 0 0 1 3 -3h0a3 3 0 0 1 3 3v5a3 3 0 0 1 -3 3h0a3 3 0 0 1 -3 -3z" />
    <path d="M5 10a7 7 0 0 0 14 0" />
    <path d="M8 21l8 0" />
    <path d="M12 17l0 4" />
  </svg>
);
