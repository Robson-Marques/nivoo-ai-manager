import { Injectable } from '@nestjs/common';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { validateFileOperations,preflightOperations } from '../common/file-operations';
import { AiProvider, ExecutionRequest, ExecutionResult, ProviderStatus } from './provider.interface';

/**
 * Apagar e mover arquivos do projeto como etapa do SISTEMA (as IAs editam arquivos, mas o Claude, por
 * exemplo, não tem terminal e não consegue apagar). A lista vem do plano aprovado no "Fazer" e tudo fica no
 * histórico do git (commit do trabalho; no GitHub/GitLab, se ligado) — dá para voltar qualquer arquivo.
 * Nunca mexe em .git, contexto/, .nivoo/ ou fora da pasta do trabalho.
 */

export function descreverOperacoes(o: { remover?: string[]; mover?: Array<{ de: string; para: string }> }): string {
  const partes: string[] = [];
  if (o.remover?.length) partes.push(`apagar ${o.remover.length} item(ns): ${o.remover.slice(0, 30).join(', ')}${o.remover.length > 30 ? ` … e mais ${o.remover.length - 30}` : ''}`);
  if (o.mover?.length) partes.push(`mover ${o.mover.length}: ${o.mover.slice(0, 20).map((m) => `${m.de} → ${m.para}`).join(', ')}${o.mover.length > 20 ? ' …' : ''}`);
  return partes.join('; ');
}

@Injectable()
export class ArquivosProjetoProvider implements AiProvider {
  readonly id = 'arquivos-projeto';
  readonly label = 'Apagar/mover arquivos (sistema)';
  readonly kind = 'executor' as const;

  async checkAvailability(): Promise<ProviderStatus> {
    return {
      id: this.id, label: this.label, kind: this.kind, available: true, installed: true, authenticated: true,
      limits: {}, capabilities: ['apagar-arquivos', 'mover-arquivos'], errors: [], checkedAt: new Date().toISOString(), isAi: false,
    };
  }

  async execute(req: ExecutionRequest): Promise<ExecutionResult> {
    const feitos:string[]=[],avisos:string[]=[];
    try{
      const ops=validateFileOperations(req.options);
      const {moves,removals}=preflightOperations(ops,req.cwd,req.projectMediaDir);
      // Check the whole batch before its first mutation; no invented success.
      for(const m of moves){
        if(req.signal.aborted)return {exitCode:-1,output:feitos.join('\n'),interrupted:true,error:'interrompido'};
        fs.mkdirSync(path.dirname(m.dest),{recursive:true});
        fs.renameSync(m.source,m.dest);
        feitos.push('movido: '+m.de+' → '+m.para);
      }
      for(const r of removals){
        if(req.signal.aborted)return {exitCode:-1,output:feitos.join('\n'),interrupted:true,error:'interrompido'};
        if(!fs.existsSync(r.abs)){avisos.push('já não existia: '+r.rel);continue;}
        fs.rmSync(r.abs,{recursive:true,force:true});
        feitos.push('apagado: '+r.rel);
      }
    }catch(e){
      return {exitCode:1,output:feitos.join('\n'),error:String((e as Error).message)};
    }
    for (const l of [...feitos, ...avisos]) req.onLog(l);
    return { exitCode: 0, output: [...feitos, ...avisos].join('\n') || 'nada a fazer', stopReason: 'completed' };
  }
}
