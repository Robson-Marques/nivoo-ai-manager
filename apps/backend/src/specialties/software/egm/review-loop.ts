import { createHash } from 'node:crypto';
import type { ResolutionLedger } from './review-resolution';
import type { GoldfishPreset } from './review-pipeline';
export type LoopRecord={version:1;rootMessageId:string;parentMessageId:string|null;round:number;revision:string;targetPath:string;preset:GoldfishPreset;cleanStreak:number;status:'awaiting-resolution'|'awaiting-confirmation'|'converged'|'cap'|'incomplete';open:string[];recurring:string[];coverageLimited:boolean};
const obj=(x:unknown):x is Record<string,unknown>=>!!x&&typeof x==='object'&&!Array.isArray(x);
const hash=(s:string)=>createHash('sha256').update(s).digest('hex').slice(0,24);
const issue=(a:ResolutionLedger['actions'][number])=>hash([a.scope,a.description].map(s=>s.toLowerCase().replace(/\s+/g,' ').trim()).join('\n'));
export function loopRequest(text:string):string|null{
  const m=/^\/goldfish-loop(?:\s+([\s\S]*))?$/i.exec(text.trim());
  return m?(m[1]??'').trim():null;
}
export function readLoopRecord(value:unknown):LoopRecord{
  if(!obj(value)||value.version!==1||typeof value.rootMessageId!=='string'||!(value.parentMessageId===null||typeof value.parentMessageId==='string')||typeof value.round!=='number'||!Number.isInteger(value.round)||value.round<1||value.round>5||typeof value.revision!=='string'||typeof value.targetPath!=='string'||!['uninterrupted','feature_spec','implementation',5,6,7,9].includes(value.preset as GoldfishPreset)||typeof value.cleanStreak!=='number'||!Number.isInteger(value.cleanStreak)||value.cleanStreak<0||value.cleanStreak>value.round||!['awaiting-resolution','awaiting-confirmation','converged','cap','incomplete'].includes(String(value.status))||!Array.isArray(value.open)||value.open.some(x=>typeof x!=='string')||!Array.isArray(value.recurring)||value.recurring.some(x=>typeof x!=='string')||typeof value.coverageLimited!=='boolean')throw Error('Registro do ciclo Goldfish inválido.');
  return value as unknown as LoopRecord;
}
/** Conservative loop policy: proposals and test markers alone do not settle
 * contested findings. Repeated fixed issues reopen; Nits do not block.
 * No automatic dispatch across the human turn boundary. */
export function nextLoopRecord(input:{messageId:string;parentMessageId?:string;parent?:LoopRecord;ledger:ResolutionLedger;preset:GoldfishPreset;coverageLimited:boolean}):LoopRecord{
  const p=input.parent;
  if(p&&(p.round>=5||p.status==='converged'||p.status==='cap'||p.targetPath!==input.ledger.targetPath||p.preset!==input.preset))throw Error('Ciclo encerrado ou escopo divergente.');
  const round=(p?.round??0)+1;
  const open=[...new Set(input.ledger.actions.filter(a=>a.severity==='Blocker'||a.severity==='Major').map(issue))].sort();
  const clean=input.ledger.ready&&!input.coverageLimited&&!open.length;
  const cleanStreak=clean?(p?.cleanStreak??0)+1:0;
  const status:LoopRecord['status']=cleanStreak>=2?'converged':round>=5?'cap':!input.ledger.ready||input.coverageLimited?'incomplete':open.length?'awaiting-resolution':'awaiting-confirmation';
  return {version:1,rootMessageId:p?.rootMessageId??input.messageId,parentMessageId:input.parentMessageId??null,round,revision:input.ledger.revision,targetPath:input.ledger.targetPath,preset:input.preset,cleanStreak,status,open,recurring:open.filter(i=>p?.open.includes(i)),coverageLimited:input.coverageLimited};
}
export function assertLoopContinuation(parent:LoopRecord,ledger:ResolutionLedger,completedRepairRevision:string|null,currentRevision:string):void{
  if(parent.round>=5||parent.status==='cap'||parent.status==='converged')throw Error('Ciclo encerrado. Decida sobre os achados restantes ou inicie novo escopo explícito.');
  if(parent.targetPath!==ledger.targetPath||parent.revision!==ledger.revision||!ledger.ready)throw Error('A rodada anterior não possui consolidação válida.');
  if(parent.open.length){
    if(!completedRepairRevision||completedRepairRevision===parent.revision||currentRevision!==completedRepairRevision)throw Error('Há achados graves abertos. Conclua a correção vinculada e use a revisão incorporada antes de outra rodada.');
  }else if(currentRevision!==parent.revision&&!completedRepairRevision)throw Error('A revisão mudou fora de uma correção vinculada; reavalie o escopo.');
}
export function renderLoopRecord(r:LoopRecord,messageId:string):string{
  return ['## Ciclo Elephant-Goldfish — rodada '+r.round+'/5',
    'Estado: '+r.status+'; rodadas limpas consecutivas: '+r.cleanStreak+'; questões graves abertas: '+r.open.length+'.',
    ...(r.recurring.length?['Questões recorrentes (mesmo escopo e descrição normalizados): '+r.recurring.length+'. Não foram dadas como corrigidas.']:[]),
    ...(r.status==='converged'?['Duas rodadas limpas dentro da cobertura selecionada; não certifica todo o software.']:r.status==='cap'?['Teto de cinco rodadas atingido. Nenhuma nova revisão automática. Decida os achados restantes.']:['Não haverá nova rodada sem solicitação explícita. Depois da resolução aplicável: /goldfish-loop '+messageId]),
  ].join('\n');
}
