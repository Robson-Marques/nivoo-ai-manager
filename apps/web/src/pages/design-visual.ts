export const keys=['primary','secondary','accent','background','surface','text','muted','border','success','warning','danger'] as const;
export type ColorKey=typeof keys[number];
export type Colors=Record<ColorKey,string>;
export type Visual={colors:Colors;darkColors:Colors;font:'system'|'serif'|'mono';density:'compact'|'normal'|'comfortable';layout:'sidebar'|'topbar'|'bento';component:'dashboard'|'form'|'table'|'controls';radius:number;shadow:'none'|'soft'|'strong';gradient:boolean;gradientAngle:number;motion:boolean};
export type Palette={name:string;colors:Colors;darkColors:Colors};
export const colorNames:Record<ColorKey,string>={primary:'Primária',secondary:'Secundária',accent:'Destaque',background:'Fundo',surface:'Superfície',text:'Texto',muted:'Texto secundário',border:'Borda',success:'Sucesso',warning:'Aviso',danger:'Erro'};
function luminance(hex:string){const a=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);return a[0]*.2126+a[1]*.7152+a[2]*.0722;}
export function contrast(a:string,b:string){const x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);}
export function readableText(c:string){return contrast(c,'#FFFFFF')>=contrast(c,'#000000')?'#FFFFFF':'#000000';}

/** Convert CSS color notation to the sRGB HEX representation saved by the API. */
export function parseColor(value:string):string|null {
  const raw=value.trim();
  if(/^#[0-9a-f]{6}$/i.test(raw))return raw.toUpperCase();
  if(!/^(#[0-9a-f]{3}|(?:rgb|hsl|oklch)\([^()]+\))$/i.test(raw)||!CSS.supports('color',raw))return null;
  const canvas=document.createElement('canvas');canvas.width=1;canvas.height=1;
  const c=canvas.getContext('2d');if(!c)return null;
  c.clearRect(0,0,1,1);c.fillStyle=raw;c.fillRect(0,0,1,1);
  const p=c.getImageData(0,0,1,1).data;if(p[3]!==255)return null;
  return '#'+Array.from(p.slice(0,3)).map(v=>v.toString(16).padStart(2,'0')).join('').toUpperCase();
}
export async function extractBrandColors(file:File):Promise<string[]> {
  if(!/^image\/(png|jpeg|webp|gif)$/.test(file.type)||file.size>10*1024*1024)throw Error('Use PNG, JPEG, WebP ou GIF até 10 MB.');
  const img=await createImageBitmap(file);try{
    const canvas=document.createElement('canvas');canvas.width=64;canvas.height=64;
    const c=canvas.getContext('2d');if(!c)throw Error('Canvas indisponível.');
    c.drawImage(img,0,0,64,64);const p=c.getImageData(0,0,64,64).data;
    const bins=new Map<string,{n:number;r:number;g:number;b:number}>();
    for(let i=0;i<p.length;i+=4){const [r,g,b,a]=p.subarray(i,i+4);if(a<200)continue;const key=[r,g,b].map(x=>Math.floor(x/32)).join(',');const v=bins.get(key)??{n:0,r:0,g:0,b:0};v.n++;v.r+=r;v.g+=g;v.b+=b;bins.set(key,v);}
    const ranked=[...bins.values()].sort((a,b)=>b.n-a.n).map(v=>[v.r,v.g,v.b].map(x=>Math.round(x/v.n)));
    const selected:number[][]=[];for(const v of ranked){if(selected.every(s=>Math.hypot(...v.map((x,i)=>x-s[i]))>70))selected.push(v);if(selected.length===6)break;}
    return selected.map(v=>'#'+v.map(x=>x.toString(16).padStart(2,'0')).join('').toUpperCase());
  }finally{img.close();}
}
