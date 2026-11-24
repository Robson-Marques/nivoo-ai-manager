import { BadRequestException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { ProviderRegistry } from '../../providers/provider-registry.service';
import { optString,reqString } from '../../common/validate';
import { evaluatePolicy } from '../../security/policy';
import { RULE_REVIEW_STEP } from '../rule-review';
import { erroDeComandoLocal } from '../executor-priority';
import { conferenciaTecnicaDeVideo,customMediaVerification } from '../video-step-verification';
import { mediaDeliveries } from '../../specialties/media/delivery';
import { validarSaidaMotion } from './media-paths';
import { opcoesDeVideo,opcoesDeJuncao,narracaoValida } from './media-options';
import { imageOptions } from '../../providers/image-options';
import { operacoesDeArquivos } from './file-options';

export function normalizarInstrucaoDeEtapa(texto: string, provider: string, origem: string): string {
  return provider === 'local-shell' ? validarSaidaMotion(texto, origem) : texto;
}

export interface StepInput {
  key: string;
  title: string;
  instructions: string;
  provider?: string;
  dependsOn: string[];
  verifyCommand?: string;
  requiresApproval: boolean;
  providerOptions: Prisma.InputJsonValue;
}

export function parseSteps(registry: Pick<ProviderRegistry,'has'|'get'>, raw: unknown, defaultProvider: string, existingKeys: string[] = []): StepInput[] {
    if (!Array.isArray(raw)) throw new BadRequestException('steps deve ser uma lista');
    const steps: StepInput[] = raw.map((s: any) => {
      const key = reqString(s, 'key', 60);
      if (!/^[a-z0-9][a-z0-9_-]*$/i.test(key)) throw new BadRequestException(`Chave de etapa inválida: ${key}`);
      if (key === RULE_REVIEW_STEP) throw new BadRequestException(`A etapa ${RULE_REVIEW_STEP} é criada pelo sistema`);
      const rawInstructions = reqString(s, 'instructions', 100000);
      const rawVerifyCommand = optString(s, 'verifyCommand', 5000);
      const provider = optString(s, 'provider', 60);
      // O texto de uma etapa de IA NÃO é um script: pode citar comandos,
      // erros antigos e caminhos inválidos como parte da análise.
      // Validar/normalizar comandos SOMENTE quando serão executados como Bash.
      const instructions = normalizarInstrucaoDeEtapa(rawInstructions, provider ?? defaultProvider, `Etapa ${key} (instruções)`);
      const verifyCommand = rawVerifyCommand ? validarSaidaMotion(rawVerifyCommand, `Etapa ${key} (conferência)`) : undefined;
      if ((provider ?? defaultProvider) === 'local-shell') {
        const invalido = erroDeComandoLocal(instructions);
        if (invalido) throw new BadRequestException(`Etapa ${key}: ${invalido}`);
      }
      if (provider && !registry.has(provider)) throw new BadRequestException(`Conector desconhecido: ${provider}`);
      // Etapas executadas por IA precisam de verificação determinística: o agente não encerra a etapa sozinho.
      if (registry.get(provider ?? defaultProvider).kind !== 'executor' && !verifyCommand) {
        throw new BadRequestException(`Etapa ${key} usa conector de IA e exige verifyCommand (verificação determinística)`);
      }
      const opts = s.providerOptions ?? {};
      const providerOptions: Record<string, unknown> = {};
      if (opts.model !== undefined) providerOptions.model = String(opts.model).slice(0, 100);
      if (opts.maxTurns !== undefined) {
        const n = Number(opts.maxTurns);
        if (!Number.isInteger(n) || n < 1 || n > 500) throw new BadRequestException(`Etapa ${key}: maxTurns deve ser inteiro entre 1 e 500`);
        providerOptions.maxTurns = n;
      }
      // Etapa de vídeo (Omni): a descrição do vídeo é a instrução; o sistema confere que o arquivo saiu.
      let verificacao = verifyCommand;
      if ((provider ?? defaultProvider) === 'gemini-video') {
        Object.assign(providerOptions, opcoesDeVideo(key, opts));
        verificacao = verifyCommand ?? `test -s '${providerOptions.arquivo}'`;
      }
      if ((provider ?? defaultProvider) === 'gemini-image') {
        Object.assign(providerOptions, imageOptions(key, opts));
        // O próprio executor confere o PNG binário e publica o arquivo.
        verificacao = verifyCommand;
      }
      // Juntar as cenas num vídeo só (etapa do sistema, ffmpeg).
      if ((provider ?? defaultProvider) === 'juntar-videos') {
        Object.assign(providerOptions, opcoesDeJuncao(key, opts));
        // Vídeo editado em midia/ fica na pasta de mídia durável (fora do worktree): quem confere é o provider (exitCode).
        verificacao = verifyCommand ?? (String(providerOptions.arquivo).startsWith('midia/') ? 'true' : `test -s '${providerOptions.arquivo}'`);
      }
      // Gerador local de prévia: somente MP3, antes de qualquer montagem de vídeo.
      if ((provider ?? defaultProvider) === 'gerar-narracao') {
        const origem = opts.narracao && typeof opts.narracao === 'object' ? opts.narracao : opts;
        // "arquivo" em gerar-narracao é o DESTINO MP3, não um áudio de entrada.
        // O validador da locução não pode interpretá-lo como narracao.arquivo.
        const { arquivo: _saida, ...entrada } = origem;
        const validada = narracaoValida(key, { ...entrada, motor: 'kokoro' });
        if (validada.arquivo) throw new BadRequestException(`Etapa ${key}: gerar-narracao exige texto ou trechos, não arquivo pronto`);
        const arquivo = String(opts.arquivo ?? 'out/previa-locucao.mp3');
        if (!/^out\/[a-zA-Z0-9_/-]+\.mp3$/.test(arquivo) || arquivo.split('/').includes('..'))
          throw new BadRequestException(`Etapa ${key}: arquivo deve ser out/<nome>.mp3`);
        Object.assign(providerOptions, validada, { arquivo });
        if (opts.fechamentoAlternativo !== undefined) {
          const fechamento = String(opts.fechamentoAlternativo).trim();
          if (!fechamento || fechamento.length > 300 || [...'[]<>'].some(c => fechamento.includes(c)))
            throw new BadRequestException(`Etapa ${key}: fechamentoAlternativo deve ser uma frase simples com até 300 caracteres`);
          providerOptions.fechamentoAlternativo = fechamento;
        }
        verificacao = verifyCommand ?? `test -s '${arquivo}'`;
      }
      // Apagar/mover arquivos (etapa do sistema): lista validada. O "Fazer" do plano já é a confirmação, e o
      // git guarda tudo (dá para voltar qualquer arquivo) — não pede uma segunda confirmação.
      if ((provider ?? defaultProvider) === 'arquivos-projeto') {
        Object.assign(providerOptions, operacoesDeArquivos(key, opts));
        const r = (providerOptions.remover as string[]).map((p) => `test ! -e '${p}'`);
        const m = (providerOptions.mover as Array<{ para: string }>).map((x) => `test -e '${x.para}'`);
        verificacao = verifyCommand ?? ([...r, ...m].join(' && ') || 'true');
      }
      const deliveries=mediaDeliveries(provider??defaultProvider,instructions,providerOptions,key);
      verificacao=deliveries.length?customMediaVerification(provider??defaultProvider,instructions,providerOptions,deliveries.map(d=>d.path),verificacao):conferenciaTecnicaDeVideo(provider??defaultProvider,instructions,providerOptions,verificacao);
      if(deliveries.length&&(provider??defaultProvider)==='gemini-video'&&!verificacao)verificacao='true';
      // Política sobre o que vai RODAR: comandos (verificação; instruções só de etapa de comando). Instrução de IA é texto
      // — "não use rm -rf" ou um achado citando DELETE FROM não é uma ação destrutiva.
      const ehComando = (provider ?? defaultProvider) === 'local-shell';
      const pol = evaluatePolicy(`${ehComando ? instructions : ''}\n${verificacao ?? ''}`);
      return {
        key,
        title: optString(s, 'title', 300) ?? key,
        instructions,
        provider,
        dependsOn: Array.isArray(s.dependsOn) ? s.dependsOn.map(String) : [],
        verifyCommand: verificacao,
        requiresApproval: s.requiresApproval === true || pol.requiresApproval || (provider ?? defaultProvider) === 'gemini-image',
        providerOptions: providerOptions as Prisma.InputJsonValue,
      };
    });
    const keys = new Set(existingKeys);
    for (const s of steps) {
      if (keys.has(s.key)) throw new BadRequestException(`Etapa duplicada: ${s.key}`);
      keys.add(s.key);
    }
    for (const s of steps) {
      for (const d of s.dependsOn) if (!keys.has(d)) throw new BadRequestException(`Etapa ${s.key} depende de etapa inexistente: ${d}`);
    }
    return steps;
  }

