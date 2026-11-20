import { Injectable } from '@nestjs/common';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { minimalEnv, runProcess } from '../common/exec';
import { resolveInside } from '../common/path-guard';
import { KokoroTtsError, KokoroTtsService, roteiroEmUmaFala, frasesDeLocucao, velocidadePadraoLocucao, RitmoLocucao } from './kokoro-tts.service';
import { VOZ_PADRAO_KOKORO } from './vozes';
import { AiProvider, ExecutionRequest, ExecutionResult, ProviderStatus } from './provider.interface';

type Frase = { texto: string; intencao?: 'chamada' | 'destaque' | 'pergunta' | 'natural'; velocidade?: number; pausaAposMs?: number };
type Opcoes = { arquivo?: string; texto?: string; trechos?: Frase[]; voz?: string; velocidade?: number; ritmo?: RitmoLocucao; pronuncias?: Record<string,string> };
function textoDaFrase(t: Frase): string {
  const frase = t.texto.trim();
  if (t.intencao === 'pergunta') return frase.replace(/[.!?]+$/, '') + '?';
  if (t.intencao === 'chamada' || t.intencao === 'destaque') return frase.replace(/[.!?]+$/, '') + '!';
  return frase;
}

/** Prévia independente de MP3: gera somente áudio, sem vídeo ou IA. */
@Injectable()
export class GerarNarracaoProvider implements AiProvider {
  readonly id = 'gerar-narracao';
  readonly label = 'Prévia de narração Kokoro (MP3)';
  readonly kind = 'executor' as const;
  constructor(private readonly kokoro: KokoroTtsService) {}
  async checkAvailability(): Promise<ProviderStatus> {
    const [tts, ff] = await Promise.all([
      this.kokoro.status(),
      runProcess('ffmpeg', ['-version'], { cwd: os.tmpdir(), env: minimalEnv(), timeoutMs: 12000 }),
    ]);
    const ok = tts.disponivel && ff.exitCode === 0 && !ff.spawnError;
    return { id: this.id, label: this.label, kind: this.kind, available: ok, installed: ok, authenticated: true,
      limits: {}, capabilities: ['mp3', 'kokoro', 'trechos', 'pausas'],
      errors: [...(!tts.disponivel ? [tts.erro ?? 'Kokoro indisponível'] : []), ...(ff.exitCode !== 0 || ff.spawnError ? ['ffmpeg indisponível'] : [])],
      checkedAt: new Date().toISOString(), isAi: false };
  }
  async execute(req: ExecutionRequest): Promise<ExecutionResult> {
    const o = (req.options ?? {}) as Opcoes;
    const nome = o.arquivo ?? 'out/previa-locucao.mp3';
    if (!/^out\/[a-zA-Z0-9_/-]+\.mp3$/.test(nome) || nome.split('/').includes('..'))
      return { exitCode: 1, output: '', error: 'Destino de prévia deve ser out/<nome>.mp3' };
    const trechos = o.trechos?.length ? o.trechos : frasesDeLocucao(o.texto ?? '');
    const texto = roteiroEmUmaFala(trechos, o.ritmo ?? 'natural');
    if (!texto) return { exitCode: 1, output: '', error: 'Nenhuma frase para narrar' };
    // A marcação é interpretada pelo Kokoro-FastAPI durante uma única síntese.
    // Nunca separar a locução em arquivos e concatenar.
    if (texto.includes('[pause:')) req.onLog('Pausas internas Kokoro-FastAPI presentes no roteiro, sem cortes do áudio.');
    const target = resolveInside(req.cwd, nome);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nivoo-kokoro-preview-'));
    try {
      // A API recebe o roteiro inteiro em uma síntese, sem recortes nem silêncios
      // colocados pelo FFmpeg. Pausas vêm da pontuação interpretada pela voz.
      const velocidade = o.velocidade ?? velocidadePadraoLocucao(o.ritmo ?? 'natural');
      req.onLog('Gerando locução contínua em uma chamada ao Kokoro (sem cortes, velocidade ' + velocidade + ').');
      if (trechos.some(t => t.velocidade !== undefined && t.velocidade !== velocidade))
        req.onLog('Atenção: velocidade por frase foi ignorada para preservar uma só interpretação. Usando a velocidade global.', 'WARN');
      if (trechos.some(t => t.pausaAposMs !== undefined))
        req.onLog('Pausas aplicadas pelo próprio Kokoro com marcadores [pause:Ns] dentro de uma única síntese.', 'INFO');
      let audio: Awaited<ReturnType<KokoroTtsService['gerar']>>;
      try { audio = await this.kokoro.gerar(texto, o.voz ?? VOZ_PADRAO_KOKORO, velocidade, o.pronuncias ?? {}, req.signal); }
      catch (e) { const err=e instanceof KokoroTtsError ? e : new KokoroTtsError(String(e)); return { exitCode: 1, output: '', error: err.message, resourceUnavailable: err.indisponivel }; }
      const original = path.join(tmp, 'original.mp3');
      fs.writeFileSync(original, audio.bytes);
      const result = await runProcess('ffmpeg',
        ['-nostdin','-hide_banner','-loglevel','error','-y','-i',original,'-map','0:a:0','-c:a','libmp3lame','-q:a','3',target],
        { cwd: req.cwd, env: minimalEnv(), timeoutMs: Math.min(req.timeoutMs, 180000), signal: req.signal });
      if (result.exitCode !== 0) return { exitCode: 1, output: '', error: 'Falha ao normalizar MP3: ' + result.stderr.slice(-350) };
      if (!fs.existsSync(target) || !fs.statSync(target).size) return { exitCode: 1, output: '', error: 'Prévia MP3 vazia' };
      req.onLog('Locução contínua disponível: ' + nome);
      return { exitCode: 0, output: 'Prévia da locução contínua gerada: ' + nome + '. Aguardando aprovação antes do vídeo.', stopReason: 'completed' };
    }finally{fs.rmSync(tmp,{recursive:true,force:true});}
  }
}
