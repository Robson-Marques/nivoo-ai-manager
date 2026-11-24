import type { Job,Step } from '@prisma/client';
import type { ExecutionResult } from '../../providers/provider.interface';
import type { ExecutionLog } from './types';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { referenciasDaConferencia,variaveisDaConferencia } from '../../accounts/secrets';
import { getGitAccount } from '../../git/git-accounts';
import { ambienteDaConferencia,portaLivre,faltaCredencial,problemaDoAmbiente,runProcess,semLockfile } from '../../common/exec';
import { prepararBancoDeTeste } from '../../common/banco-de-teste';
import { conferenciaTecnicaDeVideo,customMediaVerification } from '../../jobs/video-step-verification';
import { inspectMediaDelivery } from '../../jobs/native-video-result';
import { mediaDeliveries } from '../../specialties/media/delivery';
import { conferenciaGrepAlternativasLegada } from '../../jobs/verification-legacy-grep';
import { diagnosticoParecerVisual } from '../../jobs/motion-capture-freshness';
import { RULE_REVIEW_STEP,RULE_REVIEW_STEP_CHECK } from '../../jobs/rule-review';
import { normalizeMotionOutputs } from '../../jobs/motion/command';
import { replaceMediaAliases } from '../../jobs/workflow/media-paths';
import { resolveInside } from '../../common/path-guard';

/**
 * Conferência que falhou sem mensagem: o comando e, para `test -f/-s/-e/-d <arquivo>` e `grep -q <texto> <arquivo>`,
 * o que de fato falta na pasta do trabalho.
 */
export function explicarConferencia(comando: string, pasta: string): string {
  const faltas: string[] = [];
  for (const m of comando.matchAll(/test\s+(!\s+)?-([fsed])\s+('([^']+)'|"([^"]+)"|(\S+))/g)) {
    const neg = !!m[1];
    const arq = m[4] ?? m[5] ?? m[6];
    let abs:string;
    try { abs=resolveInside(pasta,arq); } catch { continue; }
    const existe = fs.existsSync(abs);
    if (!neg && !existe) faltas.push(`falta ${arq}`);
    else if (!neg && m[2] === 's' && existe && fs.statSync(abs).size === 0) faltas.push(`${arq} está vazio`);
    else if (neg && existe) faltas.push(`${arq} ainda existe`);
  }
  for (const m of comando.matchAll(/grep\s+(?:-[a-zA-Z]+\s+)*('([^']+)'|"([^"]+)"|(\S+))\s+('([^']+)'|"([^"]+)"|(\S+))/g)) {
    const texto = m[2] ?? m[3] ?? m[4];
    const arq = m[6] ?? m[7] ?? m[8];
    let abs:string;
    try { abs=resolveInside(pasta,arq); } catch { continue; }
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) continue;
    if (!fs.readFileSync(abs, 'utf8').includes(texto)) faltas.push(`${arq} não contém "${texto}"`);
  }
  return `o comando de conferência falhou sem mensagem: ${comando.slice(0, 300)}${faltas.length ? ` — ${faltas.join('; ')}` : ''}`;
}


/** Existing technical verification only. Never changes the job, retries an AI, or schedules another step. */
export async function verifyExecution(job:Job,step:Step,providerId:string,isAi:boolean,result:ExecutionResult,worktree:string,outputDir:string,mediaDir:string,attempt:{id:string},signal:AbortSignal,L:ExecutionLog){
    // Verificação determinística da etapa (não decide conclusão do job).
    // Etapa de revisão: basta o relatório (vale também para trabalhos criados antes, que guardaram a conferência antiga).
    const deliveries=mediaDeliveries(providerId,step.instructions,(step.providerOptions??{}) as Record<string,unknown>,step.key);
    // Native connectors validate the physical result here, not via a second shell.
    const verifyCommand=deliveries.length?customMediaVerification(providerId,step.instructions,(step.providerOptions??{}) as Record<string,unknown>,deliveries.map(d=>d.path),step.verifyCommand??undefined):
      step.key===RULE_REVIEW_STEP?RULE_REVIEW_STEP_CHECK:
      conferenciaTecnicaDeVideo(providerId,step.instructions,(step.providerOptions??{}) as Record<string,unknown>,step.verifyCommand??undefined);
    let verifyCommandEfetivo = verifyCommand ?? ''; // o que realmente roda (o sistema pode curar npm ci sem lockfile)
    // O renderizador motion grava exclusivamente em midia/saida/. Planos antigos
    // podem pedir --saida out/*.mp4 em verifyCommand; corrigir aqui evita abrir
    // novas sessões de IA para tentar alterar um comando imutável no banco.
    const normalized=normalizeMotionOutputs(verifyCommandEfetivo);
    const saidaMotionCorrigida=Object.entries(normalized.aliases).map(([old,next])=>old+' → '+next).join(', ');
    verifyCommandEfetivo=replaceMediaAliases(normalized.command,normalized.aliases);
    let verified = !verifyCommand;
    let falhaTecnicaDaMidia: string | null = null;
    if(deliveries.length&&result.exitCode===0&&!result.interrupted&&!result.resourceUnavailable){
      for(const delivery of deliveries){
        const check=inspectMediaDelivery(mediaDir,worktree,delivery);
        if(!check.ok){
          verified=false;
          falhaTecnicaDaMidia=check.detail;
          result={...result,exitCode:1,error:'Mídia tecnicamente inválida: '+check.detail};
          await L('Mídia tecnicamente inválida: '+check.detail,'ERROR',attempt.id);
          break;
        }
        await L('ARQUIVO PRONTO — '+check.detail,'INFO',attempt.id);
      }
    }
    let faltaPrograma: string | null = null;
    let ambiente: string | null = null; // falha do servidor do Nivoo (não do projeto): nenhuma sessão resolve
    let credencialFaltando: string | null = null; // registro de pacotes privado sem token: só o usuário resolve
    if ((result.exitCode === 0 || (isAi && result.sessionEnded)) && !result.interrupted && !result.resourceUnavailable && verifyCommand) {
      if (saidaMotionCorrigida) {
        await L(`Conferência: saída motion ajustada automaticamente (${saidaMotionCorrigida}); não é necessário refazer a composição nem abrir outra sessão.`, 'WARN', attempt.id);
      }
      // Banco de teste descartável do trabalho (testes de integração do projeto).
      const banco = await prepararBancoDeTeste(job.id).catch(async (e) => {
        await L(`Banco de teste indisponível: ${e?.message ?? e}`, 'WARN', attempt.id);
        return null;
      });
      const porta = await portaLivre().catch(() => 0);
      // Variáveis da conferência: valores fixos + as que apontam para o token de uma conta Git conectada
      // (resolvido aqui; o token nunca entra na sessão da IA, só na conferência).
      const envDaConferencia: Record<string, string> = { ...variaveisDaConferencia(job.projectId) };
      for (const [nome, contaId] of Object.entries(referenciasDaConferencia(job.projectId))) {
        try {
          envDaConferencia[nome] = getGitAccount(contaId).token;
        } catch {
          /* conta apagada: a variável fica sem valor e o 401 orienta de novo */
        }
      }
      // A conferência pode levar minutos (instalar, testar, compilar): registra o andamento para a tela não parecer
      // parada — a última linha da saída a cada 15 s e um "ainda rodando" a cada minuto.
      await L(`Conferindo a etapa (testes, build…): ${verifyCommand.replace(/\s+/g, ' ').slice(0, 200)}`, 'INFO', attempt.id);
      const inicioConferencia = Date.now();
      const avisoMs = Number(process.env.NIVOO_CONFERENCIA_AVISO_MS ?? 15_000);
      let ultimaLinha = '';
      let ultimoRegistro = Date.now();
      const anotar = (pedaco: string) => {
        const l = pedaco.split('\n').map((x) => x.replace(/\x1b\[[0-9;]*m/g, '').trim()).filter(Boolean).pop();
        if (l) ultimaLinha = l;
        if (ultimaLinha && Date.now() - ultimoRegistro > avisoMs) {
          ultimoRegistro = Date.now();
          void L(`Conferência rodando (${Math.round((Date.now() - inicioConferencia) / 60_000)} min): ${ultimaLinha.slice(0, 200)}`, 'INFO', attempt.id);
        }
      };
      const pulso = setInterval(() => {
        if (Date.now() - ultimoRegistro < avisoMs * 3.5) return;
        ultimoRegistro = Date.now();
        void L(`Conferência ainda rodando (${Math.round((Date.now() - inicioConferencia) / 60_000)} min)${ultimaLinha ? `: ${ultimaLinha.slice(0, 160)}` : ''}`, 'INFO', attempt.id);
      }, avisoMs * 4);
      const conferir = () =>
        runProcess('bash', ['-e', '-o', 'pipefail', '-c', verifyCommandEfetivo], {
          onStdout: anotar,
          onStderr: anotar,
          cwd: worktree,
          env: ambienteDaConferencia({ NIVOO_JOB_ID: job.id, NIVOO_OUTPUT_DIR: outputDir, NIVOO_PORTA_TESTE: String(porta), NIVOO_MIDIA_DIR: mediaDir, ...envDaConferencia, ...(banco?.env ?? {}) }),
          encerrarGrupoAoSair: true,
          // A conferência pode instalar dependências, rodar os testes e o build do projeto: até 30 min (configurável).
          timeoutMs: Number(process.env.NIVOO_VERIFY_TIMEOUT_SEC ?? 1800) * 1000,
          maxBuffer: 20 * 1024 * 1024,
          signal,
        });
      let v: Awaited<ReturnType<typeof conferir>>;
      try {
      v = await conferir();
      // Cache do corepack quebrado (download interrompido: "pnpm.cjs" ausente): o sistema refaz o cache e confere
      // de novo, sozinho — não é coisa que a IA conserte.
      if (v.exitCode !== 0 && !v.aborted && /corepack/i.test(`${v.stdout}${v.stderr}`) && problemaDoAmbiente(`${v.stdout}${v.stderr}`)) {
        const cache = process.env.COREPACK_HOME ?? path.join(process.env.HOME ?? os.homedir(), '.cache', 'node', 'corepack');
        fs.rmSync(cache, { recursive: true, force: true });
        await L(`Conferência: cache do corepack quebrado no servidor; refeito (${cache}) e conferindo de novo`, 'WARN', attempt.id);
        v = await conferir();
      }
      // "npm ci" sem package-lock.json (projeto que não commita o lockfile): o npm aborta com EUSAGE antes de testar.
      // A IA não tem terminal para gerar o lockfile nem pode mudar o comando: o sistema refaz a conferência com
      // "npm ci" → "npm install" (igual para yarn/pnpm "--frozen-lockfile"), uma vez. Não é falha do código.
      if (v.exitCode !== 0 && !v.aborted && semLockfile(`${v.stdout}${v.stderr}`) && /npm ci|--frozen-lockfile|--immutable/.test(verifyCommandEfetivo)) {
        verifyCommandEfetivo = verifyCommandEfetivo
          .replace(/npm ci/g, 'npm install')
          .replace(/\s--frozen-lockfile/g, '')
          .replace(/\s--immutable/g, '');
        await L('Conferência: o projeto não tem package-lock.json, então "npm ci" não roda; refiz com "npm install" (sem travar no lockfile).', 'WARN', attempt.id);
        v = await conferir();
      }
      // Planos antigos geravam grep -q 'digest\\|imageId\\|sha256' e reprovavam
      // identificadores como pulledImageDigest só pela letra D maiúscula.
      // Reexecuta apenas a checagem curta test -f && grep; nunca afrouxa
      // testes de compilação, nem conclui uma etapa sem executar o comando.
      if (v.exitCode !== 0 && !v.aborted) {
        const compativel = conferenciaGrepAlternativasLegada(verifyCommandEfetivo);
        if (compativel) {
          const original = verifyCommandEfetivo;
          verifyCommandEfetivo = compativel;
          const alternativa = await conferir();
          if (alternativa.exitCode === 0) {
            v = alternativa;
            await L('Conferência legada: marcadores alternativos encontrados ignorando apenas maiúsculas/minúsculas; o teste foi executado novamente e passou. Não substitui testes de comportamento.', 'WARN', attempt.id);
          } else {
            verifyCommandEfetivo = original;
          }
        }
      }
      } finally { clearInterval(pulso); }
      if (v.exitCode !== 0 && !v.aborted) ambiente = problemaDoAmbiente(`${v.stdout}${v.stderr}`);
      // 401/403 num registro de pacotes privado: falta um token (segredo) que a IA não pode fornecer.
      if (v.exitCode !== 0 && !v.aborted && !ambiente) credencialFaltando = faltaCredencial(`${v.stdout}${v.stderr}`);
      // Conferência que falha calada (ex.: `test -f relatorio.md`): diz qual comando falhou e, para os testes
      // de arquivo mais comuns, o que falta — a IA e o usuário precisam saber o que cobrar.
      const falhaDeParecer = v.exitCode !== 0 ? diagnosticoParecerVisual(worktree, verifyCommand) : null;
      const vOut = (`${v.stdout}${v.stderr}`.trim() ||
        (v.exitCode !== 0 ? [explicarConferencia(verifyCommand, worktree), falhaDeParecer].filter(Boolean).join(' — ') : '')).slice(-4000); // a IA precisa da causa real, não só exit 1
      // Saída inteira da conferência para a próxima sessão ler (o erro do teste costuma estar no fim de muita saída).
      try {
        fs.mkdirSync(path.join(worktree, '.nivoo'), { recursive: true });
        fs.writeFileSync(path.join(worktree, '.nivoo', 'ultima-conferencia.txt'), `$ ${verifyCommand}\n(exit ${v.exitCode})\n\n${`${v.stdout}${v.stderr}`.slice(-2_000_000)}`);
      } catch {
        /* melhor esforço */
      }
      await L(`Verificação da etapa: exit ${v.exitCode}${vOut ? ` — ${vOut}` : ''}`, v.exitCode === 0 ? 'INFO' : 'WARN', attempt.id);
      verified = v.exitCode === 0;
      // 127 = o comando da conferência não existe no servidor: nenhuma sessão vai resolver isso.
      // 127 com um programa que a PRÓPRIA conferência chama (ex.: "rg" em "rg x && …"): nenhuma sessão resolve.
      // Programa que falta dentro do projeto (ex.: jest num "npm test") a IA corrige: segue o fluxo normal.
      if (v.exitCode === 127) {
        const falta = /(\S+): (?:command not found|comando não encontrado|not found)/.exec(vOut)?.[1]?.replace(/^.*:\s*/, '') ?? '';
        const daConferencia = verifyCommand.split(/&&|\|\||;|\|/).map((x) => x.trim().replace(/^\(+\s*/, '').split(/\s+/)[0]).filter(Boolean);
        if (falta && daConferencia.includes(falta)) faltaPrograma = falta;
      }
      if (v.aborted) result = { ...result, interrupted: true };
      else if (v.exitCode !== 0) {
        result = { ...result, exitCode: result.sessionEnded ? 0 : v.exitCode ?? 1, error: `verificação da etapa falhou (exit ${v.exitCode}): ${vOut}` };
      }
    }

  return {result,verified,falhaTecnicaDaMidia,faltaPrograma,ambiente,credencialFaltando};
}
