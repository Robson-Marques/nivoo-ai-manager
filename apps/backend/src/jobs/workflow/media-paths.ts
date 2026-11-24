import { BadRequestException } from '@nestjs/common';
import { normalizeMotionOutputs } from '../motion/command';

/** Single legacy path translation, before producers and consumers are linked. */
export function validarSaidaMotion(command:string,origem:string):string {
  const result=normalizeMotionOutputs(command);
  if(result.invalid)throw new BadRequestException(origem+': nivoo-renderizar-motion exige --saida midia/saida/<nome>.mp4 (nunca out/)');
  return replaceMediaAliases(result.command,result.aliases);
}
export function replaceMediaAliases(text:string,aliases:Record<string,string>):string {
  return text.replace(/(^|[^A-Za-z0-9_./-])(out\/[A-Za-z0-9._-]+\.mp4)(?![A-Za-z0-9_./-])/gi,
    (match,prefix,file)=>aliases[file]?prefix+aliases[file]:match);
}
export function normalizeWorkflowMediaPaths(raw:unknown,defaultProvider:string):unknown {
  if(!Array.isArray(raw))return raw;
  const aliases:Record<string,string>={};
  const steps=raw.map(s=>{
    if(!s||typeof s!=='object'||(s.provider??defaultProvider)!=='local-shell')return s;
    const result=normalizeMotionOutputs(String(s.instructions??''));
    if(result.invalid)throw new BadRequestException('Etapa '+String(s.key)+': destino Motion inválido');
    Object.assign(aliases,result.aliases);
    return result.command===s.instructions?s:{...s,instructions:result.command};
  });
  if(!Object.keys(aliases).length)return steps;
  return steps.map(s=>{
    if(!s||typeof s!=='object')return s;
    const provider=s.provider??defaultProvider;
    const next={...s};
    if(provider==='local-shell'&&typeof next.instructions==='string')next.instructions=replaceMediaAliases(next.instructions,aliases);
    if(typeof next.verifyCommand==='string')next.verifyCommand=replaceMediaAliases(next.verifyCommand,aliases);
    if(provider==='juntar-videos'&&next.providerOptions&&typeof next.providerOptions==='object'){
      const opts={...next.providerOptions};
      const replace=(v:unknown)=>typeof v==='string'?(aliases[v]??v):v;
      for(const k of ['cenas','videoOriginal','videoEntrada','video','cena']){
        const v=opts[k];
        if(Array.isArray(v))opts[k]=v.map(replace);
        else if(v&&typeof v==='object'&&'arquivo' in v)opts[k]={...v,arquivo:replace(v.arquivo)};
        else if(typeof v==='string')opts[k]=replace(v);
      }
      next.providerOptions=opts;
    }
    return next;
  });
}
