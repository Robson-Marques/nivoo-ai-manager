/** First-party style descriptions. The catalog contains data, not executable
 * CSS, dependencies, remote image URLs or authorization to redesign a project.
 * IDs are durable; never recycle an ID for a different visual identity. */
export type VisualUseCase='operational'|'public-site'|'mobile-app'|'product-app';
export interface VisualStyle {
  id: string;
  name: string;
  description: string;
  suitableFor: readonly VisualUseCase[];
  preferredTheme: 'light'|'dark'|'system';
  preview: {
    surface: 'translucent'|'solid'|'graphite';
    outline: 'luminous'|'subtle'|'defined';
    shape: 'rounded'|'simple'|'structured';
    depth: 'layered'|'flat'|'subtle';
  };
  guidance: string;
}

export const VISUAL_STYLE_CATALOG_VERSION=1;
export const VISUAL_STYLES: readonly VisualStyle[]=[
  {
    "id": "liquid-glass",
    "name": "Liquid Glass",
    "description": "Superfícies translúcidas, profundidade e controles com aparência de vidro.",
    "suitableFor": [
      "mobile-app",
      "public-site",
      "product-app"
    ],
    "preferredTheme": "system",
    "preview": {
      "surface": "translucent",
      "outline": "luminous",
      "shape": "rounded",
      "depth": "layered"
    },
    "guidance": "Use translucidez seletiva, contornos luminosos discretos e camadas com profundidade. Mantenha texto, tabelas e operações críticas sobre superfícies legíveis; ofereça alternativa opaca quando o efeito não estiver disponível ou prejudicar o contraste."
  },
  {
    "id": "minimalist",
    "name": "Minimalista",
    "description": "Hierarquia clara, superfícies discretas e poucos elementos decorativos.",
    "suitableFor": [
      "operational",
      "public-site",
      "mobile-app",
      "product-app"
    ],
    "preferredTheme": "system",
    "preview": {
      "surface": "solid",
      "outline": "subtle",
      "shape": "simple",
      "depth": "flat"
    },
    "guidance": "Priorize tipografia, espaços, alinhamento e contraste; use decoração apenas quando comunicar algo. Não esconda controles ou reduza a densidade útil em nome do minimalismo."
  },
  {
    "id": "corporate",
    "name": "Corporativo",
    "description": "Organização profissional, navegação previsível e componentes funcionais.",
    "suitableFor": [
      "operational",
      "product-app",
      "public-site"
    ],
    "preferredTheme": "system",
    "preview": {
      "surface": "solid",
      "outline": "defined",
      "shape": "structured",
      "depth": "subtle"
    },
    "guidance": "Priorize produtividade, navegação clara, formulários, tabelas e hierarquia de dados. Preserve a marca e a densidade escolhidas; não imponha uma cor corporativa universal."
  },
  {
    "id": "premium-dark",
    "name": "Premium Dark",
    "description": "Superfícies grafite e contraste refinado, com destaque visual contido.",
    "suitableFor": [
      "product-app",
      "mobile-app",
      "operational"
    ],
    "preferredTheme": "dark",
    "preview": {
      "surface": "graphite",
      "outline": "subtle",
      "shape": "rounded",
      "depth": "subtle"
    },
    "guidance": "Use contraste sofisticado e superfícies com hierarquia, sem excesso de brilhos. O modo escuro é a recomendação, não uma imposição: se houver tema claro explícito, adapte a mesma linguagem visual e preserve a preferência."
  }
];

/** Fixed order, stable IDs, no project state or external calls. */
export function findVisualStyle(id:string):VisualStyle|undefined{
  return VISUAL_STYLES.find(style=>style.id===id);
}

export function visualStyleCatalog(){
  return {version:VISUAL_STYLE_CATALOG_VERSION,styles:VISUAL_STYLES};
}
