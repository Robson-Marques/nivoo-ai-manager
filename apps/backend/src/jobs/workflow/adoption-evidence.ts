import * as fs from 'node:fs';
import * as path from 'node:path';
import { resolveInside,caminhoDoProjeto } from '../../common/path-guard';
import { liquidGlassIntegratedFiles } from '../../projects/liquid-glass-components';
import { liquidGlassTemplate } from '../../projects/liquid-glass-template';
import type { Adoption } from './adoption-contract';

type Row={id?:unknown;callsites?:unknown;notApplicable?:unknown;components?:unknown};
const file=(root:string,p:string)=>{const f=resolveInside(root,p);if(!fs.statSync(f).isFile())throw Error('Não é arquivo: '+p);return fs.readFileSync(f,'utf8');};
export function verifyAdoptionInventory(root:string,a:Adoption):{families:string[];callsites:number;originalFiles:number}{
  const raw=JSON.parse(file(root,a.manifest));
  if(raw.artifact!==a.artifact||raw.source!==a.source||raw.revision!==a.revision||!Array.isArray(raw.families))throw Error('Inventário não corresponde à identidade e revisão aprovadas.');
  const rows=raw.families as Row[];
  if(rows.length!==a.families.length||new Set(rows.map(r=>r.id)).size!==rows.length||rows.some(r=>typeof r.id!=='string'||!a.families.includes(r.id)))throw Error('Inventário não cobre todas as famílias contratadas.');
  const original=a.artifact==='liquid-glass'?[
    ...liquidGlassTemplate().files.filter(f=>f.name.startsWith('engine/')),
    ...liquidGlassIntegratedFiles()
  ]:[];
  for(const f of original){
    if(file(root,a.packagePath+'/'+f.name)!==f.content)throw Error('Fonte original divergiu: '+f.name+'. Preserve o pacote e adapte o consumidor.');
  }
  let callsites=0;
  for(const row of rows){
    if(!Array.isArray(row.callsites)||row.callsites.some(p=>typeof p!=='string'||caminhoDoProjeto(p)!==p||/^(?:out|midia|node_modules)(?:\/|$)/.test(p)))throw Error('Callsites inválidos em '+row.id);
    if(!row.callsites.length){
      if(typeof row.notApplicable!=='string'||row.notApplicable.trim().length<15||row.id==='shell'||row.id==='controls')throw Error('Família sem callsites ou justificativa verificável: '+row.id);
      continue;
    }
    const contents=(row.callsites as string[]).map(p=>({p,s:file(root,p)}));callsites+=contents.length;
    if(a.artifact==='liquid-glass'){
      const components=Array.isArray(row.components)?row.components:[];
      if(!components.length||components.some(c=>typeof c!=='string'||!original.some(f=>f.name===c)&&c!=='approved-design.tsx'))throw Error('Família sem componentes oficiais identificados: '+row.id);
      // Check actual import paths in consumer sources; not a substitute for
      // executing the flows or checking visual fidelity.
      for(const c of components as string[]){
        if(!contents.some(({p,s})=>{
          let rel=path.posix.relative(path.posix.dirname(p),a.packagePath+'/'+c).replace(/\.(?:tsx?|jsx?)$/,'');
          if(!rel.startsWith('.'))rel='./'+rel;
          return [...s.matchAll(/\b(?:import|export)\b[^;\n]*?\bfrom\s*['"]([^'"]+)['"]/g)].some(m=>m[1].replace(/\.(?:tsx?|jsx?)$/,'')===rel);
        }))throw Error('Componente não importado por callsite mapeado em '+row.id+': '+c);
      }
    }
  }
  return {families:a.families,callsites,originalFiles:original.length};
}
export function verifyAdoptionCoverage(output:string,families:readonly string[]):string[]{
  const found=new Set<string>();
  for(const line of output.split(/\r?\n/)){
    const m=/^\s*NIVOO_ADOPTION_EVIDENCE\s+(\{.*\})\s*$/.exec(line);
    if(!m)continue;
    try{const r=JSON.parse(m[1]);if(r.passed===true&&typeof r.family==='string'&&typeof r.scenario==='string'&&r.scenario.trim())found.add(r.family);}catch{/* no evidence */}
  }
  return families.filter(f=>!found.has(f));
}
