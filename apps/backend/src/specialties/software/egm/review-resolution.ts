import { createHash } from 'node:crypto';
import type { GoldfishRunResult } from './review-pipeline';
import upstream from './resolution-upstream.json';

export type Severity='Blocker'|'Major'|'Nit';
export type Finding={id:string;stage:number;reviewer:string;severity:Severity;scope:string;description:string;rationale:string;recommendation:string};
export type Action={id:string;severity:Severity;scope:string;description:string;rationale:string;recommendation:string;findingIds:string[]};
export type ResolutionLedger={version:1;revision:string;targetPath:string;sourceRevision:string;reviewStatus:GoldfishRunResult['status'];coverage:GoldfishRunResult['coverage'];findings:Finding[];actions:Action[];unstructured:string[];notRun:string[];ready:boolean};
const digest=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const nonempty=(v:unknown,max:number):v is string=>typeof v==='string'&&v.trim().length>0&&v.length<=max;
const obj=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const severityRank={Blocker:0,Major:1,Nit:2};

export function resolutionSource(path:string):string{
  const file=upstream.files.find(f=>f.path===path);
  if(!file)throw Error('Fonte de resolução EGM ausente.');
  const bytes=Buffer.from(file.content,'utf8');
  if(createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex')!==file.sha)throw Error('Fonte EGM alterada.');
  return file.content;
}

/** Preserve the original natural-language report. A separate explicit JSON
 * appendix avoids guessing findings from prose or declaring malformed reports clean. */
export const FINDINGS_CONTRACT=[
  'Depois do parecer Markdown original, acrescente exatamente um bloco delimitado por GOLD_FISH_FINDINGS_BEGIN e GOLD_FISH_FINDINGS_END (cada marcador em sua própria linha, sem cercas Markdown).',
  'Entre os marcadores escreva JSON: {"findings":[{"severity":"Blocker|Major|Nit","scope":"seção/linhas","description":"divergência","rationale":"evidência e razão","recommendation":"proposta"}]}. Use uma das três severidades exatas; mantenha todos os achados originais.',
  'Use {"findings":[]} somente quando não houver nenhum achado. Não transforme limitações de cobertura em ausência de defeitos. A recomendação é uma proposta, não autorização de alteração.',
].join('\n');

export function parseReviewFindings(report:string):Omit<Finding,'id'|'stage'|'reviewer'>[]|null{
  const markers=Array.from(report.matchAll(/^GOLD_FISH_FINDINGS_BEGIN[ \t]*\r?$\n([\s\S]*?)^GOLD_FISH_FINDINGS_END[ \t]*\r?$/gm));
  if(markers.length!==1||markers[0][1].length>120000||report.slice(markers[0].index!+markers[0][0].length).trim())return null;
  let data:unknown;
  try{data=JSON.parse(markers[0][1]);}catch{return null;}
  if(!obj(data)||!Array.isArray(data.findings)||data.findings.length>60)return null;
  const findings:Omit<Finding,'id'|'stage'|'reviewer'>[]=[];
  for(const f of data.findings){
    if(!obj(f)||!['Blocker','Major','Nit'].includes(String(f.severity))||!nonempty(f.scope,1000)||!nonempty(f.description,4000)||!nonempty(f.rationale,6000)||!nonempty(f.recommendation,6000))return null;
    findings.push({severity:f.severity as Severity,scope:f.scope.trim(),description:f.description.trim(),rationale:f.rationale.trim(),recommendation:f.recommendation.trim()});
  }
  return findings;
}

/** Conservative consolidation: merge only identical normalized findings,
 * never silently suppress a merely similar or disputed finding. */
export function consolidateGoldfish(run:GoldfishRunResult,targetPath:string):ResolutionLedger{
  const findings:Finding[]=[],actionsByKey=new Map<string,Action>(),unstructured:string[]=[],notRun:string[]=[];
  for(const phase of run.phases){
    for(const reviewer of phase.reviewers){
      const key=phase.stage+':'+reviewer.role;
      if(reviewer.status!=='completed'||!reviewer.report){notRun.push(key);continue;}
      const items=parseReviewFindings(reviewer.report);
      if(!items){unstructured.push(key);continue;}
      for(let i=0;i<items.length;i++){
        const item=items[i],id='GF-'+phase.stage+'-'+reviewer.role.replace(/^egm-/,'')+'-'+(i+1);
        findings.push({...item,id,stage:phase.stage,reviewer:reviewer.role});
        const fingerprint=digest([item.severity,item.scope,item.description,item.rationale,item.recommendation].map(x=>x.replace(/\s+/g,' ').trim()));
        const previous=actionsByKey.get(fingerprint);
        if(previous)previous.findingIds.push(id);
        else actionsByKey.set(fingerprint,{...item,id:'ACT-'+fingerprint.slice(0,20),findingIds:[id]});
      }
    }
  }
  for(const s of run.pendingStages)if(!run.phases.some(p=>p.stage===s))notRun.push('fase '+s);
  const actions=[...actionsByKey.values()].sort((a,b)=>severityRank[a.severity]-severityRank[b.severity]||a.id.localeCompare(b.id));
  return {version:1,revision:run.revision,targetPath,sourceRevision:upstream.revision,reviewStatus:run.status,coverage:run.coverage,findings,actions,unstructured,notRun,ready:run.status==='complete'&&!unstructured.length&&!notRun.length};
}
export function renderResolutionLedger(ledger:ResolutionLedger):string{
  return ['## Achados consolidados — rastreabilidade',
    'Estado: '+(ledger.ready?'consolidação estruturada disponível; nenhuma correção aplicada':'cobertura incompleta; não interpretar como ausência de defeitos'),
    'Achados: '+ledger.findings.length+'; ações distintas: '+ledger.actions.length,
    ...(ledger.notRun.length?['Revisores/fases não executados: '+ledger.notRun.join(', ')]:[]),
    ...(ledger.unstructured.length?['Pareceres sem apêndice estruturado válido (texto preservado): '+ledger.unstructured.join(', ')]:[]),
    ...ledger.actions.map(a=>'- **'+a.id+' — '+a.severity+'** · '+a.scope+'\n  '+a.description+'\n  Evidência/racional: '+a.rationale+'\n  Recomendação: '+a.recommendation+'\n  Origem: '+a.findingIds.join(', ')),
    'Nenhum achado está resolvido, aceito ou contestado por esta consolidação.',
  ].join('\n');
}
