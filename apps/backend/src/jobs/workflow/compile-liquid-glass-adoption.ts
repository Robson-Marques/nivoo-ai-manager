import { BadRequestException } from '@nestjs/common';
import { caminhoDoProjeto } from '../../common/path-guard';
import { LIQUI_UPSTREAM_COMMIT } from '../../projects/liquid-glass-template';
import { LIQUI_FAMILIES,adoptionIntent,adoptionOf,type Adoption } from './adoption-contract';
import { capabilityReference } from './capability-criteria';
import type { AreaScope } from '../../specialties/media/scope';

type Dict=Record<string,any>;
type RawCriterion={key:string;kind:string;description?:string;config:Dict};
const object=(v:unknown):Dict=>v&&typeof v==='object'&&!Array.isArray(v)?v as Dict:{};
const validPath=(v:unknown):v is string=>typeof v==='string'&&caminhoDoProjeto(v)===v&&!/^(?:out|midia|node_modules)(?:\/|$)/.test(v);
const fail=(message:string):never=>{throw new BadRequestException('Adoção Liquid Glass: '+message);};
const SOURCE='https://github.com/leefanv/liqui-design';
const DEFAULT_MANIFEST='docs/adocao-liquid-glass.json';
const DEFAULT_PACKAGE='design-system/liquid-glass';
const normalize=(v:unknown)=>String(v??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();

/** The platform owns known library identity and the inventory schema.
 * The planner still owns the actual test command and the project-specific
 * rollout decision. Never infer a successful test or run an invented command. */
export function compileLiquidGlassAdoption(
  raw:unknown,plan:{title:string;objective:string;steps:unknown},area?:AreaScope,profile?:unknown,request?:string,
):unknown{
  if(!Array.isArray(raw)||!raw.every(c=>c&&typeof c==='object'&&!Array.isArray(c)))return raw;
  const criteria:RawCriterion[]=raw.map(c=>({...c,config:{...object(c.config)}}));
  const intent=adoptionIntent({...plan,criteria},area,profile,request);
  if(!intent.liquidGlass)return raw;

  // Preserve the already-valid contract exactly (including a phased plan).
  // All other validation still runs after compilation.
  const declared=criteria.filter(c=>c.config.adoption!==undefined);
  const glass=declared.filter(c=>/^(?:liquid[ -]glass|liqui[ -]design)$/.test(normalize(object(c.config.adoption).artifact)));
  const maps=criteria.filter(c=>/^(?:mapa-de-adocao|mapa-adocao|adoption-inventory|adocao-liquid-glass)$/.test(normalize(c.key)));
  if(glass.length>1)fail('há mais de um inventário para a mesma biblioteca.');
  let map=glass[0]??(declared.length===1&&maps.includes(declared[0])?declared[0]:undefined)??(declared.length===0&&maps.length===1?maps[0]:undefined);
  if(!map&&declared.length)fail('identifique o inventário de Liquid Glass separadamente das outras adoções.');
  if(map&&map.kind!=='COMMAND'&&map.kind!=='FILE_EXISTS')fail('o inventário '+map.key+' deve ser COMMAND ou FILE_EXISTS.');
  const old=object(map?.config.adoption);
  const mode=old.mode??'complete';
  if(!['complete','pilot','rollout'].includes(mode))fail('mode deve ser complete, pilot ou rollout.');
  const families=[...LIQUI_FAMILIES] as string[];
  let pending:string[]=[];
  if(mode==='complete'){
    if(Array.isArray(old.pending)&&old.pending.length)fail('complete não pode ter pendências; mantenha o rollout explícito.');
    if(old.pending!==undefined&&!Array.isArray(old.pending))fail('pending deve ser uma lista.');
  }else{
    if(!Array.isArray(old.pending)||!old.pending.length||old.pending.some((f:unknown)=>typeof f!=='string'||!families.includes(f))||new Set(old.pending).size!==old.pending.length||old.pending.length===families.length)
      fail('piloto/rollout exige pending com famílias canônicas ainda não migradas: '+families.join(', ')+'.');
    pending=[...old.pending];
  }
  const covered=families.filter(f=>!pending.includes(f));
  const manifest=old.manifest??(map?.kind==='FILE_EXISTS'?map.config.path:undefined)??DEFAULT_MANIFEST;
  const packagePath=old.packagePath??DEFAULT_PACKAGE;
  if(!validPath(manifest)||!validPath(packagePath))fail('manifest e packagePath devem ser caminhos relativos válidos do projeto.');
  if(map?.kind==='FILE_EXISTS'&&map.config.path!==undefined&&map.config.path!==manifest)
    fail('o caminho do inventário deve ser igual a adoption.manifest; preserve outros arquivos em critérios separados.');
  const adoption:Adoption={artifact:'liquid-glass',source:SOURCE,revision:LIQUI_UPSTREAM_COMMIT,mode,manifest,packagePath,families:covered,pending};
  const mapRef=capabilityReference({capability:{...object(map?.config.capability),phase:'structural'}});
  const acceptance=criteria.filter(c=>c.kind==='COMMAND'&&capabilityReference(c.config)?.phase==='acceptance'&&c!==map);
  const groups=[...new Set(acceptance.map(c=>capabilityReference(c.config)!.id))];
  if(!mapRef&&groups.length>1)fail('vincule o inventário à Capability de interface correta.');
  const group=mapRef??(groups.length===1?capabilityReference(acceptance[0].config):null);
  const id=group?.id??'nivoo.capability.adocao-liquid-glass';
  const contract=group?.contract??manifest;
  const ref=(phase:string)=>({id,contract,phase});
  let integrated=acceptance.filter(c=>capabilityReference(c.config)?.id===id);
  if(!integrated.length){
    // A plainly named integrated COMMAND may be bound if it has no other
    // capability. Keep its actual command and all other criteria unchanged.
    const candidates=criteria.filter(c=>c!==map&&c.kind==='COMMAND'&&!c.config.capability&&
      (Array.isArray(c.config.adoptionFamilies)||/aceitac|aceite-integr|acceptance|integrado|integrada/.test(normalize(c.key))));
    if(candidates.length!==1)fail('informe um critério COMMAND de aceitação integrada real (config.capability.phase="acceptance"), com o comando do teste do projeto. O Nivoo não inventa esse comando.');
    integrated=candidates;
  }
  for(const c of integrated){
    const existing=capabilityReference(c.config);
    if(existing&&existing.contract!==contract)fail('os critérios integrados devem usar o mesmo contrato da Capability.');
    c.config={...c.config,capability:ref('acceptance')};
    // Metadata describes tests still to be implemented/executed. It is not evidence.
    const list=Array.isArray(c.config.adoptionFamilies)?c.config.adoptionFamilies.filter((f:unknown)=>typeof f==='string'&&covered.includes(f)):[];
    c.config.adoptionFamilies=[...new Set(list)];
  }
  const listed=new Set(integrated.flatMap(c=>c.config.adoptionFamilies as string[]));
  integrated[0].config.adoptionFamilies=[...integrated[0].config.adoptionFamilies,...covered.filter(f=>!listed.has(f))];
  for(const c of integrated)if(!c.config.adoptionFamilies.length)delete c.config.adoptionFamilies;

  const unique=(base:string)=>{let k=base,n=2;while(criteria.some(c=>c.key===k))k=base+'-'+n++;return k;};
  if(!map){
    map={key:unique('adocao-liquid-glass'),kind:'FILE_EXISTS',description:'Conferir inventário, fontes originais e componentes utilizados na adoção Liquid Glass.',config:{}};
    criteria.push(map);
  }
  map.config={...map.config,capability:ref('structural'),adoption};
  if(map.kind==='FILE_EXISTS')map.config.path=manifest;

  const decisions=criteria.filter(c=>c.kind==='MANUAL_APPROVAL'&&capabilityReference(c.config)?.id===id);
  if(decisions.some(c=>capabilityReference(c.config)?.contract!==contract))fail('a decisão deve usar o mesmo contrato da Capability.');
  if(!decisions.length){
    const unbound=criteria.filter(c=>c.kind==='MANUAL_APPROVAL'&&!c.config.capability);
    if(unbound.length===1)unbound[0].config={...unbound[0].config,capability:ref('decision')};
    else criteria.push({key:unique('decisao-adocao-liquid-glass'),kind:'MANUAL_APPROVAL',description:'Avaliar a aplicação em prévia e as evidências de adoção da interface no escopo declarado.',config:{capability:ref('decision')}});
  }
  if(!adoptionOf(map.config))fail('o contrato compilado não é válido.');
  return criteria;
}
