/** Metadados locais. Nenhum arquivo de fonte ou chamada CDN é incluído.
 * Manrope refere-se especificamente à edição OFL do Google Fonts. */
export type FontRole='heading'|'body'|'mono';
export interface VisualFont {
  id:string;
  name:string;
  category:'sans'|'serif'|'mono';
  roles:readonly FontRole[];
  stack:string;
  description:string;
  license:'OFL-1.1'|null;
  source:string|null;
  availability:'system'|'optional-local';
}
export interface FontPairing {
  id:string;
  name:string;
  description:string;
  fonts:Record<FontRole,string>;
  styleIds:readonly string[];
}
export const VISUAL_TYPOGRAPHY_CATALOG_VERSION=1;
export const VISUAL_FONTS:readonly VisualFont[]=[
  {
    "id": "system-sans",
    "name": "Fonte do sistema",
    "category": "sans",
    "roles": [
      "heading",
      "body"
    ],
    "stack": "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    "description": "Interface nativa, sem download de fonte.",
    "license": null,
    "source": null,
    "availability": "system"
  },
  {
    "id": "system-serif",
    "name": "Serifada do sistema",
    "category": "serif",
    "roles": [
      "heading",
      "body"
    ],
    "stack": "Georgia, 'Times New Roman', serif",
    "description": "Contraste editorial sem download de fonte.",
    "license": null,
    "source": null,
    "availability": "system"
  },
  {
    "id": "system-mono",
    "name": "Monoespaçada do sistema",
    "category": "mono",
    "roles": [
      "mono"
    ],
    "stack": "ui-monospace, SFMono-Regular, Consolas, monospace",
    "description": "Código e identificadores técnicos.",
    "license": null,
    "source": null,
    "availability": "system"
  },
  {
    "id": "inter",
    "name": "Inter",
    "category": "sans",
    "roles": [
      "heading",
      "body"
    ],
    "stack": "Inter, system-ui, sans-serif",
    "description": "Leitura de interfaces, formulários e dados.",
    "license": "OFL-1.1",
    "source": "https://github.com/rsms/inter",
    "availability": "optional-local"
  },
  {
    "id": "manrope",
    "name": "Manrope",
    "category": "sans",
    "roles": [
      "heading",
      "body"
    ],
    "stack": "Manrope, system-ui, sans-serif",
    "description": "Personalidade geométrica para títulos e interfaces.",
    "license": "OFL-1.1",
    "source": "https://github.com/google/fonts/tree/main/ofl/manrope",
    "availability": "optional-local"
  },
  {
    "id": "ibm-plex-sans",
    "name": "IBM Plex Sans",
    "category": "sans",
    "roles": [
      "heading",
      "body"
    ],
    "stack": "'IBM Plex Sans', system-ui, sans-serif",
    "description": "Linguagem técnica e profissional.",
    "license": "OFL-1.1",
    "source": "https://github.com/IBM/plex",
    "availability": "optional-local"
  },
  {
    "id": "ibm-plex-serif",
    "name": "IBM Plex Serif",
    "category": "serif",
    "roles": [
      "heading",
      "body"
    ],
    "stack": "'IBM Plex Serif', Georgia, serif",
    "description": "Hierarquia editorial e institucional.",
    "license": "OFL-1.1",
    "source": "https://github.com/IBM/plex",
    "availability": "optional-local"
  },
  {
    "id": "ibm-plex-mono",
    "name": "IBM Plex Mono",
    "category": "mono",
    "roles": [
      "mono"
    ],
    "stack": "'IBM Plex Mono', ui-monospace, monospace",
    "description": "Código e dados de largura fixa.",
    "license": "OFL-1.1",
    "source": "https://github.com/IBM/plex",
    "availability": "optional-local"
  }
];
export const FONT_PAIRINGS:readonly FontPairing[]=[
  {
    "id": "native",
    "name": "Nativo e leve",
    "description": "Fontes do sistema; não exige ativos externos.",
    "fonts": {
      "heading": "system-sans",
      "body": "system-sans",
      "mono": "system-mono"
    },
    "styleIds": [
      "liquid-glass",
      "minimalist",
      "corporate",
      "premium-dark"
    ]
  },
  {
    "id": "inter-ui",
    "name": "Interface moderna",
    "description": "Uma família de interface e mono do sistema.",
    "fonts": {
      "heading": "inter",
      "body": "inter",
      "mono": "system-mono"
    },
    "styleIds": [
      "minimalist",
      "corporate",
      "liquid-glass"
    ]
  },
  {
    "id": "geometric",
    "name": "Geométrico premium",
    "description": "Manrope nos títulos e Inter no texto.",
    "fonts": {
      "heading": "manrope",
      "body": "inter",
      "mono": "system-mono"
    },
    "styleIds": [
      "liquid-glass",
      "premium-dark",
      "minimalist"
    ]
  },
  {
    "id": "plex-technical",
    "name": "Técnico corporativo",
    "description": "Famílias Plex coordenadas para interfaces e código.",
    "fonts": {
      "heading": "ibm-plex-sans",
      "body": "ibm-plex-sans",
      "mono": "ibm-plex-mono"
    },
    "styleIds": [
      "corporate",
      "premium-dark"
    ]
  },
  {
    "id": "plex-editorial",
    "name": "Editorial profissional",
    "description": "Títulos serifados e texto funcional sem serifa.",
    "fonts": {
      "heading": "ibm-plex-serif",
      "body": "ibm-plex-sans",
      "mono": "system-mono"
    },
    "styleIds": [
      "minimalist",
      "corporate"
    ]
  }
];
export function findVisualFont(id:string):VisualFont|undefined{
  return VISUAL_FONTS.find(f=>f.id===id);
}
export function visualFontSupports(id:string,role:FontRole):boolean{
  return findVisualFont(id)?.roles.includes(role)??false;
}
export function visualTypographyCatalog(){
  return {version:VISUAL_TYPOGRAPHY_CATALOG_VERSION,fonts:VISUAL_FONTS,pairings:FONT_PAIRINGS};
}
/** Somente famílias selecionadas, deduplicadas, sem alternativas ou URLs. */
export function selectedTypographyContext(fonts:Partial<Record<FontRole,string>>|undefined):string[]{
  if(!fonts)return [];
  const roles:readonly FontRole[]=['heading','body','mono'];
  const unique=new Set<string>();
  for(const role of roles){const id=fonts[role];if(id)unique.add(id);}
  const lines=[...unique].map(id=>{
    const f=findVisualFont(id);
    const supported=roles.filter(role=>fonts[role]===id).every(role=>visualFontSupports(id,role));
    return f&&supported
      ? '- Família '+f.name+': '+f.stack+(f.availability==='optional-local'?' (use arquivo licenciado já disponível ou fallback; não carregue CDN automaticamente).':' (fonte do sistema).')
      : '- Fonte '+id+' indisponível ou incompatível com o papel selecionado; preserve o padrão existente e confirme antes de substituí-la.';
  });
  return lines.length?[
    ...lines,
    '- Tipografia: títulos, texto e código seguem os papéis escolhidos. Use hierarquia, pesos e alturas de linha proporcionais; respeite acentos do português, zoom, legibilidade e números tabulares quando pertinentes. Não altere a marca ou force fontes não escolhidas.',
  ]:[];
}
