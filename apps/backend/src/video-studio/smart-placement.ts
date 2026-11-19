/**
 * Direção espacial determinística: valida toda a duração dos overlays contra
 * regiões protegidas, preservando a sugestão do agente quando encontra espaço.
 * Coordenadas normalizadas 0..1; não executa código da IA.
 */
export type Box = {x:number;y:number;w:number;h:number};
export type Span = {start:number;end:number};
export type Zone = Span & Box;
export type Insert = Span & {kind:'caption'|'image'|'graphic';x:number;y:number;w?:number;h?:number};
const intersects=(a:Box,b:Box)=>a.x<b.x+b.w && b.x<a.x+a.w && a.y<b.y+b.h && b.y<a.y+a.h;
const concurrent=(a:Span,b:Span)=>a.start<b.end && b.start<a.end;
const clamp=(n:number,lo:number,hi:number)=>Math.min(hi,Math.max(lo,n));
export function footprint(e:Insert):Box {
  if(e.kind==='caption')return {x:clamp(e.x-.40,0,.2),y:clamp(e.y-.065,0,.87),w:.80,h:.13};
  return {x:e.x,y:e.y,w:e.w??.32,h:e.h??.22};
}
export function safeInsert<T extends Insert>(element:T,zones:Zone[],scheduled:Insert[]=[]):T|null {
  const fits=(e:T)=>{
    const b=footprint(e);
    if(![b.x,b.y,b.w,b.h].every(Number.isFinite)||b.w<=0||b.h<=0||
      b.x<0||b.y<0||b.x+b.w>1.00001||b.y+b.h>1.00001)return false;
    return !zones.some(z=>concurrent(e,z)&&intersects(b,z)) &&
      !scheduled.some(o=>concurrent(e,o)&&intersects(b,footprint(o)));
  };
  if(fits(element))return element;
  const centers=element.kind==='caption'?
    [[.5,.80],[.5,.17],[.5,.49],[.5,.32],[.5,.64]]:
    [[.06,.12],[.63,.12],[.06,.65],[.63,.65],[.33,.38],[.06,.38],[.63,.38]];
  for(const [x,y] of centers){
    const candidate={...element,x,y} as T;
    if(fits(candidate))return candidate;
  }
  return null;
}
