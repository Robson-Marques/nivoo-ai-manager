import { BadRequestException } from '@nestjs/common';
export const colorKeys=['primary','secondary','accent','background','surface','text','muted','border','success','warning','danger'] as const;
type ColorKey=typeof colorKeys[number];
export type VisualSettings={
  colors:Record<ColorKey,string>;
  darkColors:Record<ColorKey,string>;
  font:'system'|'serif'|'mono';
  density:'compact'|'normal'|'comfortable';
  layout:'sidebar'|'topbar'|'bento';
  component:'dashboard'|'form'|'table'|'controls';
  radius:number; shadow:'none'|'soft'|'strong';
  gradient:boolean; gradientAngle:number; motion:boolean;
};
const dark={primary:'#60A5FA',secondary:'#818CF8',accent:'#22D3EE',background:'#101827',surface:'#1E293B',text:'#F8FAFC',muted:'#CBD5E1',border:'#475569',success:'#4ADE80',warning:'#FBBF24',danger:'#FB7185'};
const light={primary:'#2563EB',secondary:'#4F46E5',accent:'#0891B2',background:'#F1F5F9',surface:'#FFFFFF',text:'#0F172A',muted:'#475569',border:'#CBD5E1',success:'#15803D',warning:'#A16207',danger:'#B91C1C'};
export const defaultVisual:VisualSettings={colors:light,darkColors:dark,font:'system',density:'normal',layout:'sidebar',component:'dashboard',radius:12,shadow:'soft',gradient:false,gradientAngle:135,motion:true};
const tuples=[
['Azul corporativo','#2563EB','#4F46E5','#0891B2'],['Esmeralda','#047857','#0F766E','#65A30D'],['Violeta','#7C3AED','#4F46E5','#C026D3'],['Grafite','#334155','#475569','#64748B'],['Dourado','#9A6700','#A16207','#92400E'],['Vermelho','#B91C1C','#BE123C','#EA580C'],['Laranja','#C2410C','#B45309','#DC2626'],['Petróleo','#0E7490','#115E59','#2563EB'],['Rosa','#BE185D','#A21CAF','#7C3AED'],['Índigo','#4338CA','#2563EB','#0E7490'],['Lima','#4D7C0F','#15803D','#0F766E'],['Monocromático','#404040','#525252','#737373'],['Terracota','#9A3412','#9F1239','#B45309'],['Lavanda','#6D28D9','#7E22CE','#A21CAF'],['Oceano','#0369A1','#1D4ED8','#0F766E'],['Café','#78350F','#92400E','#A16207'],['Oliva','#3F6212','#4D7C0F','#0F766E'],['Marinho','#1E3A8A','#3730A3','#0369A1'],['Coral','#BE123C','#C2410C','#A21CAF'],['Turquesa','#0F766E','#0E7490','#047857'],['Ameixa','#86198F','#6B21A8','#BE185D'],['Safira','#1D4ED8','#0369A1','#4338CA'],['Jade','#166534','#047857','#0F766E'],['Ardósia','#475569','#334155','#0369A1'],['Cobre','#92400E','#9A3412','#B91C1C'],['Fúcsia','#A21CAF','#BE185D','#6D28D9']
];
function lighten(hex:string){const n=[1,3,5].map(i=>Math.round(parseInt(hex.slice(i,i+2),16)*.55+255*.45).toString(16).padStart(2,'0'));return '#'+n.join('').toUpperCase();}
export const palettes=tuples.map(([name,primary,secondary,accent])=>({name,colors:{...light,primary,secondary,accent},darkColors:{...dark,primary:lighten(primary),secondary:lighten(secondary),accent:lighten(accent)}}));
const object=(v:unknown):Record<string,unknown>=>{if(!v||typeof v!=='object'||Array.isArray(v))throw new BadRequestException('Configuração visual inválida');return v as Record<string,unknown>;};
function colors(v:unknown){const o=object(v);const result={} as Record<ColorKey,string>;for(const k of colorKeys){const c=o[k];if(typeof c!=='string'||!/^#[0-9a-f]{6}$/i.test(c))throw new BadRequestException('Cor inválida: '+k);result[k]=c.toUpperCase();}return result;}
function choice<T extends string>(v:unknown,values:readonly T[]):T{if(typeof v!=='string'||!values.includes(v as T))throw new BadRequestException('Opção visual inválida');return v as T;}
function num(v:unknown,min:number,max:number){if(typeof v!=='number'||!Number.isFinite(v)||v<min||v>max)throw new BadRequestException('Valor visual fora do intervalo');return v;}
function bool(v:unknown){if(typeof v!=='boolean')throw new BadRequestException('Opção visual inválida');return v;}
export function validateVisual(raw:unknown):VisualSettings{const o=object(raw);return {colors:colors(o.colors),darkColors:colors(o.darkColors),font:choice(o.font,['system','serif','mono']),density:choice(o.density,['compact','normal','comfortable']),layout:choice(o.layout,['sidebar','topbar','bento']),component:choice(o.component,['dashboard','form','table','controls']),radius:num(o.radius,0,32),shadow:choice(o.shadow,['none','soft','strong']),gradient:bool(o.gradient),gradientAngle:num(o.gradientAngle,0,360),motion:bool(o.motion)};}
