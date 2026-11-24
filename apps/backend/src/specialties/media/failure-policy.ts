import { erroDeterministicoMotion } from '../../worker/deterministic-media-errors';
import type { ExecutionResult } from '../../providers/provider.interface';

/** Only media-specific failure decisions belong here. The worker owns persistence. */
export interface MediaFailure {
  kind:'asset'|'scene'|'contract';
  log:string;
  checkpoint:string;
  detail:string;
}
export function classifyMediaFailure(provider:string, attemptStatus:string, result:Pick<ExecutionResult,'error'|'output'>):MediaFailure|null {
  if(attemptStatus==='SUCESSO'||provider!=='local-shell')return null;
  const output=(result.error??'')+'\n'+(result.output??'');
  if(/MOTION_MIDIA_AUSENTE:/.test(output)){
    const detail=output.match(/MOTION_MIDIA_AUSENTE:[^\n]*/)?.[0]??'Fotografia essencial ausente';
    return {kind:'asset',log:'RENDERIZAÇÃO: '+detail+'. Não repetir a etapa nem chamar IA.',
      checkpoint:'foto essencial não carregou; composição e quadros preservados',
      detail:'Falha real de mídia no renderizador: '+detail+'. Nenhum MP4 incompleto será publicado. A composição está preservada.'};
  }
  const scene=erroDeterministicoMotion(output);
  if(scene)return {kind:'scene',log:'MOTION CORE: rejeição determinística na primeira tentativa: '+scene,
    checkpoint:'composição preservada; renderizador rejeitou um parâmetro',
    detail:'O renderizador local rejeitou um parâmetro da composição: '+scene+'. A composição e os arquivos originais foram preservados. Não repetir comando idêntico nem chamar IA para recriar a arte.'};
  if(/MOTION_CONTRATO:/.test(output)){
    const cause=(output.match(/MOTION_CONTRATO:[^\n]*/)?.[0]??output).slice(0,1700);
    return {kind:'contract',log:'CONTRATO MOTION: a fonte não corresponde ao motor escolhido. Sem nova tentativa automática. '+cause,
      checkpoint:'fonte motion fora do contrato do motor',
      detail:'A composição ainda não foi preparada corretamente para o motor Nivoo. '+cause+'. Arquivos preservados, sem renderização nem loop de conferência. O Nivo precisa corrigir a fonte da etapa, não pedir ao usuário para depurar ferramentas.'};
  }
  return null;
}
