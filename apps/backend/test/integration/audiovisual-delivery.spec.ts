import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { JuntarVideosProvider } from '../../src/providers/juntar-videos.provider';
import { mediaDeliveries } from '../../src/specialties/media/delivery';
import { inspectMediaDelivery } from '../../src/jobs/native-video-result';
import { dependenciasDeMontagemPorArquivo } from '../../src/jobs/workflow/media-dependencies';
import { publishMediaFile } from '../../src/providers/media-file-publication';
import type { ExecutionRequest } from '../../src/providers/provider.interface';

describe('Audiovisual: contratos e montagem real',()=>{
  let root:string,media:string;
  const ff=(args:string[])=>{
    const r=spawnSync('ffmpeg',['-v','error','-y',...args],{encoding:'utf8',timeout:60000});
    if(r.status!==0)throw Error(r.stderr||String(r.error));
  };
  const tracks=(file:string)=>{
    const r=spawnSync('ffprobe',['-v','error','-show_entries','stream=codec_type','-of','json',file],{encoding:'utf8'});
    if(r.status!==0)throw Error(r.stderr);
    return JSON.parse(r.stdout).streams.map((s:any)=>s.codec_type);
  };
  beforeEach(()=>{
    root=fs.mkdtempSync(path.join(os.tmpdir(),'nivoo-media-'));
    media=path.join(root,'midia');
    fs.mkdirSync(path.join(media,'entrada'),{recursive:true});
    fs.mkdirSync(path.join(media,'saida'));
    fs.mkdirSync(path.join(root,'out'));
  });
  afterEach(()=>fs.rmSync(root,{recursive:true,force:true}));
  function input(){
    ff(['-f','lavfi','-i','testsrc2=size=160x240:rate=25','-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-t','2','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac',path.join(media,'entrada','original.mp4')]);
    ff(['-f','lavfi','-i','sine=frequency=880:sample_rate=48000','-t','1.5','-c:a','libmp3lame',path.join(root,'out','voz.mp3')]);
  }
  function request(options:ExecutionRequest['options']):ExecutionRequest{
    return {jobId:'j',stepId:'s',attemptId:'a',cwd:root,outputDir:path.join(root,'out'),projectMediaDir:media,
      instructions:'Montar',context:'',options,timeoutMs:120000,signal:new AbortController().signal,onLog:()=>{}};
  }
  it('liga locução alternativa e múltiplos renders pelo contrato único',()=>{
    const command='nivoo-renderizar-motion motion/a --saida midia/saida/a.mp4 --tamanho 160x240 --segundos 1';
    expect(mediaDeliveries('local-shell',command+'\nnivoo-renderizar-motion motion/b --saida midia/saida/b.mp4',{}).map(x=>x.path)).toEqual(['midia/saida/a.mp4','midia/saida/b.mp4']);
    const steps=[{key:'render',provider:'local-shell',instructions:command},{key:'voz',provider:'gerar-narracao',providerOptions:{arquivo:'out/voz.mp3',fechamentoAlternativo:'B'}},{key:'montar',provider:'juntar-videos',providerOptions:{cenas:['midia/saida/a.mp4'],narracao:{arquivo:'out/voz-alternativa.mp3'},arquivo:'midia/saida/final.mp4'}}];
    expect((dependenciasDeMontagemPorArquivo(steps,'codex-cli') as any[])[2].dependsOn).toEqual(['render','voz']);
  });
  it('silencia vídeo de verdade e preserva o arquivo anterior',async()=>{
    input();
    const provider=new JuntarVideosProvider({} as any,{} as any,{} as any);
    const opts={cenas:['midia/entrada/original.mp4'],arquivo:'midia/saida/mudo.mp4',volumeCenas:0};
    const result=await provider.execute(request(opts));
    expect(result.exitCode).toBe(0);
    const dst=path.join(media,'saida','mudo.mp4');
    expect(tracks(dst)).toEqual(['video']);
    const before=fs.readFileSync(dst);
    expect((await provider.execute(request(opts))).error).toContain('MIDIA_DESTINO_EXISTENTE');
    expect(fs.readFileSync(dst)).toEqual(before);
  },120000);
  it('sincroniza imagem mantendo áudio da cena e mistura locução existente sem IA',async()=>{
    input();
    const provider=new JuntarVideosProvider({} as any,{} as any,{} as any);
    const opts={cenas:['midia/entrada/original.mp4'],arquivo:'midia/saida/final.mp4',volumeCenas:0.6,narracao:{arquivo:'out/voz.mp3'},sincronizarVideoComNarracao:true};
    const result=await provider.execute(request(opts));
    expect(result.exitCode).toBe(0);
    const d=mediaDeliveries('juntar-videos','',opts)[0];
    const report=inspectMediaDelivery(media,root,d);
    expect(report.ok).toBe(true);
    expect(tracks(report.absolutePath!)).toEqual(['video','audio']);
    expect(report.seconds).toBeGreaterThanOrEqual(1.4);
    expect(report.seconds).toBeLessThan(2.1);
    expect(inspectMediaDelivery(media,root,{path:'out/voz.mp3',kind:'audio'}).ok).toBe(true);
    expect(inspectMediaDelivery(media,root,{...d,width:1080,height:1920}).ok).toBe(false);
    expect(inspectMediaDelivery(media,root,{path:'out/ausente.mp3',kind:'audio'}).ok).toBe(false);
  },120000);
  it('publica sem deixar cópia parcial nem sobrescrever resultado durável',()=>{
    const src=path.join(root,'out','original.bin'),dst=path.join(media,'saida','final.mp4');
    fs.writeFileSync(src,'A');publishMediaFile(src,dst,true);
    fs.writeFileSync(src,'B');expect(()=>publishMediaFile(src,dst,true)).toThrow(/MIDIA_DESTINO_EXISTENTE/);
    expect(fs.readFileSync(dst,'utf8')).toBe('A');
    expect(fs.readdirSync(path.dirname(dst))).toEqual(['final.mp4']);
  });
});
