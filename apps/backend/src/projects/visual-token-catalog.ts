/** First-party design token data. Values are reference tokens for authorized UI
 * work, not global CSS overrides. Opaque color pairs are checked independently
 * of any later glass effect. All lengths are CSS px. */
export type ColorRole='background'|'surface'|'surfaceRaised'|'text'|'muted'|'border'|'controlBorder'|'accent'|'onAccent'|'focus'|'success'|'warning'|'danger'|'info';
export type ColorTokens=Record<ColorRole,string>;
export interface VisualPalette {
  id:string; name:string; description:string;
  light:ColorTokens; dark:ColorTokens;
}
export interface DensityTokens {
  id:'compact'|'balanced'|'spacious'; name:string;
  spacing:Record<'xs'|'sm'|'md'|'lg'|'xl',number>;
  controlMinHeight:number; touchMinHeight:number; tableRowMinHeight:number;
}
export interface StyleFoundation {
  styleId:string;
  radius:Record<'control'|'panel'|'overlay',number>;
  shadow:Record<'panel'|'overlay',string>;
  borderWidth:number;
}
export const VISUAL_TOKEN_CATALOG_VERSION=1;
export const VISUAL_PALETTES:readonly VisualPalette[]=[
  {
    "id": "ocean-blue",
    "name": "Azul oceano",
    "description": "Tecnologia, produtividade e serviços.",
    "light": {
      "background": "#F5F7FA",
      "surface": "#FFFFFF",
      "surfaceRaised": "#FFFFFF",
      "text": "#172033",
      "muted": "#475569",
      "border": "#CBD5E1",
      "controlBorder": "#64748B",
      "success": "#166534",
      "warning": "#92400E",
      "danger": "#B91C1C",
      "info": "#1D4ED8",
      "accent": "#1D4ED8",
      "onAccent": "#FFFFFF",
      "focus": "#1D4ED8"
    },
    "dark": {
      "background": "#10141C",
      "surface": "#1B2330",
      "surfaceRaised": "#263244",
      "text": "#F1F5F9",
      "muted": "#BCC9DB",
      "border": "#435168",
      "controlBorder": "#94A3B8",
      "success": "#86EFAC",
      "warning": "#FCD34D",
      "danger": "#FCA5A5",
      "info": "#93C5FD",
      "accent": "#93C5FD",
      "onAccent": "#10141C",
      "focus": "#93C5FD"
    }
  },
  {
    "id": "emerald",
    "name": "Verde esmeralda",
    "description": "Gestão, saúde, sustentabilidade e serviços.",
    "light": {
      "background": "#F5F7FA",
      "surface": "#FFFFFF",
      "surfaceRaised": "#FFFFFF",
      "text": "#172033",
      "muted": "#475569",
      "border": "#CBD5E1",
      "controlBorder": "#64748B",
      "success": "#166534",
      "warning": "#92400E",
      "danger": "#B91C1C",
      "info": "#1D4ED8",
      "accent": "#047857",
      "onAccent": "#FFFFFF",
      "focus": "#047857"
    },
    "dark": {
      "background": "#10141C",
      "surface": "#1B2330",
      "surfaceRaised": "#263244",
      "text": "#F1F5F9",
      "muted": "#BCC9DB",
      "border": "#435168",
      "controlBorder": "#94A3B8",
      "success": "#86EFAC",
      "warning": "#FCD34D",
      "danger": "#FCA5A5",
      "info": "#93C5FD",
      "accent": "#6EE7B7",
      "onAccent": "#10141C",
      "focus": "#6EE7B7"
    }
  },
  {
    "id": "violet",
    "name": "Violeta",
    "description": "Produtos digitais e identidade criativa.",
    "light": {
      "background": "#F5F7FA",
      "surface": "#FFFFFF",
      "surfaceRaised": "#FFFFFF",
      "text": "#172033",
      "muted": "#475569",
      "border": "#CBD5E1",
      "controlBorder": "#64748B",
      "success": "#166534",
      "warning": "#92400E",
      "danger": "#B91C1C",
      "info": "#1D4ED8",
      "accent": "#6D28D9",
      "onAccent": "#FFFFFF",
      "focus": "#6D28D9"
    },
    "dark": {
      "background": "#10141C",
      "surface": "#1B2330",
      "surfaceRaised": "#263244",
      "text": "#F1F5F9",
      "muted": "#BCC9DB",
      "border": "#435168",
      "controlBorder": "#94A3B8",
      "success": "#86EFAC",
      "warning": "#FCD34D",
      "danger": "#FCA5A5",
      "info": "#93C5FD",
      "accent": "#C4B5FD",
      "onAccent": "#10141C",
      "focus": "#C4B5FD"
    }
  },
  {
    "id": "graphite",
    "name": "Grafite neutro",
    "description": "Sistemas discretos e identidade monocromática.",
    "light": {
      "background": "#F5F7FA",
      "surface": "#FFFFFF",
      "surfaceRaised": "#FFFFFF",
      "text": "#172033",
      "muted": "#475569",
      "border": "#CBD5E1",
      "controlBorder": "#64748B",
      "success": "#166534",
      "warning": "#92400E",
      "danger": "#B91C1C",
      "info": "#1D4ED8",
      "accent": "#334155",
      "onAccent": "#FFFFFF",
      "focus": "#334155"
    },
    "dark": {
      "background": "#10141C",
      "surface": "#1B2330",
      "surfaceRaised": "#263244",
      "text": "#F1F5F9",
      "muted": "#BCC9DB",
      "border": "#435168",
      "controlBorder": "#94A3B8",
      "success": "#86EFAC",
      "warning": "#FCD34D",
      "danger": "#FCA5A5",
      "info": "#93C5FD",
      "accent": "#CBD5E1",
      "onAccent": "#10141C",
      "focus": "#CBD5E1"
    }
  }
];
export const VISUAL_DENSITIES:readonly DensityTokens[]=[
  {
    "id": "compact",
    "name": "Compacta",
    "spacing": {
      "xs": 4,
      "sm": 6,
      "md": 10,
      "lg": 16,
      "xl": 24
    },
    "controlMinHeight": 36,
    "touchMinHeight": 44,
    "tableRowMinHeight": 36
  },
  {
    "id": "balanced",
    "name": "Equilibrada",
    "spacing": {
      "xs": 4,
      "sm": 8,
      "md": 12,
      "lg": 20,
      "xl": 32
    },
    "controlMinHeight": 40,
    "touchMinHeight": 44,
    "tableRowMinHeight": 44
  },
  {
    "id": "spacious",
    "name": "Espaçosa",
    "spacing": {
      "xs": 6,
      "sm": 12,
      "md": 16,
      "lg": 24,
      "xl": 40
    },
    "controlMinHeight": 48,
    "touchMinHeight": 48,
    "tableRowMinHeight": 52
  }
];
export const STYLE_FOUNDATIONS:readonly StyleFoundation[]=[
  {
    "styleId": "liquid-glass",
    "radius": {
      "control": 12,
      "panel": 20,
      "overlay": 24
    },
    "shadow": {
      "panel": "0 8px 24px rgba(0,0,0,0.12)",
      "overlay": "0 16px 48px rgba(0,0,0,0.20)"
    },
    "borderWidth": 1
  },
  {
    "styleId": "minimalist",
    "radius": {
      "control": 6,
      "panel": 8,
      "overlay": 12
    },
    "shadow": {
      "panel": "none",
      "overlay": "0 8px 24px rgba(0,0,0,0.12)"
    },
    "borderWidth": 1
  },
  {
    "styleId": "corporate",
    "radius": {
      "control": 6,
      "panel": 10,
      "overlay": 12
    },
    "shadow": {
      "panel": "0 2px 8px rgba(0,0,0,0.06)",
      "overlay": "0 12px 32px rgba(0,0,0,0.16)"
    },
    "borderWidth": 1
  },
  {
    "styleId": "premium-dark",
    "radius": {
      "control": 10,
      "panel": 16,
      "overlay": 20
    },
    "shadow": {
      "panel": "0 4px 16px rgba(0,0,0,0.16)",
      "overlay": "0 16px 40px rgba(0,0,0,0.24)"
    },
    "borderWidth": 1
  }
];
export function findVisualPalette(id:string):VisualPalette|undefined{
  return VISUAL_PALETTES.find(p=>p.id===id);
}
export function visualTokenCatalog(){
  return {version:VISUAL_TOKEN_CATALOG_VERSION,palettes:VISUAL_PALETTES,densities:VISUAL_DENSITIES,foundations:STYLE_FOUNDATIONS};
}
/** WCAG relative luminance and contrast for opaque #RRGGBB colors only. */
function luminance(hex:string):number{
  if(!/^#[0-9a-f]{6}$/i.test(hex))throw Error('Cor hexadecimal inválida.');
  const rgb=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255).map(v=>v<=0.04045?v/12.92:Math.pow((v+0.055)/1.055,2.4));
  return 0.2126*rgb[0]+0.7152*rgb[1]+0.0722*rgb[2];
}
export function contrastRatio(a:string,b:string):number{
  const x=luminance(a),y=luminance(b);
  return (Math.max(x,y)+0.05)/(Math.min(x,y)+0.05);
}
function tokenLine(label:string,values:Record<string,string|number>):string{
  return '- '+label+': '+Object.entries(values).map(([k,v])=>k+'='+v).join('; ');
}
export function selectedTokenContext(paletteId:string|undefined,theme:'light'|'dark'|'system'|undefined,density:string|undefined,styleId:string|undefined):string[]{
  const lines:string[]=[];
  const p=paletteId?findVisualPalette(paletteId):undefined;
  if(p){
    if(theme!=='dark')lines.push(tokenLine('Paleta '+p.name+' — referência clara',p.light));
    if(theme!=='light')lines.push(tokenLine('Paleta '+p.name+' — referência escura',p.dark));
    if(!theme)lines.push('- Tema não escolhido: as duas referências são opções, não autorização para trocar o tema existente.');
    lines.push('- Cor: preserve contraste, estados semânticos também por texto/ícone e foco visível. A borda decorativa não substitui controlBorder; confira contraste após transparência e sobre fundos reais.');
  }else if(paletteId)lines.push('- Paleta indisponível; preserve a identidade existente e confirme antes de substituir.');
  const d=VISUAL_DENSITIES.find(x=>x.id===density);
  if(d){
    lines.push(tokenLine('Espaçamentos (px)',d.spacing));
    lines.push('- Alturas mínimas (px): controles='+d.controlMinHeight+'; toque='+d.touchMinHeight+'; linha de tabela='+d.tableRowMinHeight+'. Preserve zoom, conteúdo e alvos de toque.');
  }
  const f=STYLE_FOUNDATIONS.find(x=>x.styleId===styleId);
  if(f){
    lines.push(tokenLine('Raios (px)',f.radius),tokenLine('Sombras de referência',f.shadow),'- Borda de referência: '+f.borderWidth+'px.');
  }
  if(lines.length)lines.push('- Reutilize tokens e variáveis do projeto; estes valores são referências para o escopo autorizado, não substituição global da identidade. Não invente escolha ausente.');
  return lines;
}
