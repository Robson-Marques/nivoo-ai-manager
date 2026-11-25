export type VisualTheme='light'|'dark'|'system';
export type VisualDensity='compact'|'balanced'|'spacious';
export type VisualUsage='desktop'|'mobile'|'both';
export type VisualProfile={schemaVersion:1;mode:'guided'|'delegated';styleId?:string;glassVariantId?:string;paletteId?:string;fonts?:{heading?:string;body?:string;mono?:string};theme?:VisualTheme;density?:VisualDensity;usage?:VisualUsage};
export type VisualQuestion={id:string;pergunta:string;opcoes:{id:string;rotulo:string;descricao:string}[];visualDiscovery:{version:1;projectId:string;revision:number}};
export type Style={id:string;name:string;description:string;preferredTheme:VisualTheme};
export type GlassVariant={id:string;name:string;description:string;preferredTheme:VisualTheme;tintOpacity:number;blurPx:number;highlight:string};
export type Font={id:string;name:string;stack:string;availability:'system'|'optional-local';roles:string[]};
export type Pairing={id:string;name:string;description:string;fonts:{heading:string;body:string;mono:string}};
export type Colors={background:string;surface:string;surfaceRaised:string;text:string;muted:string;border:string;accent:string;onAccent:string;success:string};
export type Palette={id:string;name:string;light:Colors;dark:Colors};
export type Density={id:VisualDensity;name:string;spacing:{xs:number;sm:number;md:number;lg:number;xl:number};controlMinHeight:number};
export type Foundation={styleId:string;radius:{control:number;panel:number;overlay:number};shadow:{panel:string;overlay:string}};
export type Catalog={styles:Style[];glassVariants:GlassVariant[];fonts:Font[];pairings:Pairing[];palettes:Palette[];densities:Density[];foundations:Foundation[]};
export type Choices={style:string;glassVariant:string;usage:string;typography:string;theme:string;palette:string;density:string};
export const DELEGATE='delegated';
export const emptyChoices:Choices={style:'',glassVariant:DELEGATE,usage:'',typography:'',theme:'',palette:DELEGATE,density:DELEGATE};
export const delegatedChoices:Choices={style:DELEGATE,glassVariant:DELEGATE,usage:DELEGATE,typography:DELEGATE,theme:DELEGATE,palette:DELEGATE,density:DELEGATE};
export function validQuestions(raw:unknown,projectId:string):raw is VisualQuestion[]{
  if(!Array.isArray(raw)||raw.length!==4)return false;
  const ids=['style','usage','typography','theme'];
  const revision=raw[0]?.visualDiscovery?.revision;
  return Number.isSafeInteger(revision)&&revision>=0&&raw.every((q,i)=>q?.id===ids[i]&&q.visualDiscovery?.version===1&&q.visualDiscovery.projectId===projectId&&q.visualDiscovery.revision===revision&&Array.isArray(q.opcoes)&&q.opcoes.some((o:any)=>o?.id===DELEGATE));
}
export function buildVisualSelection(c:Choices,questions:VisualQuestion[],catalog:Catalog):VisualProfile|null{
  for(const q of questions){
    const id=c[q.id as keyof Choices];
    if(!id||!q.opcoes.some(o=>o.id===id))return null;
  }
  const out:VisualProfile={schemaVersion:1,mode:(Object.entries(c).some(([key,value])=>key!=='glassVariant'&&value===DELEGATE)||(c.style==='liquid-glass'&&c.glassVariant===DELEGATE))?'delegated':'guided'};
  if(c.style!==DELEGATE){if(!catalog.styles.some(s=>s.id===c.style))return null;out.styleId=c.style;}
  if(c.style==='liquid-glass'&&c.glassVariant!==DELEGATE){if(!catalog.glassVariants.some(v=>v.id===c.glassVariant))return null;out.glassVariantId=c.glassVariant;}
  if(c.usage!==DELEGATE){if(!['desktop','mobile','both'].includes(c.usage))return null;out.usage=c.usage as VisualUsage;}
  if(c.theme!==DELEGATE){if(!['light','dark','system'].includes(c.theme))return null;out.theme=c.theme as VisualTheme;}
  if(c.typography!==DELEGATE){
    const p=catalog.pairings.find(x=>x.id===c.typography);
    if(!p)return null;
    out.fonts={...p.fonts};
  }
  if(c.palette!==DELEGATE){if(!catalog.palettes.some(p=>p.id===c.palette))return null;out.paletteId=c.palette;}
  if(c.density!==DELEGATE){if(!catalog.densities.some(d=>d.id===c.density))return null;out.density=c.density as VisualDensity;}
  return out;
}
