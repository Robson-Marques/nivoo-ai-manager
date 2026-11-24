/** Frame rate contract for assembly. FFmpeg accepts the exact rational,
 * so NTSC rates do not become 24 or 30 by silent rounding. */
export function sourceFrameRate(value:unknown):{filter:string;value:number}|null{
  const text=String(value??'').trim();
  const m=/^(\d{1,10})(?:\/(\d{1,10}))?$/.exec(text);
  if(!m)return null;
  const n=Number(m[1]),d=Number(m[2]??1),rate=n/d;
  if(!d||!Number.isFinite(rate)||rate<1||rate>240)return null;
  return {filter:d===1?String(n):n+'/'+d,value:rate};
}
export function assemblyFrameRate(source:unknown,requested?:number):{filter:string;value:number}{
  if(requested!==undefined){
    if(!Number.isInteger(requested)||requested<1||requested>60)throw Error('FPS de montagem deve ser inteiro entre 1 e 60.');
    return {filter:String(requested),value:requested};
  }
  const rate=sourceFrameRate(source);
  if(!rate)throw Error('Não foi possível determinar a taxa de quadros da primeira cena. Informe FPS explicitamente ou corrija o arquivo de origem.');
  return rate;
}
export function preserveClipWithoutEncoding(single:boolean,cut:unknown,requested:number|undefined,source:unknown):boolean{
  if(!single||cut)return false;
  if(requested===undefined)return true;
  const original=sourceFrameRate(source);
  return !!original&&Math.abs(original.value-requested)<0.001;
}
