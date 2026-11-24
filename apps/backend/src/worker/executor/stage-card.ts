import { writeSessionContextFile } from '../../common/session-context-file';

interface Stage { key:string;title:string;status:string;dependsOn:string[];verifyCommand?:string|null }
interface Previous {number:number;status:string;error?:string|null;stopReason?:string|null}
interface Checkpoint {seq:number;label:string;gitCommit?:string|null}
export function previousSessions<T extends Previous>(attempts:T[]):T[]{
  return attempts.filter(a=>a.status!=='EXECUTANDO').sort((a,b)=>b.number-a.number);
}
/** A fresh, bounded handoff from persisted facts. No LLM summary or second
 * memory store. The complete original objective and criteria remain in prompt. */
export function stageCard(stage:Stage,stages:Stage[],attempts:Previous[],checkpoint?:Checkpoint|null,stepCheckpoint?:Checkpoint|null):string{
  const prior=previousSessions(attempts);
  const deps=stages.filter(s=>stage.dependsOn.includes(s.key));
  const last=prior[0];
  return [
    '# Estado desta etapa (gerado pelo Nivoo, não editar)',
    'Etapa: '+stage.key+' — '+stage.title,
    'Dependências: '+(deps.map(s=>s.key+'='+s.status).join(', ')||'nenhuma'),
    'Etapas concluídas: '+(stages.filter(s=>s.status==='CONCLUIDO').map(s=>s.key).join(', ')||'nenhuma'),
    'Última tentativa anterior: '+(last?'#'+last.number+' '+last.status+' — '+(last.error??last.stopReason??'sem erro registrado').slice(0,700):'nenhuma'),
    'Checkpoint: '+(checkpoint?'#'+checkpoint.seq+' '+checkpoint.label+'; commit '+(checkpoint.gitCommit??'não registrado'):'nenhum'),
    ...(stepCheckpoint&&stepCheckpoint.seq!==checkpoint?.seq?['Checkpoint desta etapa: #'+stepCheckpoint.seq+' '+stepCheckpoint.label+'; commit '+(stepCheckpoint.gitCommit??'não registrado')]:[]),
    'Verificação: '+(stage.verifyCommand??'contrato do executor').slice(0,1200),
    'Use estes fatos para continuar. Confirme os arquivos necessários no worktree; estado não prova que um arquivo ainda existe. Não refaça etapas concluídas sem necessidade do pedido.',
  ].join('\n');
}
export function writeStageCard(worktree:string,card:string):void{
  writeSessionContextFile(worktree,'estado-etapa.md',card+'\n');
}
