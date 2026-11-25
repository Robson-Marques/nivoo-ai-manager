import { findVisualStyle } from './visual-style-catalog';
import { visualFontSupports,selectedTypographyContext,type FontRole } from './visual-typography-catalog';
import { findVisualPalette,selectedTokenContext } from './visual-token-catalog';

/** Stable contract for visual preferences. Style membership is validated on
 * new writes, as are font roles and palette IDs; layout follows later.
 * A null DB value means the user has not defined a visual profile. */
export interface VisualProfileV1 {
  schemaVersion: 1;
  mode: 'guided' | 'delegated';
  styleId?: string;
  paletteId?: string;
  layoutId?: string;
  fonts?: { heading?: string; body?: string; mono?: string };
  theme?: 'light' | 'dark' | 'system';
  density?: 'compact' | 'balanced' | 'spacious';
  usage?: 'desktop' | 'mobile' | 'both';
}

const FIELDS=['schemaVersion','mode','styleId','paletteId','layoutId','fonts','theme','density','usage'];
const FONT_FIELDS=['heading','body','mono'];
function objectValue(value:unknown):Record<string,unknown>{
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error('O perfil visual deve ser um objeto.');
  return value as Record<string,unknown>;
}
function onlyFields(value:Record<string,unknown>,fields:readonly string[]):void{
  if(Object.keys(value).some(k=>!fields.includes(k)))throw Error('Campo não permitido no perfil visual.');
}
function idValue(value:unknown):string{
  if(typeof value!=='string'||!/^[a-z0-9][a-z0-9-]{0,63}$/.test(value))throw Error('Identificador visual inválido.');
  return value;
}
function enumValue<T extends string>(value:unknown,choices:readonly T[]):T{
  if(typeof value!=='string'||!choices.includes(value as T))throw Error('Opção visual inválida.');
  return value as T;
}

/** Null is an explicit reset; undefined is never accepted as a reset. */
export function parseVisualProfile(value:unknown):VisualProfileV1|null{
  if(value===null)return null;
  const v=objectValue(value);
  onlyFields(v,FIELDS);
  if(v.schemaVersion!==1)throw Error('Versão do perfil visual não suportada.');
  const out:VisualProfileV1={schemaVersion:1,mode:enumValue(v.mode,['guided','delegated'] as const)};
  if('styleId' in v)out.styleId=idValue(v.styleId);
  if('paletteId' in v)out.paletteId=idValue(v.paletteId);
  if('layoutId' in v)out.layoutId=idValue(v.layoutId);
  if('theme' in v)out.theme=enumValue(v.theme,['light','dark','system'] as const);
  if('density' in v)out.density=enumValue(v.density,['compact','balanced','spacious'] as const);
  if('usage' in v)out.usage=enumValue(v.usage,['desktop','mobile','both'] as const);
  if('fonts' in v){
    const f=objectValue(v.fonts);
    onlyFields(f,FONT_FIELDS);
    const fonts:NonNullable<VisualProfileV1['fonts']>={};
    if('heading' in f)fonts.heading=idValue(f.heading);
    if('body' in f)fonts.body=idValue(f.body);
    if('mono' in f)fonts.mono=idValue(f.mono);
    if(!Object.keys(fonts).length)throw Error('Informe ao menos uma fonte ou omita fonts.');
    out.fonts=fonts;
  }
  if(out.mode==='guided'&&Object.keys(out).length===2)throw Error('Informe ao menos uma preferência ou delegue as escolhas.');
  return out;
}

export function parseVisualProfileUpdate(body:unknown):{expectedRevision:number;profile:VisualProfileV1|null}{
  const v=objectValue(body);
  onlyFields(v,['expectedRevision','profile']);
  const revision=v.expectedRevision;
  if(typeof revision!=='number'||!Number.isSafeInteger(revision)||revision<0||revision>=2147483647)throw Error('Informe expectedRevision válido.');
  const profile=parseVisualProfile(v.profile);
  if(profile?.styleId&&!findVisualStyle(profile.styleId))throw Error('Estilo visual não encontrado no catálogo.');
  if(profile?.paletteId&&!findVisualPalette(profile.paletteId))throw Error('Paleta visual não encontrada no catálogo.');
  const roles:readonly FontRole[]=['heading','body','mono'];
  for(const role of roles){
    const id=profile?.fonts?.[role];
    if(id&&!visualFontSupports(id,role))throw Error('Fonte visual não encontrada ou incompatível com o papel '+role+'.');
  }
  return {expectedRevision:revision,profile};
}

/** Only a structurally valid, known persisted choice may route visual skills. */
export function selectedVisualStyleId(value:unknown):string|undefined{
  try{const id=parseVisualProfile(value)?.styleId;return id&&findVisualStyle(id)?id:undefined;}catch{return undefined;}
}

/** Compact shared profile context: no external URLs, raw CSS, or new memory. */
export function visualProfileContext(value:unknown,revision:number):string[]{
  let p:VisualProfileV1|null;
  try{p=parseVisualProfile(value);}catch{return ['## Perfil visual inválido','Não aplique o perfil armazenado; informe a inconsistência. Preserve a identidade existente.'];}
  if(!p)return [];
  const style=p.styleId?findVisualStyle(p.styleId):undefined;
  return [
    '## Perfil visual do projeto — revisão '+revision,
    p.mode==='delegated'?'Escolhas não definidas foram delegadas à IA; preserve a marca e o padrão já aprovados.':'Use as preferências explícitas abaixo; campos ausentes não representam escolhas aprovadas.',
    ...([
      ['Estilo',p.styleId],['Paleta',p.paletteId],['Layout',p.layoutId],
      ['Fonte de títulos',p.fonts?.heading],['Fonte de texto',p.fonts?.body],['Fonte monoespaçada',p.fonts?.mono],
      ['Tema',p.theme],['Densidade',p.density],['Uso',p.usage],
    ].filter(([,v])=>v!==undefined).map(([k,v])=>'- '+k+': '+v)),
    ...(style?['- Direção do estilo '+style.name+': '+style.guidance]:p.styleId?['- Estilo não disponível no catálogo atual; preserve a identidade existente e solicite confirmação antes de substituí-lo.']:[]),
    ...selectedTypographyContext(p.fonts),
    ...selectedTokenContext(p.paletteId,p.theme,p.density,p.styleId),
    'Preferências são IDs, não comandos de instalação. Aplique somente a mudanças de interface; preserve contratos, acessibilidade e segurança. Não altere a identidade existente fora do escopo nem grave novas escolhas sem confirmação explícita.',
  ];
}
