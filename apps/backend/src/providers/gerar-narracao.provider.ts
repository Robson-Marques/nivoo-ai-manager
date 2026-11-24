import { Injectable } from '@nestjs/common';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { minimalEnv, runProcess } from '../common/exec';
import { publishMediaFile } from './media-file-publication';
import { resolveInside } from '../common/path-guard';
import { KokoroTtsError, KokoroTtsService, roteiroEmUmaFala, frasesDeLocucao, velocidadePadraoLocucao, RitmoLocucao } from './kokoro-tts.service';
import { MotorNarracao, vozPadraoDoMotor } from './vozes';
import { gerarNarracaoNvidia,nvidiaTtsConfigurado,roteiroFaladoNvidia } from './magpie-tts.service';
import { AiProvider, ExecutionRequest, ExecutionResult, ProviderStatus } from './provider.interface';

type Frase = { texto: string; intencao?: 'chamada' | 'destaque' | 'pergunta' | 'natural'; velocidade?: number; pausaAposMs?: number };
type Opcoes = { motor?: MotorNarracao; conexao?: string; arquivo?: string; texto?: string; trechos?: Frase[]; voz?: string; velocidade?: number; ritmo?: RitmoLocucao; pronuncias?: Record<string,string>; fechamentoAlternativo?: string };
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
  readonly label = 'Prévia de narração (Kokoro / NVIDIA, MP3)';
  readonly kind = 'executor' as const;
  constructor(private readonly kokoro: KokoroTtsService) {}
  async checkAvailability(): Promise<ProviderStatus> {
    const [tts, ff] = await Promise.all([
      this.kokoro.status(),
      runProcess('ffmpeg', ['-version'], { cwd: os.tmpdir(), env: minimalEnv(), timeoutMs: 12000 }),
    ]);
    const nvidia=nvidiaTtsConfigurado();
    const ok = (tts.disponivel || nvidia) && ff.exitCode === 0 && !ff.spawnError;
    return { id: this.id, label: this.label, kind: this.kind, available: ok, installed: ok, authenticated: true,
      limits: {}, capabilities: ['mp3', 'kokoro', 'trechos', 'pausas', ...(nvidia?['nvidia-magpie']:[])],
      errors: [...(!tts.disponivel ? [tts.erro ?? 'Kokoro indisponível'] : []), ...(ff.exitCode !== 0 || ff.spawnError ? ['ffmpeg indisponível'] : [])],
      checkedAt: new Date().toISOString(), isAi: false };
  }
  async execute(req: ExecutionRequest): Promise<ExecutionResult> {
    const o = (req.options ?? {}) as Opcoes;
    const nome = o.arquivo ?? 'out/previa-locucao.mp3';
    if (!/^out\/[a-zA-Z0-9_/-]+\.mp3$/.test(nome) || nome.split('/').includes('..'))
      return { exitCode: 1, output: '', error: 'Destino de prévia deve ser out/<nome>.mp3' };
    const trechos = o.trechos?.length ? o.trechos : frasesDeLocucao(o.texto ?? '');
    const motor=o.motor??'kokoro';
    if(motor!=='kokoro'&&motor!=='nvidia')return {exitCode:1,output:'',error:'Motor de prévia não suportado: '+motor};
    const roteiro=(t:Frase[])=>motor==='nvidia'?roteiroFaladoNvidia(t):roteiroEmUmaFala(t,o.ritmo??'natural');
    const texto = roteiro(trechos);
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
      const gerar=(t:string)=>motor==='nvidia'?gerarNarracaoNvidia(t,o.voz??vozPadraoDoMotor('nvidia'),o.pronuncias??{},req.signal,o.conexao,req.timeoutMs):this.kokoro.gerar(t,o.voz??vozPadraoDoMotor('kokoro'),velocidade,o.pronuncias??{},req.signal);
      req.onLog(motor==='nvidia'?'Gerando locução contínua com NVIDIA Magpie (pt-BR). A API não expõe velocidade ou pausas numéricas; ritmo depende do texto. Sujeita à cota da conexão.':'Gerando locução contínua em uma chamada ao Kokoro (sem cortes, velocidade ' + velocidade + ').');
      if (trechos.some(t => t.velocidade !== undefined && t.velocidade !== velocidade))
        req.onLog('Atenção: velocidade por frase foi ignorada para preservar uma só interpretação. Usando a velocidade global.', 'WARN');
      if (motor==='kokoro' && trechos.some(t => t.pausaAposMs !== undefined))
        req.onLog('Pausas aplicadas pelo próprio Kokoro com marcadores [pause:Ns] dentro de uma única síntese.', 'INFO');
      let audio: Awaited<ReturnType<KokoroTtsService['gerar']>>;
      try { audio = await gerar(texto); }
      catch (e) { const err=e instanceof KokoroTtsError ? e : new KokoroTtsError(String(e)); return { exitCode: 1, output: '', error: err.message, resourceUnavailable: err.indisponivel }; }
      const original = path.join(tmp, 'original.mp3');
      fs.writeFileSync(original, audio.bytes);
      const normalized=path.join(tmp,'normalized.mp3');
      const result = await runProcess('ffmpeg',
        ['-nostdin','-hide_banner','-loglevel','error','-y','-i',original,'-map','0:a:0','-c:a','libmp3lame','-q:a','3',normalized],
        { cwd: req.cwd, env: minimalEnv(), timeoutMs: Math.min(req.timeoutMs, 180000), signal: req.signal });
      if (result.exitCode !== 0 || req.signal.aborted) return { exitCode: 1, output: '', error: 'Falha ao normalizar MP3: ' + result.stderr.slice(-350),interrupted:req.signal.aborted };
      if (!fs.existsSync(normalized) || !fs.statSync(normalized).size) return { exitCode: 1, output: '', error: 'Prévia MP3 vazia' };
      publishMediaFile(normalized,target,false);
      // Comparação opcional: a mesma voz/velocidade/pausas em duas locuções
      // completas e independentes. Não juntar frases e não renderizar MP4.
      // O texto original nunca é sobrescrito pela alternativa.
      let alternativa: string | null = null;
      if (o.fechamentoAlternativo?.trim()) {
        const original = trechos[trechos.length - 1];
        if (!original) return { exitCode: 1, output: '', error: 'Sem frase final para comparar' };
        const alternativaTexto = o.fechamentoAlternativo.trim();
        const outrasFrases = [...trechos.slice(0, -1), {
          ...original, texto: alternativaTexto, intencao: 'chamada' as const,
        }];
        const textoAlternativo = roteiro(outrasFrases);
        alternativa = nome.replace(/\.mp3$/i, '-alternativa.mp3');
        req.onLog('Gerando versão B com CTA alternativo (mesma voz e ritmo), sem alterar o original.');
        let alternativaAudio: Awaited<ReturnType<KokoroTtsService['gerar']>>;
        try { alternativaAudio = await gerar(textoAlternativo); }
        catch (e) { const err=e instanceof KokoroTtsError ? e : new KokoroTtsError(String(e)); return { exitCode: 1, output: 'Prévia A preservada: ' + nome, error: 'Falha na alternativa B: ' + err.message, resourceUnavailable: err.indisponivel }; }
        const rawAlt = path.join(tmp, 'alternativa-original.mp3');
        fs.writeFileSync(rawAlt, alternativaAudio.bytes);
        const destinoAlt = resolveInside(req.cwd, alternativa);
        const normalizedAlt=path.join(tmp,'normalized-alt.mp3');
        const convAlt = await runProcess('ffmpeg',
          ['-nostdin', '-hide_banner', '-loglevel', 'error', '-y', '-i', rawAlt, '-map', '0:a:0', '-c:a', 'libmp3lame', '-q:a', '3', normalizedAlt],
          { cwd: req.cwd, env: minimalEnv(), timeoutMs: Math.min(req.timeoutMs, 180000), signal: req.signal });
        if (convAlt.exitCode !== 0 || req.signal.aborted || !fs.existsSync(normalizedAlt) || !fs.statSync(normalizedAlt).size)
          return { exitCode: 1, output: 'Prévia A preservada: ' + nome, error: 'Falha ao preparar a alternativa B: ' + convAlt.stderr.slice(-350),interrupted:req.signal.aborted };
        publishMediaFile(normalizedAlt,destinoAlt,false);
      }
      req.onLog('Locução contínua disponível: ' + nome + (alternativa ? ' e ' + alternativa : ''));
      return { exitCode: 0, output: 'Prévia A: ' + nome + (alternativa ? '; prévia B: ' + alternativa : '') + '. Aguardando a escolha do usuário antes do vídeo.', stopReason: 'completed' };
    }finally{fs.rmSync(tmp,{recursive:true,force:true});}
  }
}
