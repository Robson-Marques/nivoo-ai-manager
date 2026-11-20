import { Injectable } from '@nestjs/common';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { minimalEnv, runProcess } from '../common/exec';
import { resolveInside } from '../common/path-guard';
import { KokoroTtsError, KokoroTtsService } from './kokoro-tts.service';
import { VOZ_PADRAO_KOKORO } from './vozes';
import { AiProvider, ExecutionRequest, ExecutionResult, ProviderStatus } from './provider.interface';

type Frase = { texto: string; intencao?: 'chamada' | 'destaque' | 'pergunta' | 'natural'; velocidade?: number; pausaAposMs?: number };
type Opcoes = { arquivo?: string; texto?: string; trechos?: Frase[]; voz?: string; velocidade?: number; pronuncias?: Record<string,string> };
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
    const trechos = o.trechos?.length ? o.trechos : o.texto?.trim() ? [{ texto: o.texto.trim() }] : [];
    if (!trechos.length) return { exitCode: 1, output: '', error: 'Nenhuma frase para narrar' };
    const target = resolveInside(req.cwd, nome);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nivoo-kokoro-preview-'));
    try {
      const arquivos: string[] = [];
      for (const [i, t] of trechos.entries()) {
        if (req.signal.aborted) return { exitCode: 1, output: '', error: 'interrompido', interrupted: true };
        const vel = t.velocidade ?? o.velocidade ?? 1;
        req.onLog(`Sintetizando frase ${i+1}/${trechos.length}, intenção ${t.intencao ?? 'natural'}, velocidade ${vel}`);
        let audio: Awaited<ReturnType<KokoroTtsService['gerar']>>;
        try { audio = await this.kokoro.gerar(textoDaFrase(t), o.voz ?? VOZ_PADRAO_KOKORO, vel, o.pronuncias ?? {}, req.signal); }
        catch (e) { const err=e instanceof KokoroTtsError?e:new KokoroTtsError(String(e)); return { exitCode: 1, output:'',error:err.message,resourceUnavailable:err.indisponivel }; }
        const arquivo = path.join(tmp,`frase-${i}.mp3`);
        fs.writeFileSync(arquivo,audio.bytes);
        arquivos.push(arquivo);
      }
      const filtros=trechos.map((t,i)=>`[${i}:a]aresample=24000,aformat=channel_layouts=mono,apad=pad_dur=${(i===trechos.length-1?0:(t.pausaAposMs??160)/1000).toFixed(3)}[s${i}]`);
      filtros.push(`${trechos.map((_,i)=>`[s${i}]`).join('')}concat=n=${trechos.length}:v=0:a=1[a]`);
      const result=await runProcess('ffmpeg',['-nostdin','-hide_banner','-loglevel','error','-y',...arquivos.flatMap(f=>['-i',f]),'-filter_complex',filtros.join(';'),'-map','[a]','-c:a','libmp3lame','-q:a','3',target],{cwd:req.cwd,env:minimalEnv(),timeoutMs:Math.min(req.timeoutMs,180000),signal:req.signal});
      if(result.exitCode!==0)return {exitCode:1,output:'',error:'Falha na união da locução: '+result.stderr.slice(-350)};
      if(!fs.existsSync(target)||!fs.statSync(target).size)return {exitCode:1,output:'',error:'Prévia MP3 vazia'};
      req.onLog('MP3 disponível para escuta: '+nome);
      return {exitCode:0,output:'Prévia de voz criada em '+nome+'. Aguarda aprovação antes do MP4.',stopReason:'completed'};
    }finally{fs.rmSync(tmp,{recursive:true,force:true});}
  }
}
