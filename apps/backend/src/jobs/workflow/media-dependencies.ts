import { nativeImageTarget,visualReferences,isCodex } from '../../providers/codex-image-assets';
import { BadRequestException } from '@nestjs/common';
import { caminhoDoProjeto } from '../../common/path-guard';
import { readMotionInvocations } from '../motion/command';
import { mediaDeliveries } from '../../specialties/media/delivery';
export function normalizarCenasDeMontagem(o: any): unknown[] {
  if (!o || typeof o !== 'object') return [];
  if (Array.isArray(o.cenas)) return o.cenas;
  if (typeof o.cenas === 'string' && o.cenas.trim()) return [o.cenas.trim()];
  const entrada = o.videoOriginal ?? o.videoEntrada ?? o.video ?? o.cena;
  if (typeof entrada === 'string' && entrada.trim()) return [entrada.trim()];
  if (entrada && typeof entrada === 'object' && typeof entrada.arquivo === 'string')
    return [entrada.arquivo.trim()];
  return [];
}

type Step=Record<string,unknown>;
const record=(v:unknown):Record<string,unknown>=>v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:{};
const mediaPath=(v:unknown)=>caminhoDoProjeto(v);

/** Physical outputs of the official media connectors, not inferred from titles. */
export function mediaOutputs(step:Step,defaultProvider:string):string[]{
  const provider=String(step.provider??defaultProvider),opts=record(step.providerOptions);
  const image=nativeImageTarget(opts.visualAsset)?.arquivo??(provider==='gemini-image'?mediaPath(opts.arquivo):undefined);
  return [...new Set([...mediaDeliveries(provider,String(step.instructions??''),opts,typeof step.key==='string'?step.key:'video').map(x=>x.path),...(image?[image]:[])])];
}
export function mediaInputs(step:Step,defaultProvider:string):string[]{
  const provider=step.provider??defaultProvider,opts=record(step.providerOptions);
  if(isCodex(String(provider)))return visualReferences(opts.visualReferences);
  if(provider==='gemini-video'){const img=mediaPath(opts.imagem);return img?[img]:[];}
  if(provider==='gemini-image')return Array.isArray(opts.referencias)?opts.referencias.map(mediaPath).filter((x):x is string=>!!x):[];
  if(provider==='local-shell')return readMotionInvocations(String(step.instructions??'')).map(op=>mediaPath(op.source)).filter((x):x is string=>!!x);
  if(provider!=='juntar-videos')return [];
  return [...normalizarCenasDeMontagem(opts),record(opts.narracao).arquivo,record(opts.trilha).arquivo]
    .flatMap(value=>{
      const file=mediaPath(typeof value==='object'&&value!==null?record(value).arquivo:value);
      return file?[file]:[];
    });
}
export function dependenciasDeMontagemPorArquivo(raw:unknown,defaultProvider:string):unknown{
  if(!Array.isArray(raw))return raw;
  const outputs=new Map<string,string>();
  for(const s of raw){
    if(!s||typeof s!=='object'||typeof s.key!=='string')continue;
    for(const file of mediaOutputs(s,defaultProvider)){
      const previous=outputs.get(file);
      if(previous&&previous!==s.key)throw new BadRequestException('Duas etapas tentam produzir o mesmo '+(/\.mp4$/i.test(file)?'MP4 ':'arquivo ')+file+'. Use saídas distintas para não sobrescrever versões anteriores.');
      outputs.set(file,s.key);
    }
  }
  return raw.map(s=>{
    if(!s||typeof s!=='object'||typeof s.key!=='string')return s;
    const before=Array.isArray(s.dependsOn)?s.dependsOn.map(String):[];
    const inputs=mediaInputs(s,defaultProvider);
    const extra=inputs.flatMap(file=>{
      const producer=outputs.get(file);
      if(producer===s.key)throw new BadRequestException('Etapa '+s.key+': entrada e saída não podem ser o mesmo arquivo: '+file);
      return producer?[producer]:[];
    });
    return extra.some(key=>!before.includes(key))?{...s,dependsOn:[...new Set([...before,...extra])]}:s;
  });
}
