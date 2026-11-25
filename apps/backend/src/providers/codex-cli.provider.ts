import { nativeImageTarget, prepareNativeImage, recoverNativeImage, resolveVisualReferences, imageEventPath, imageEventBytes, imageEventFailure, isCodexAccount, visualReceiptKey, recordVisualReceipt, reuseVisualReceipt, publishVisualPreview } from './codex-image-assets';
import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import { argsCodex } from '../mcp/para-ia';
import { isolatedHome } from '../accounts/secrets';
import { minimalEnv, runProcess } from '../common/exec';
import {
  AiProvider,
  buildPrompt,
  ExecutionRequest,
  ExecutionResult,
  looksLikeResourceProblem,
  ProviderStatus,
} from './provider.interface';

/**
 * OpenAI Codex CLI (`codex exec`) usando o login oficial existente (`codex login`) no host do worker.
 * Sandbox do próprio Codex: workspace-write (escrita restrita ao diretório de trabalho).
 */
/** Erro do isolamento do Codex (bubblewrap/landlock/namespaces), não do comando em si. */
const SANDBOX_QUEBRADO = /bwrap|bubblewrap|landlock|sandbox|uid_?map|unshare|namespace|Operation not permitted|seccomp/i;

@Injectable()
export class CodexCliProvider implements AiProvider {
  /** Um evento do `codex exec --json` em linha de log legível. */
  static logEvento(line: string, onLog: ExecutionRequest['onLog']): void {
    if (!line.trim()) return;
    let ev: any;
    try {
      ev = JSON.parse(line);
    } catch {
      onLog(line.slice(0, 500));
      return;
    }
    const it = ev.item ?? {};
    if (ev.type === 'item.completed') {
      if (it.type === 'command_execution') onLog(`[comando] ${String(it.command ?? '').slice(0, 300)}`);
      else if (it.type === 'file_change') onLog(`[arquivos] ${(it.changes ?? []).map((c: any) => `${c.kind ?? ''} ${c.path ?? ''}`.trim()).join(', ').slice(0, 300)}`);
      else onLog(`[${it.type}] ${String(it.text ?? it.command ?? '').slice(0, 500)}`);
    } else if (ev.type === 'error' || ev.type === 'turn.failed') onLog(`[erro] ${JSON.stringify(ev.error ?? ev.message ?? ev).slice(0, 300)}`, 'WARN');
  }

  readonly id: string = 'codex-cli';
  readonly label: string = 'ChatGPT (conta)';
  readonly kind = 'cli' as const;
  protected readonly bin = process.env.NIVOO_CODEX_BIN ?? 'codex';
  protected readonly passKeys = ['CODEX_HOME'];

  /** Conexão adicional (ex.: "ChatGPT 2"): id próprio, nome dado pelo usuário, credenciais e pasta próprias. */
  conexao: string | null = null;

  /** Instância desta IA para uma conexão adicional. */
  paraConexao(id: string, nome: string): this {
    const p = new (this.constructor as new () => this)();
    Object.assign(p, { id, label: nome, conexao: id });
    return p;
  }

  /** Ambiente do CLI. Conta: CODEX_HOME padrão do serviço (login com a conta do ChatGPT). */
  env(extra: Record<string, string> = {}) {
    if (this.conexao) return minimalEnv({ CODEX_HOME: isolatedHome(this.conexao), ...extra });
    return minimalEnv(extra, this.passKeys);
  }

  /** Conta: login feito com a conta do ChatGPT (não com chave de API). */
  protected loggedIn(exitCode: number | null, out: string): boolean {
    return exitCode === 0 && !/api key/i.test(out);
  }

  async checkAvailability(): Promise<ProviderStatus> {
    const base: ProviderStatus = {
      id: this.id,
      label: this.label,
      kind: this.kind,
      available: false,
      installed: false,
      authenticated: false,
      limits: { observacao: 'limites do plano ChatGPT/OpenAI da conta; erros de limite causam reagendamento' },
      capabilities: ['editar-codigo', 'executar-ferramentas', 'sandbox-workspace-write'],
      errors: [],
      checkedAt: new Date().toISOString(),
      isAi: true,
    };
    const env = this.env();
    const v = await runProcess(this.bin, ['--version'], { cwd: process.cwd(), env, timeoutMs: 15000 });
    if (v.exitCode !== 0) {
      base.errors.push(v.spawnError ? `CLI não encontrado (${this.bin})` : v.stderr.trim());
      return base;
    }
    base.installed = true;
    base.version = v.stdout.trim();
    const s = await runProcess(this.bin, ['login', 'status'], { cwd: process.cwd(), env, timeoutMs: 15000 });
    base.authenticated = this.loggedIn(s.exitCode, `${s.stdout}\n${s.stderr}`);
    if (!base.authenticated) base.errors.push('não conectado (conecte em Conexões)');
    base.available = base.authenticated === true;
    if(base.available&&isCodexAccount(this.id)){
      const features=await runProcess(this.bin,['features','list'],{cwd:process.cwd(),env,timeoutMs:15000});
      if(features.exitCode===0&&/^\s*image_generation\s+/m.test(features.stdout)){
        base.capabilities.push('imagegen-native-adapter');
      }else{
        base.limits.imagegen='A CLI não anunciou a feature image_generation; a geração nativa não será oferecida automaticamente.';
      }
    }
    return base;
  }

  async execute(req: ExecutionRequest): Promise<ExecutionResult> {
    // project_doc_max_bytes=0: não carrega AGENTS.md do workspace (canal de contexto fora do prompt auditado).
    const args = ['exec', '--json', '--sandbox', 'workspace-write', '--skip-git-repo-check', '-c', 'project_doc_max_bytes=0', '-C', req.cwd];
    const target = nativeImageTarget(req.options?.visualAsset);
    const env = this.env({ NIVOO_OUTPUT_DIR: req.outputDir, NIVOO_JOB_ID: req.jobId });
    const startedAt = Date.now();
    const savedPaths:string[]=[];
    const inlineImages:Buffer[]=[];
    const imageFailures:string[]=[];
    let attachedReferences:string[]=[];
    let receipt:string|undefined;
    let nativeThread:string|undefined;
    const observe=(line:string)=>{
      try{
        const ev=JSON.parse(line);
        if(ev.type==='thread.started'&&typeof ev.thread_id==='string')nativeThread=ev.thread_id;
        if(target){const p=imageEventPath(ev);if(p&&!savedPaths.includes(p))savedPaths.push(p);const bytes=imageEventBytes(ev);if(bytes&&!inlineImages.some(b=>b.equals(bytes))&&inlineImages.length<2)inlineImages.push(bytes);const failure=imageEventFailure(ev);if(failure&&!imageFailures.includes(failure))imageFailures.push(failure);}
      }catch{/* non-JSON log */}
      CodexCliProvider.logEvento(line,req.onLog);
    };
    try{
      attachedReferences=[...new Set([...resolveVisualReferences(req.options?.visualReferences,req.cwd,req.projectMediaDir),...(req.options?.images??[])])];
      if(target){
        if(!isCodexAccount(this.id))throw new Error('A produção nativa de imagem exige a conexão Codex por conta selecionada.');
        if(attachedReferences.length>5)throw new Error('ImageGen aceita até cinco imagens de referência por etapa.');
        // Identity includes actual reference bytes, not merely their filenames.
        const referenceHashes=attachedReferences.map(file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex'));
        receipt=visualReceiptKey(req.jobId,req.stepId,this.id,JSON.stringify([req.instructions,referenceHashes,req.options?.model??process.env.NIVOO_CODEX_MODEL]),target);
        if(await reuseVisualReceipt(req.cwd,target,receipt)){
          publishVisualPreview(req.cwd,req.outputDir,target);
          req.onLog('ImageGen: ativo já produzido nesta etapa; retomada sem nova geração.');
          return {exitCode:0,output:'Ativo visual recuperado: '+target.arquivo,stopReason:'completed'};
        }
        prepareNativeImage(req.cwd,target);
        args.unshift('--enable','image_generation');
      }
      for(const img of attachedReferences)args.push('--image',img);
    }catch(e){return {exitCode:1,output:'',error:'Ativo visual: '+String((e as Error).message),stopReason:'visual_asset_error'};}
    const model = req.options?.model ?? process.env.NIVOO_CODEX_MODEL;
    if (model) args.push('--model', model);
    req.onLog(`codex ${args.join(' ')} -${req.mcp?.length ? ` + ferramentas MCP: ${req.mcp.map((m) => m.nome).join(', ')}` : ''}`); // sem os segredos
    // Ferramentas MCP do projeto: só para esta execução (o config.toml da conta não muda).
    if (req.mcp?.length) args.push(...argsCodex(req.mcp));
    args.push('-');
    let pendente = '';
    const r = await runProcess(this.bin, args, {
      cwd: req.cwd,
      env,
      input: buildPrompt(req)+(target?'\n\n## Produção ImageGen nativa\nUse a ferramenta nativa image_gen (image_gen.imagegen nas versões novas) integrada à conta Codex para gerar UMA imagem PNG conforme o briefing. '+(target.transparente?'Use transparent_background=true na ferramenta; preserve o canal alfa. ':'Use transparent_background=false. ')+(attachedReferences.length?'As '+attachedReferences.length+' referências foram anexadas nesta sessão. Para gerar ou editar com fidelidade visual, passe num_last_images_to_include='+attachedReferences.length+' à ferramenta; não combine com referenced_image_paths. Preserve a identidade visual. ':'Gere a partir do briefing, sem inventar referências. ')+'Não escreva SVG, Canvas ou uma imagem simulada por código, nem chame API externa. O Nivoo importa o PNG desta sessão automaticamente para '+target.arquivo+'. Não leia arquivos fora do workspace, não tente copiar do CODEX_HOME nem repita a geração. Termine após a ferramenta produzir o resultado.':''),
      timeoutMs: req.timeoutMs,
      signal: req.signal,
      onSpawn: req.onSpawn,
      // Cada passo do agente vai para o log na hora (a tela mostra o que a IA está fazendo, sem esperar a sessão acabar).
      onStdout: (c) => {
        pendente += c;
        const linhas = pendente.split('\n');
        pendente = linhas.pop() ?? '';
        for (const l of linhas) observe(l);
      },
    });
    if (pendente.trim()) observe(pendente);
    if (r.aborted) return { exitCode: -1, output: target?'Geração interrompida':r.stdout, interrupted: true, error: 'interrompido' };
    if (r.timedOut && !target) return { exitCode: -1, output: r.stdout, error: `timeout após ${req.timeoutMs} ms` };
    if (r.spawnError) return { exitCode: -1, output: '', error: r.spawnError, resourceUnavailable: true };
    let lastMessage = '';
    let sessionId: string | undefined;
    let inputTokens: number | undefined;
    let outputTokens: number | undefined;
    let cacheReadInputTokens:number|undefined;
    const errors: string[] = [];
    let comandosOk = 0;
    const bloqueios: string[] = [];
    for (const line of r.stdout.split('\n')) {
      if (!line.trim()) continue;
      try {
        const ev = JSON.parse(line);
        if (ev.type === 'thread.started') sessionId = ev.thread_id ?? sessionId;
        if (ev.type === 'item.completed' && ev.item?.type === 'agent_message') lastMessage = ev.item.text ?? lastMessage;
        if (ev.type === 'turn.completed' && ev.usage) {
          inputTokens = ev.usage.input_tokens;
          outputTokens = ev.usage.output_tokens;
          cacheReadInputTokens = ev.usage.cached_input_tokens;
        }
        if (ev.type === 'error' || ev.type === 'turn.failed') errors.push(JSON.stringify(ev.error ?? ev.message ?? ev));
        if (ev.type === 'item.completed' && ev.item?.type === 'command_execution') {
          const saida = String(ev.item.aggregated_output ?? ev.item.output ?? '');
          const falhou = ev.item.status === 'failed' || (typeof ev.item.exit_code === 'number' && ev.item.exit_code !== 0);
          if (falhou && SANDBOX_QUEBRADO.test(saida)) bloqueios.push(saida.trim().split('\n')[0].slice(0, 200));
          else if (!falhou) comandosOk++;
        }
      } catch {
        /* linha não-JSON: já foi para o log durante a sessão */
      }
    }
    // Nenhum comando conseguiu rodar porque o isolamento do Codex não funciona neste servidor: nenhuma sessão
    // nova resolve. Vira "IA indisponível" com o motivo (a reserva assume, se houver), não sessão após sessão.
    if (!target && bloqueios.length && comandosOk === 0) {
      return {
        exitCode: 1,
        output: lastMessage,
        error: `o ChatGPT não conseguiu rodar nenhum comando neste servidor: o isolamento dele (sandbox) foi bloqueado (${bloqueios[0]}). No servidor, rode "nivoo update" (libera o isolamento para o worker); enquanto isso, use outra IA no projeto`,
        resourceUnavailable: true,
        sessionId,
        stopReason: 'sandbox',
        inputTokens,
        outputTokens,
      cacheReadInputTokens,
      };
    }
    if(target){
      try{
        const file=await recoverNativeImage(env,req.cwd,target,nativeThread??sessionId,savedPaths,startedAt,inlineImages);
        if(receipt)recordVisualReceipt(req.cwd,target,receipt);
        publishVisualPreview(req.cwd,req.outputDir,target);
        req.onLog('ImageGen: PNG recuperado e decodificado em '+file);
        return {exitCode:0,output:'Ativo visual produzido: '+file,sessionId:nativeThread??sessionId,inputTokens,outputTokens,cacheReadInputTokens,stopReason:'completed'};
      }catch(e){
        const detail=String((e as Error).message);
        const providerError=[...imageFailures,...errors,r.stderr].filter(Boolean).join('; ');
        const unavailable=looksLikeResourceProblem(providerError)||/usage.?limit.?exceeded/i.test(providerError);
        return {exitCode:1,output:lastMessage,error:'ImageGen: '+detail+(providerError.trim()?' — '+providerError.slice(0,500):''),sessionId:nativeThread??sessionId,inputTokens,outputTokens,cacheReadInputTokens,resourceUnavailable:unavailable,stopReason:'visual_asset_error'};
      }
    }
    const failed = r.exitCode !== 0 || errors.length > 0;
    const errText = failed ? `${errors.join('; ')} ${r.stderr.slice(0, 500)}`.trim() : undefined;
    return {
      exitCode: failed ? r.exitCode || 1 : 0,
      output: lastMessage || r.stdout.slice(-4000),
      error: errText,
      resourceUnavailable: failed && looksLikeResourceProblem(errText ?? ''),
      sessionId,
      stopReason: failed ? 'erro' : 'completed',
      inputTokens,
      outputTokens,
      cacheReadInputTokens,
    };
  }
}

/**
 * ChatGPT com chave de API da OpenAI (cobrança por uso). Mesmo CLI; CODEX_HOME próprio, onde a chave é
 * registrada pelo comando oficial `codex login --with-api-key` — não mexe no login da conta.
 */
@Injectable()
export class CodexApiProvider extends CodexCliProvider {
  readonly id: string = 'codex-api';
  readonly label: string = 'ChatGPT (API)';

  env(extra: Record<string, string> = {}) {
    return minimalEnv({ CODEX_HOME: isolatedHome(this.conexao ?? 'codex-api'), ...extra });
  }

  protected loggedIn(exitCode: number | null): boolean {
    return exitCode === 0;
  }
}
