import type { ExecutionResult } from '../../providers/provider.interface';
import { createHash } from 'node:crypto';

export type PlannerReceipt={version:1;binding:string;phase:'DISPATCHING'|'RETURNED'|'REPAIRING'|'REPAIRED';result?:ExecutionResult;repair?:ExecutionResult};
export function plannerBinding(values:readonly unknown[]):string{
  return createHash('sha256').update(JSON.stringify(values)).digest('hex');
}
function validResult(x:unknown):x is ExecutionResult{
  if(!x||typeof x!=='object')return false;
  const r=x as ExecutionResult;
  return Number.isFinite(r.exitCode)&&typeof r.output==='string'&&!r.interrupted;
}
export function readPlannerReceipt(value:unknown):PlannerReceipt|null{
  if(value===null||value===undefined)return null;
  if(!value||typeof value!=='object')throw Error('Recibo de planejamento inválido.');
  const r=value as PlannerReceipt;
  if(r.version!==1||typeof r.binding!=='string'||!['DISPATCHING','RETURNED','REPAIRING','REPAIRED'].includes(r.phase)
    ||(r.phase!=='DISPATCHING'&&!validResult(r.result))
    ||(r.phase==='REPAIRED'&&!validResult(r.repair)))throw Error('Recibo de planejamento inválido; não repetir chamadas.');
  return r;
}
export function plannerCost(result:ExecutionResult):number{
  return typeof result.costUsd==='number'&&Number.isFinite(result.costUsd)&&result.costUsd>=0?result.costUsd:0;
}
export function plannerReplay(receipt:PlannerReceipt|null,binding:string):ExecutionResult|null{
  if(!receipt)return null;
  if(receipt.binding!==binding)throw Error('A configuração do planejamento mudou; resposta anterior preservada.');
  if(receipt.phase==='DISPATCHING')throw Error('A chamada anterior não possui recibo de retorno. Não repetir automaticamente.');
  return receipt.result!;
}
