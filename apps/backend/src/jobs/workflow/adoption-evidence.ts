import * as fs from 'node:fs';
import * as path from 'node:path';
import { resolveInside,caminhoDoProjeto } from '../../common/path-guard';
import { liquidGlassIntegratedFiles } from '../../projects/liquid-glass-components';
import { liquidGlassTemplate } from '../../projects/liquid-glass-template';
import type { Adoption } from './adoption-contract';
import { approvedDesign,approvedDesignSource } from '../../projects/approved-design';

type Row={id?:unknown;callsites?:unknown;notApplicable?:unknown;components?:unknown};
const file=(root:string,p:string)=>{const f=resolveInside(root,p);if(!fs.statSync(f).isFile())throw Error('Não é arquivo: '+p);return fs.readFileSync(f,'utf8');};
/** Nomes oficiais aceitos no campo "components" do inventário: a raiz do motor,
 * a raiz do design aprovado e os controles originais do registry presentes no
 * pacote. Conjunto fechado — a IA escolhe entre eles, não inventa nomes. */
function officialComponentNames(original:Array<{name:string;content:string}>):string[]{
  return ['engine/nivoo.tsx','approved-design.tsx',...original.filter(f=>/^registry\/ui\/.*\.tsx$/.test(f.name)).map(f=>f.name)];
}
export function officialAdoptionComponents():string[]{
  return officialComponentNames([
    ...liquidGlassTemplate().files.filter(f=>f.name.startsWith('engine/')),
    ...liquidGlassIntegratedFiles(),
  ]);
}
/** Especificação canônica do inventário, gravada no worktree para a IA ler em
 * vez de supor o formato. Conjunto fechado de nomes e regras reais da conferência. */
export function adoptionInventorySpec(a:Adoption):string{
  const ativas=a.families.filter(f=>!a.pending.includes(f));
  const pkg=a.packagePath??'design-system/liquid-glass';
  const regIds=officialAdoptionComponents().filter(n=>n.startsWith('registry/ui/')).map(n=>n.replace(/^registry\/ui\//,'').replace(/\.tsx$/,''));
  return [
    '# Formato do inventário de adoção Liquid Glass',
    '',
    'Arquivo conferido pela verificação nativa "mapa-de-adocao": `'+a.manifest+'`.',
    'Preencha EXATAMENTE este formato. Não invente campos nem nomes; declare só o que existe no código.',
    '',
    '## Estrutura',
    '```json',
    '{',
    '  "artifact": "'+a.artifact+'",',
    '  "source": "'+a.source+'",',
    '  "revision": "'+a.revision+'",',
    '  "families": [',
    '    { "id": "shell", "callsites": ["<arquivo-consumidor>"], "components": ["engine/nivoo.tsx"] }',
    '  ]',
    '}',
    '```',
    '',
    '## Regras',
    '- Uma entrada por família contratada (campo `id`): '+ativas.join(', ')+'.',
    '- `callsites`: arquivos do CONSUMIDOR (fora de `'+pkg+'/`) que de fato importam o componente; caminhos relativos do projeto, nunca `out/`, `midia/` ou `node_modules/`.',
    '- `components`: apenas nomes do conjunto fechado abaixo. Cada componente precisa ser importado por um dos `callsites` da mesma família.',
    '- `shell` e `controls` exigem `callsites` reais (não aceitam `notApplicable`). `controls` e `forms` exigem ao menos um `registry/ui/<id>.tsx`.',
    '- Família sem uso pertinente: `"callsites": []` e `"notApplicable": "<justificativa, mínimo 15 caracteres>"`.',
    '',
    '## Nomes oficiais aceitos em `components` (conjunto fechado)',
    '- `engine/nivoo.tsx`',
    '- `approved-design.tsx`',
    ...regIds.map(id=>'- `registry/ui/'+id+'.tsx`'),
    '',
  ].join('\n');
}
export function verifyAdoptionInventory(root:string,a:Adoption,visual?:{profile:unknown;revision:number}):{families:string[];callsites:number;originalFiles:number}{
  const raw=JSON.parse(file(root,a.manifest));
  if(raw.artifact!==a.artifact||raw.source!==a.source||raw.revision!==a.revision||!Array.isArray(raw.families))throw Error('Inventário '+a.manifest+' não corresponde à identidade aprovada. Use exatamente artifact="'+a.artifact+'", source="'+a.source+'", revision="'+a.revision+'" e um array "families".');
  const rows=raw.families as Row[];
  if(rows.length!==a.families.length||new Set(rows.map(r=>r.id)).size!==rows.length||rows.some(r=>typeof r.id!=='string'||!a.families.includes(r.id)))throw Error('Inventário deve cobrir exatamente as famílias contratadas, uma entrada por família (campo "id"): '+a.families.join(', ')+'.');
  const original=a.artifact==='liquid-glass'?[
    ...liquidGlassTemplate().files.filter(f=>f.name.startsWith('engine/')),
    ...liquidGlassIntegratedFiles()
  ]:[];
  const officialNames=officialComponentNames(original);
  const registryIds=original.filter(f=>/^registry\/ui\/.*\.tsx$/.test(f.name)).map(f=>f.name.replace(/^registry\/ui\//,'').replace(/\.tsx$/,''));
  for(const f of original){
    if(file(root,a.packagePath+'/'+f.name)!==f.content)throw Error('Fonte original divergiu: '+f.name+'. Preserve o pacote e adapte o consumidor.');
  }
  if(a.artifact==='liquid-glass'&&visual){
    const design=approvedDesign(visual.profile,visual.revision);
    if(design){
      if(file(root,a.packagePath+'/approved-design.tsx')!==approvedDesignSource(design))throw Error('Raiz do design aprovado foi alterada. Adapte o consumidor, não a identidade aprovada.');
      const profile=JSON.parse(file(root,a.packagePath+'/approved-profile.json'));
      if(JSON.stringify(profile)!==JSON.stringify(design))throw Error('Perfil visual não corresponde à revisão aprovada.');
    }
  }
  let callsites=0;
  for(const row of rows){
    if(!Array.isArray(row.callsites)||row.callsites.some(p=>typeof p!=='string'||caminhoDoProjeto(p)!==p||/^(?:out|midia|node_modules)(?:\/|$)/.test(p)))throw Error('Callsites inválidos em '+row.id+': "callsites" deve listar caminhos relativos do projeto (nunca out/, midia/ ou node_modules/) dos arquivos consumidores reais que usam a família.');
    if(!row.callsites.length){
      if(typeof row.notApplicable!=='string'||row.notApplicable.trim().length<15||row.id==='shell'||row.id==='controls')throw Error('Família '+row.id+': informe "callsites" com os arquivos reais que a usam, ou — exceto shell e controls — "callsites":[] com "notApplicable" explicando por que não se aplica (mínimo 15 caracteres). Não suponha: declare só o que existe no código.');
      continue;
    }
    const contents=(row.callsites as string[]).map(p=>{if(a.packagePath&&(p===a.packagePath||p.startsWith(a.packagePath+'/')))throw Error('Callsite deve pertencer ao consumidor, não ao pacote: '+p);return {p,s:file(root,p)};});callsites+=contents.length;
    if(a.artifact==='liquid-glass'){
      const components=Array.isArray(row.components)?row.components:[];
      const invalid=components.filter(c=>typeof c!=='string'||!officialNames.includes(c));
      if(!components.length||invalid.length)throw Error('Família '+row.id+': declare em "components" ao menos um componente oficial que um callsite importe'+(invalid.length?'; inválido(s): '+invalid.map(String).join(', '):'')+'. Nomes válidos: "engine/nivoo.tsx", "approved-design.tsx" ou "registry/ui/<id>.tsx" (ids: '+registryIds.join(', ')+'). Use só esses nomes; não invente.');
      if(['controls','forms'].includes(String(row.id))&&!components.some(c=>typeof c==='string'&&c.startsWith('registry/ui/')))throw Error('Família '+row.id+': use controles originais do registry ("registry/ui/<id>.tsx"), não só a superfície de vidro.');
      // Check actual import paths in consumer sources; not a substitute for
      // executing the flows or checking visual fidelity.
      for(const c of components as string[]){
        if(!contents.some(({p,s})=>{
          let rel=path.posix.relative(path.posix.dirname(p),a.packagePath+'/'+c).replace(/\.(?:tsx?|jsx?)$/,'');
          if(!rel.startsWith('.'))rel='./'+rel;
          return [...s.matchAll(/\bimport\b\s+(?:[\w$*{},\s]+?)\s*from\s*['"]([^'"]+)['"]/g)].some(m=>m[1].replace(/\.(?:tsx?|jsx?)$/,'')===rel);
        }))throw Error('Componente "'+c+'" declarado na família '+row.id+' não é importado por nenhum dos callsites listados. Liste em "callsites" o arquivo que de fato importa "'+c+'", ou remova o componente. O Nivoo confere o import real.');
      }
    }
  }
  return {families:a.families,callsites,originalFiles:original.length};
}
export function verifyAdoptionCoverage(output:string,families:readonly string[]):string[]{
  const found=new Set<string>();
  for(const line of output.split(/\r?\n/)){
    const m=/^\s*(?:#\s*)?NIVOO_ADOPTION_EVIDENCE\s+(\{.*\})\s*$/.exec(line);
    if(!m)continue;
    try{const r=JSON.parse(m[1]);if(r.passed===true&&typeof r.family==='string'&&typeof r.scenario==='string'&&r.scenario.trim())found.add(r.family);}catch{/* no evidence */}
  }
  return families.filter(f=>!found.has(f));
}
