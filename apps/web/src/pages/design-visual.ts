export const keys=['primary','secondary','accent','background','surface','text','muted','border','success','warning','danger'] as const;
export type ColorKey=typeof keys[number];
export type Colors=Record<ColorKey,string>;
export type Visual={colors:Colors;darkColors:Colors;font:'system'|'serif'|'mono';density:'compact'|'normal'|'comfortable';layout:'sidebar'|'topbar'|'bento';component:'dashboard'|'form'|'table'|'controls';radius:number;shadow:'none'|'soft'|'strong';gradient:boolean;gradientAngle:number;motion:boolean};
export type Palette={name:string;colors:Colors;darkColors:Colors};
export const colorNames:Record<ColorKey,string>={primary:'Primária',secondary:'Secundária',accent:'Destaque',background:'Fundo',surface:'Superfície',text:'Texto',muted:'Texto secundário',border:'Borda',success:'Sucesso',warning:'Aviso',danger:'Erro'};
function luminance(hex:string){const a=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);return a[0]*.2126+a[1]*.7152+a[2]*.0722;}
export function contrast(a:string,b:string){const x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);}
export function readableText(c:string){return contrast(c,'#FFFFFF')>=contrast(c,'#000000')?'#FFFFFF':'#000000';}
