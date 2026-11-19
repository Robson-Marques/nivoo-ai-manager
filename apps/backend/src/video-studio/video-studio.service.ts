import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { spawn, spawnSync, ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { WorkspaceService } from '../storage/workspace.service';
import { arquivoDaMidia, listarVideos } from '../projects/midia';
import { ProviderRegistry } from '../providers/provider-registry.service';
import { karaokeAss, validWords, TimedWord } from './caption-timing';
import { safeInsert } from './smart-placement';
import { maybeProductionMedia } from './standalone-projects';

export type StudioClip = {
  id: string; source: string; start: number; end: number; duration: number;
  volume?: number;
};
export type StudioCaption = {
  id: string; text: string; start: number; end: number; x: number; y: number;
  fontSize?: number; color?: string; animation?: 'fade'|'pop'|'slide'|'karaoke'|'rise'|'enter-left'|'enter-right'; words?:TimedWord[];
};
export type ProtectedZone = {id:string;label:string;start:number;end:number;x:number;y:number;w:number;h:number};
export type StudioAudio = {id:string;source:string;start:number;end:number;offset:number;volume:number;fadeIn?:number;fadeOut?:number};
export type StudioAsset = {
  id: string; source: string; start: number; end: number;
  x: number; y: number; w: number; h: number; animation?: 'fade'|'slide'|'none';
};
export type StudioProject = {
  version: 1; id: string; title: string; clips: StudioClip[];
  soundtrack?: { source: string; volume: number } | null;
  captions: StudioCaption[]; assets: StudioAsset[]; audioTracks?: StudioAudio[]; protectedZones?: ProtectedZone[];
  updatedAt: string;
};
type Status = { state: 'running'|'done'|'failed'|'cancelled'; error?: string; output?: string; started: string };
const finite = (n: unknown, min = 0, max = 100000) => typeof n === 'number' && Number.isFinite(n) && n >= min && n <= max;
// O servidor pode instalar modelos opcionais em um venv, sem alterar Python global.
const studioPython = () => process.env.NIVOO_STUDIO_PYTHON?.trim() || 'python3';
const safeId = (id: string) => /^[a-f\d-]{36}$/i.test(id);
const color = (s: string) => /^#[0-9a-f]{6}$/i.test(s || '');
const esc = (s: string) => s.replace(/\\/g, '').replace(/[{}]/g,'').replace(/\r?\n/g,'\\N');
const assTime = (s: number) => {
  let cs = Math.round(s * 100); const h = Math.floor(cs / 360000); cs %= 360000;
  const m = Math.floor(cs / 6000); cs %= 6000;
  const secs = Math.floor(cs / 100);
  return h + ':' + String(m).padStart(2,'0') + ':' + String(secs).padStart(2,'0') + '.' + String(cs%100).padStart(2,'0');
};
const assColor = (s: string) => '&H00' + s.slice(5,7)+s.slice(3,5)+s.slice(1,3);
const status = new Map<string, { result: Status; process?: ChildProcess }>();
const transcriptions = new Map<string, {state:'running'|'done'|'failed';error?:string;captions?:number}>();
type AiElement = {kind:'caption'|'image'|'graphic';text?:string;asset?:string;subtitle?:string;variant?:string;start:number;end:number;x:number;y:number;w?:number;h?:number;style?:'impact'|'fade'|'slide'|'rise'|'enter-left'|'enter-right'};
type AiState = {state:'idle'|'running'|'draft'|'failed';error?:string;elements?:AiElement[];explanation?:string};
const aiStates=new Map<string,AiState>();
type ZoneState={state:'idle'|'running'|'draft'|'failed';error?:string;regions?:ProtectedZone[];warning?:string};
const zoneStates=new Map<string,ZoneState>();
function parseAiJson(text:string):unknown {
  const clean=text.trim().replace(/^\x60\x60\x60(?:json)?\s*/i,'').replace(/\s*\x60\x60\x60$/,'');
  try{return JSON.parse(clean)}catch{
    const begin=clean.indexOf('{'),end=clean.lastIndexOf('}');
    if(begin<0||end<=begin)throw new Error('Agente não devolveu um JSON válido');
    return JSON.parse(clean.slice(begin,end+1));
  }
}

@Injectable()
export class VideoStudioService {
  constructor(private readonly prisma: PrismaService, private readonly workspace: WorkspaceService, private readonly providers: ProviderRegistry) {}

  private async dir(pid: string) {
    const project = await this.prisma.project.findUnique({ where: { id: pid }, select: { dirKey: true } });
    const standalone=maybeProductionMedia(pid);
    if (!project&&!standalone) throw new NotFoundException('Projeto não encontrado');
    const media = standalone ?? this.workspace.projectDirs(project!.dirKey).midia;
    const studio = path.join(media, 'studio');
    fs.mkdirSync(studio, { recursive: true });
    return { media, studio };
  }
  private file(dir: string, id: string) {
    if (!safeId(id)) throw new BadRequestException('ID inválido');
    return path.join(dir, id + '.json');
  }
  private src(media: string, source: string): string {
    if (!/^midia\/(entrada|saida)\/[A-Za-z0-9_.-]+$/.test(source))
      throw new BadRequestException('Mídia fora do projeto');
    const result = arquivoDaMidia(media, source);
    if (!result) throw new BadRequestException('Mídia não encontrada: ' + source);
    return result;
  }
  private validate(p: any, media: string): StudioProject {
    if (!p || p.version !== 1 || !safeId(p.id) || !Array.isArray(p.clips) ||
        !Array.isArray(p.captions) || !Array.isArray(p.assets) ||
        p.clips.length > 200 || p.captions.length > 1000 || p.assets.length > 150 ||
        (p.audioTracks && (!Array.isArray(p.audioTracks) || p.audioTracks.length>40)) ||
        (p.protectedZones && (!Array.isArray(p.protectedZones) || p.protectedZones.length>50)))
      throw new BadRequestException('Projeto Studio inválido');
    if (typeof p.title !== 'string' || p.title.length > 150) throw new BadRequestException('Título inválido');
    const known = new Set<string>();
    const ident = (v: any) => {
      if (typeof v.id !== 'string' || !/^[a-zA-Z0-9_-]{1,70}$/.test(v.id) || known.has(v.id))
        throw new BadRequestException('Identificador duplicado ou inválido');
      known.add(v.id);
    };
    for (const c of p.clips) {
      ident(c); this.src(media,c.source);
      if (!finite(c.start) || !finite(c.end) || c.end <= c.start ||
          !finite(c.duration, .05, 14400) || !finite(c.volume ?? 1, 0, 2))
        throw new BadRequestException('Corte inválido');
    }
    if (p.soundtrack) {
      this.src(media,p.soundtrack.source);
      if (!finite(p.soundtrack.volume,0,2)) throw new BadRequestException('Volume inválido');
    }
    const total = p.clips.reduce((a:number,c:StudioClip)=>a+c.duration,0);
    if (total > 14400) throw new BadRequestException('Projeto acima de 4 horas');
    const boxes=(p.protectedZones??[]);
    const overlaps=(a:{x:number;y:number;w:number;h:number},b:{x:number;y:number;w:number;h:number})=>
      a.x < b.x+b.w && b.x < a.x+a.w && a.y < b.y+b.h && b.y < a.y+a.h;
    const temporally=(a:{start:number;end:number},b:{start:number;end:number})=>a.start<b.end && b.start<a.end;
    for(const z of boxes){
      ident(z);
      if(typeof z.label!=='string'||z.label.length>80||!finite(z.start,0,total)||!finite(z.end,0,total)||
         z.end<=z.start||!finite(z.x,0,1)||!finite(z.y,0,1)||
         !finite(z.w,.01,1)||!finite(z.h,.01,1)||z.x+z.w>1||z.y+z.h>1)
        throw new BadRequestException('Região protegida inválida');
    }
    for (const c of p.captions) {
      ident(c);
      if (typeof c.text !== 'string' || !c.text.trim() || c.text.length > 250 ||
          !finite(c.start,0,total) || !finite(c.end,0,total) || c.end<=c.start ||
          !finite(c.x,0,1) || !finite(c.y,0,1) || !finite(c.fontSize ?? 54,12,140) ||
          (c.color && !color(c.color))) throw new BadRequestException('Legenda inválida');
      if(c.words!==undefined && !validWords(c)) throw new BadRequestException('Palavras da legenda com tempos inválidos');
      const approx={x:Math.max(0,c.x-.40),y:Math.max(0,c.y-.065),w:Math.min(.8,1-Math.max(0,c.x-.40)),h:.13};
      for(const z of boxes) if(temporally(c,z)&&overlaps(approx,z))
        throw new BadRequestException('Legenda '+c.id+' pode cobrir área protegida '+z.label);
    }
    for(const a of p.assets) {
      for(const z of boxes) if(temporally(a,z)&&overlaps(a,z))
        throw new BadRequestException('Imagem '+a.id+' sobrepõe área protegida '+z.label);
    }
    for (const a of p.audioTracks??[]) {
      ident(a); this.src(media,a.source);
      if(!finite(a.start,0,14400)||!finite(a.end,0,14400)||a.end<=a.start||
          !finite(a.offset,0,total)||a.offset+a.end-a.start>total+.05||
          !finite(a.volume,0,2)||!finite(a.fadeIn??0,0,(a.end-a.start)/2)||
          !finite(a.fadeOut??0,0,(a.end-a.start)/2))throw new BadRequestException('Faixa de áudio inválida');
    }
    for (const a of p.assets) {
      ident(a); this.src(media,a.source);
      if (!finite(a.start,0,total) || !finite(a.end,0,total) || a.end<=a.start ||
          !finite(a.x,0,1) || !finite(a.y,0,1) || !finite(a.w,.01,1) ||
          !finite(a.h,.01,1) || a.x+a.w>1 || a.y+a.h>1 ||
          (a.animation!==undefined && !['fade','slide','none'].includes(a.animation)))
        throw new BadRequestException('Imagem de apoio inválida');
    }
    return p as StudioProject;
  }
  async list(pid: string) {
    const {studio} = await this.dir(pid);
    return fs.readdirSync(studio).filter(f=>/^[a-f0-9-]{36}\.json$/i.test(f))
      .map(f=>{try {const p = JSON.parse(fs.readFileSync(path.join(studio,f),'utf8')) as StudioProject;return {id:p.id,title:p.title,updatedAt:p.updatedAt};} catch{return null;}})
      .filter(Boolean);
  }
  async create(pid: string, title = 'Novo vídeo') {
    const {studio} = await this.dir(pid);
    const p:StudioProject = {version:1,id:randomUUID(),title:String(title).slice(0,150),clips:[],captions:[],assets:[],audioTracks:[],protectedZones:[],soundtrack:null,updatedAt:new Date().toISOString()};
    fs.writeFileSync(this.file(studio,p.id),JSON.stringify(p,null,2));
    return p;
  }
  async get(pid: string,id: string):Promise<StudioProject> {
    const {studio} = await this.dir(pid);
    const f = this.file(studio,id);
    if (!fs.existsSync(f)) throw new NotFoundException('Edição não encontrada');
    return JSON.parse(fs.readFileSync(f,'utf8'));
  }
  async save(pid:string,id:string,body:any) {
    const {media,studio} = await this.dir(pid);
    const f=this.file(studio,id);
    if (!fs.existsSync(f)) throw new NotFoundException('Edição não encontrada');
    if (body.id !== id) throw new BadRequestException('ID não confere');
    const actual=JSON.parse(fs.readFileSync(f,'utf8'));
    if (actual.updatedAt !== body.updatedAt) throw new ConflictException('Esta edição foi alterada em outra sessão. Recarregue.');
    const p=this.validate(body,media);p.updatedAt=new Date().toISOString();
    const temp=f+'.tmp-'+process.pid;
    fs.writeFileSync(temp,JSON.stringify(p,null,2));
    fs.renameSync(temp,f);
    return p;
  }
  async remove(pid:string,id:string) {
    const {studio}=await this.dir(pid);
    const f=this.file(studio,id);
    if (!fs.existsSync(f)) throw new NotFoundException('Edição não encontrada');
    fs.rmSync(f);
    return {ok:true};
  }
  captionsStatus(pid:string,id:string) { return transcriptions.get(pid+':'+id) ?? {state:'idle'}; }

  async autoCaptions(pid:string,id:string,script?:string) {
    const key=pid+':'+id;
    if(transcriptions.get(key)?.state==='running') throw new ConflictException('Transcrição já em andamento');
    const done=status.get(key)?.result;
    const currentProject=await this.get(pid,id);
    const direct=currentProject.clips.length===1&&!currentProject.soundtrack&&!(currentProject.audioTracks?.length);
    if(!direct&&(done?.state!=='done'||!done.output))
      throw new BadRequestException('Para vídeos com múltiplas cenas ou faixas, exporte a montagem antes de alinhar a narração');
    if(script!==undefined&&(typeof script!=='string'||script.length>10000))
      throw new BadRequestException('Roteiro inválido');
    transcriptions.set(key,{state:'running'});
    setImmediate(async()=>{
      const temp=fs.mkdtempSync(path.join(os.tmpdir(),'nivoo-caption-'));
      try {
        const {media,studio}=await this.dir(pid);
        let input:string;
        if(direct){
          const clip=currentProject.clips[0];
          const src=this.src(media,clip.source);
          const cropped=path.join(temp,'source-audio.wav');
          const prep=spawnSync('ffmpeg',['-nostdin','-hide_banner','-loglevel','error','-y',
            '-ss',String(clip.start),'-i',src,'-t',String(clip.duration),
            '-vn','-ar','16000','-ac','1','-c:a','pcm_s16le',cropped],
            {timeout:120000,encoding:'utf8'});
          if(prep.status!==0)throw new Error('Não foi possível extrair a narração: '+String(prep.stderr).slice(-250));
          input=cropped;
        }else input=this.src(media,done!.output!);
        const alignment=path.join(temp,'aligned.json');
        const cmd=path.resolve(__dirname,'../../bin/nivoo-alinhar-narracao');
        const args=[cmd,'--video',input,'--saida',alignment];
        if(script?.trim()){
          const textFile=path.join(temp,'script.txt');
          fs.writeFileSync(textFile,script.trim());
          args.push('--roteiro',textFile);
        }
        await new Promise<void>((resolve,reject)=>{
          const child=spawn(studioPython(),args,{stdio:['ignore','ignore','pipe']});
          let err='';
          const kill=setTimeout(()=>child.kill('SIGTERM'),15*60*1000);
          child.stderr?.on('data',b=>{err=(err+String(b)).slice(-1000);});
          child.on('error',e=>{clearTimeout(kill);reject(e);});
          child.on('close',code=>{clearTimeout(kill);code===0?resolve():reject(new Error(err||'Alinhamento falhou'));});
        });
        const data=JSON.parse(fs.readFileSync(alignment,'utf8'));
        if(!Array.isArray(data.words)||!data.words.length) throw new Error('Não foi encontrada fala alinhada');
        const current=await this.get(pid,id);
        const groups:StudioCaption[]=[];
        for(let i=0;i<data.words.length;i+=3){
          const w=data.words.slice(i,i+3).filter((v:any)=>typeof v.text==='string'&&finite(v.start,0,14400)&&finite(v.end,0,14400));
          if(!w.length)continue;
          const candidates=[{x:.5,y:.82},{x:.5,y:.15},{x:.5,y:.5}];
          const box=(a:{x:number;y:number})=>({x:.10,y:Math.max(0,a.y-.065),w:.80,h:.13});
          const allowed=candidates.find(a=>!(current.protectedZones??[]).some(z=>
            w[0].start<z.end && z.start<w[w.length-1].end &&
            box(a).x<z.x+z.w && z.x<box(a).x+box(a).w &&
            box(a).y<z.y+z.h && z.y<box(a).y+box(a).h));
          if(!allowed)continue;
          groups.push({
            id:'auto-'+randomUUID(),text:w.map((v:any)=>v.text).join(' ').trim(),
            start:w[0].start,end:w[w.length-1].end,x:allowed.x,y:allowed.y,
            animation:'karaoke',fontSize:54,color:'#FFFFFF',
            words:w.map((word:any)=>({text:String(word.text).trim(),start:Number(word.start),end:Number(word.end)}))
          });
        }
        // Nunca substituir legendas manuais nem sobrescrever alterações do usuário.
        const created=groups.filter(x=>x.end>x.start).slice(0,1000);
        const newProject={...current,captions:[...current.captions,...created]};
        await this.save(pid,id,newProject);
        transcriptions.set(key,{state:'done',captions:created.length});
      }catch(e:any){
        transcriptions.set(key,{state:'failed',error:String(e?.message??e).slice(0,600)});
      }finally{fs.rmSync(temp,{recursive:true,force:true});}
    });
    return {state:'running'};
  }

  zoneStatus(pid:string,id:string):ZoneState {
    return zoneStates.get(pid+':'+id)??{state:'idle'};
  }

  async detectZones(pid:string,id:string) {
    const {media}=await this.dir(pid);
    const p=this.validate(await this.get(pid,id),media);
    if(!p.clips.length)throw new BadRequestException('Adicione vídeo à timeline');
    const key=pid+':'+id;
    if(zoneStates.get(key)?.state==='running')throw new ConflictException('Detecção já em andamento');
    zoneStates.set(key,{state:'running'});
    setImmediate(async()=>{
      const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nivoo-faces-'));
      try{
        let offset=0;const regions:ProtectedZone[]=[];
        for(const clip of p.clips){
          const destination=path.join(dir,clip.id+'.json');
          await new Promise<void>((resolve,reject)=>{
            const child=spawn(studioPython(),[
              path.resolve(__dirname,'../../bin/nivoo-detectar-zonas'),
              '--video',this.src(media,clip.source),
              '--inicio',String(clip.start),'--duracao',String(clip.duration),
              '--offset',String(offset),'--saida',destination
            ],{stdio:['ignore','ignore','pipe']});
            let err='';
            const timer=setTimeout(()=>child.kill('SIGTERM'),180000);
            child.stderr?.on('data',b=>{err=(err+String(b)).slice(-1000)});
            child.on('error',e=>{clearTimeout(timer);reject(e)});
            child.on('close',code=>{clearTimeout(timer);code===0?resolve():reject(new Error(err||'Falha no OpenCV'))});
          });
          const data=JSON.parse(fs.readFileSync(destination,'utf8'));
          if(Array.isArray(data.regions)){
            for(const z of data.regions){
              if(regions.length>=50)break;
              regions.push({id:'face-'+randomUUID(),...z});
            }
          }
          offset+=clip.duration;
          if(regions.length>=50)break;
        }
        zoneStates.set(key,{state:'draft',regions,warning:'Detecção por amostragem: revisar rostos, logos e textos que possam não ter sido detectados.'});
      }catch(e:any){
        zoneStates.set(key,{state:'failed',error:String(e?.message??e).slice(0,600)});
      }finally{fs.rmSync(dir,{recursive:true,force:true})}
    });
    return {state:'running'};
  }

  async applyZones(pid:string,id:string,updatedAt:string) {
    const state=this.zoneStatus(pid,id);
    if(state.state!=='draft'||!state.regions)throw new BadRequestException('Nenhuma proposta de regiões para aplicar');
    const p=await this.get(pid,id);
    if(p.updatedAt!==updatedAt)throw new ConflictException('A timeline mudou; execute a análise novamente');
    const existing=p.protectedZones??[];
    if(existing.length+state.regions.length>50)
      throw new ConflictException('Limite de 50 regiões protegidas atingido. Reduza as regiões antes de aplicar.');
    const merged=[...existing,...state.regions];
    // A proteção não pode invalidar uma edição pré-existente: mover elementos
    // quando houver posição segura, ou bloquear a aplicação SEM perder o projeto.
    const placedCaptions:StudioCaption[]=[];
    const placedAssets:StudioAsset[]=[];
    for(const caption of p.captions){
      const adjusted=safeInsert({...caption,kind:'caption' as const},merged,
        [...placedCaptions.map(z=>({...z,kind:'caption' as const})),...placedAssets.map(z=>({...z,kind:'image' as const}))]);
      if(!adjusted)throw new ConflictException('Não há espaço seguro para a legenda '+caption.id+'. Ajuste-a manualmente antes de aplicar as proteções.');
      placedCaptions.push({...caption,x:adjusted.x,y:adjusted.y});
    }
    for(const asset of p.assets){
      const adjusted=safeInsert({...asset,kind:'image' as const},merged,
        [...placedCaptions.map(z=>({...z,kind:'caption' as const})),...placedAssets.map(z=>({...z,kind:'image' as const}))]);
      if(!adjusted)throw new ConflictException('Não há espaço seguro para a imagem '+asset.id+'. Ajuste-a manualmente.');
      placedAssets.push({...asset,x:adjusted.x,y:adjusted.y});
    }
    const saved=await this.save(pid,id,{...p,protectedZones:merged,captions:placedCaptions,assets:placedAssets});
    zoneStates.delete(pid+':'+id);
    return saved;
  }

  aiStatus(pid:string,id:string):AiState {
    return aiStates.get(pid+':'+id)??{state:'idle'};
  }

  async aiPlan(pid:string,id:string,brief?:string) {
    const {media,studio}=await this.dir(pid);
    const p=this.validate(await this.get(pid,id),media);
    if(p.clips.length===0)throw new BadRequestException('A timeline está vazia');
    if((brief??'').length>1200)throw new BadRequestException('Pedido muito longo');
    const key=pid+':'+id;
    if(aiStates.get(key)?.state==='running')throw new ConflictException('Análise de IA já está em andamento');
    if(!p.captions.length)throw new BadRequestException('Gere ou adicione legendas sincronizadas antes da direção criativa');
    const project=await this.prisma.project.findUnique({where:{id:pid},select:{provider:true,dirKey:true}});
    if(!project&&!maybeProductionMedia(pid))throw new NotFoundException('Projeto não encontrado');
    // Produções independentes usam o agente local configurado, sem projeto de conversa.
    const provider=project?.provider??'codex-cli';
    const ai=this.providers.get(provider);
    if(ai.kind==='executor')throw new BadRequestException('Escolha uma conexão de IA no projeto');
    const images=listarVideos(media).filter(v=>/\.(png|jpe?g|webp)$/i.test(v.caminho)).slice(0,30);
    const duration=p.clips.reduce((n,c)=>n+c.duration,0);
    aiStates.set(key,{state:'running'});
    setImmediate(async()=>{
      const outputDir=path.join(studio,'ai',id);
      const imageDetails=images.map(v=>({name:v.nome,source:v.caminho}));
      const snapshots:string[]=[];
      try{
        fs.mkdirSync(outputDir,{recursive:true});
      // Amostras espalhadas pela timeline REAL, não apenas pelo primeiro clipe.
      // Usamos até 12 imagens 640px para limitar tokens e tempo de processamento.
      if(/codex/.test(provider)){
        const captures:{source:string;at:number;position:number}[]=[];
        let offset=0;
        for(const clip of p.clips){
          for(const ratio of [.25,.70]){
            captures.push({
              source:this.src(media,clip.source),
              at:clip.start+clip.duration*ratio,
              position:offset+clip.duration*ratio
            });
          }
          offset+=clip.duration;
        }
        const samples=captures.length<=12?captures:
          Array.from({length:12},(_,i)=>captures[Math.min(captures.length-1,Math.floor(i*(captures.length-1)/11))]);
        for(const [i,sample] of samples.entries()){
          const pic=path.join(outputDir,'frame-'+i+'.jpg');
          const r=spawnSync('ffmpeg',['-nostdin','-hide_banner','-loglevel','error','-y',
            '-ss',String(sample.at),'-i',sample.source,
            '-frames:v','1','-vf','scale=640:-2',pic],{timeout:30000,encoding:'utf8'});
          if(r.status===0 && fs.existsSync(pic) && fs.statSync(pic).size>1000)snapshots.push(pic);
        }
      }
      // O agente recebe só um inventário de recursos e textos alinhados, não código executável.
      const payload={
        video:{duration,aspectRatio:'determine-from-scene',clips:p.clips.length},
        speech:p.captions.slice(0,500).map(v=>({text:v.text,start:v.start,end:v.end,words:v.words??[]})),
        protectedZones:p.protectedZones??[],
        availableImages:imageDetails,
        sampledFrames:snapshots.length,
        shotTimes:p.clips.length>1?'frames extraídos de múltiplas cenas':'frames extraídos do vídeo',
        instructions:brief?.trim()||'Crie uma composição visual dinâmica e profissional, sem excesso de efeitos.'
      };
        const result=await ai.execute({
          jobId:randomUUID(),stepId:randomUUID(),attemptId:randomUUID(),
          instructions:[
            'Você é o diretor de arte de pós-produção do Nivoo Studio.',
            'Analise a narração com seus tempos e proponha um plano de inserções visuais.',
            'Responda SOMENTE um JSON: {"elements":[{"kind":"caption","text":"...","start":0.0,"end":1.5,"x":0.5,"y":0.5,"style":"impact"},{"kind":"image","asset":"midia/entrada/...png","start":0,"end":2,"x":0.6,"y":0.3,"w":0.3,"h":0.2},{"kind":"graphic","text":"CORRIJA PLANILHAS","subtitle":"Menos retrabalho","variant":"spreadsheet","start":3,"end":5,"x":0.54,"y":0.25,"w":0.4,"h":0.22}],"explanation":"..."}',
            'Para legendas dinâmicas, escolha style=impact|fade|slide|rise|enter-left|enter-right e distribua os destaques por posições diferentes somente se houver área livre; mantenha ênfase e legibilidade.',
            'Para gráfico original local use kind=graphic com text, subtitle, variant=spreadsheet|clock|progress|warning|money|check|generic e x,y,w,h. A renderização cria um cartão visual PNG sem API paga.',
            'Use somente imagens de availableImages quando kind=image. Não invente imagens, logos, URLs ou fatos.',
            'Para qualquer texto, use frases narradas ou palavras fiéis ao roteiro; não faça alegações adicionais.',
            'Não sobreponha as áreas protectedZones. Use coordenadas de 0 a 1.',
            'Crie entradas de texto e figuras somente onde a fala pedir apoio; varie tamanho e posição de acordo com a composição. Não exagere na quantidade de overlays.',
            'Considere os frames fornecidos como referência visual; não encubra rosto, logo, textos ou dados. Caso seja incerto, reduza quantidade de elementos.',
            'O resultado será apenas uma PROPOSTA, que precisa ser validada e aceita pelo usuário.',
            'Não execute comandos, não crie código, não crie arquivos, não modifique o projeto.',
            JSON.stringify(payload)
          ].join('\n'),
          context:'Criar apenas plano de edição em JSON válido. Nenhuma ação externa.',
          cwd:outputDir,outputDir,timeoutMs:150000,signal:new AbortController().signal,
          onLog:()=>undefined,options:{maxTurns:1,images:snapshots}
        });
        if(result.exitCode!==0)throw new Error(result.error||'Falha ao consultar o agente de IA');
        const raw=parseAiJson(result.output) as {elements?:unknown;explanation?:unknown};
        if(!raw || !Array.isArray(raw.elements))throw new Error('JSON da IA sem elements[]');
        const valid:AiElement[]=[];
        const rejected:string[]=[];

        for(const v of raw.elements.slice(0,80)){
          if(!v||typeof v!=='object')continue;
          const e=v as AiElement;
          if(!finite(e.start,0,duration)||!finite(e.end,0,duration)||e.end<=e.start||
             !finite(e.x,0,1)||!finite(e.y,0,1))continue;
          let rect:{x:number;y:number;w:number;h:number};
          if(e.kind==='caption'){
            if(typeof e.text!=='string'||!e.text.trim()||e.text.length>100)continue;
            rect={x:Math.max(0,e.x-.40),y:Math.max(0,e.y-.065),w:Math.min(.8,1-Math.max(0,e.x-.40)),h:.13};
            if(!['impact','fade','slide','rise','enter-left','enter-right'].includes(e.style??'impact'))e.style='impact';
           }else if(e.kind==='graphic'){
            if(typeof e.text!=='string'||!e.text.trim()||e.text.length>55||
              (e.subtitle!==undefined&&(typeof e.subtitle!=='string'||e.subtitle.length>100)))continue;
            if(!['spreadsheet','clock','progress','warning','money','check','generic'].includes(e.variant||'generic'))e.variant='generic';
            if(!finite(e.w,.01,1)||!finite(e.h,.01,1)||e.x+e.w!>1||e.y+e.h!>1)continue;
            rect={x:e.x,y:e.y,w:e.w!,h:e.h!};
          }else if(e.kind==='image'){
            if(typeof e.asset!=='string'||!imageDetails.some(i=>i.source===e.asset))continue;
            if(!finite(e.w,.01,1)||!finite(e.h,.01,1)||e.x+e.w!>1||e.y+e.h!>1)continue;
            rect={x:e.x,y:e.y,w:e.w!,h:e.h!};
          }else continue;
          const placed=safeInsert(e,p.protectedZones??[],valid);
          if(!placed){rejected.push(`${e.kind} ${e.start.toFixed(2)}s: sem espaço seguro`);continue;}
          valid.push(placed);
        }
        if(!valid.length)throw new Error('A IA não propôs elementos válidos e seguros');
        aiStates.set(key,{state:'draft',elements:valid,explanation:(String(raw.explanation??'').slice(0,800)+(rejected.length?' | '+rejected.length+' elemento(s) omitido(s) por segurança.':''))});
      }catch(e:any){
        aiStates.set(key,{state:'failed',error:String(e?.message??e).slice(0,600)});
      }finally{snapshots.forEach(f=>fs.rmSync(f,{force:true}));}
    });
    return {state:'running'};
  }

  async aiRevise(pid:string,id:string,removeIndex:number) {
    await this.dir(pid);
    const key=pid+':'+id, draft=aiStates.get(key);
    if(draft?.state!=='draft'||!draft.elements)throw new BadRequestException('Não há plano em revisão');
    if(!Number.isInteger(removeIndex)||removeIndex<0||removeIndex>=draft.elements.length)
      throw new BadRequestException('Índice de proposta inválido');
    const revised=draft.elements.filter((_,i)=>i!==removeIndex);
    const state:AiState={...draft,elements:revised};
    aiStates.set(key,state);
    return state;
  }

  async aiApply(pid:string,id:string,updatedAt:string) {
    const key=pid+':'+id, draft=aiStates.get(key);
    if(draft?.state!=='draft'||!draft.elements?.length)throw new BadRequestException('Nenhuma proposta de IA disponível');
    const p=await this.get(pid,id);
    if(p.updatedAt!==updatedAt)throw new ConflictException('O projeto mudou após o planejamento. Gere a proposta novamente.');
    const captions=[...p.captions],assets=[...p.assets];
    const {media,studio}=await this.dir(pid);
    const generated:string[]=[];
    try{
    for(const el of draft.elements){
      if(el.kind==='caption')captions.push({id:'ai-'+randomUUID(),text:el.text!,start:el.start,end:el.end,
        x:el.x,y:el.y,fontSize:el.style==='impact'?66:50,color:'#FFFFFF',
        animation:el.style==='slide'?'slide':el.style==='fade'?'fade':el.style==='rise'?'rise':el.style==='enter-left'?'enter-left':el.style==='enter-right'?'enter-right':'pop'});
      else if(el.kind==='graphic'){
        const target=path.join(media,'saida','ai-graphic-'+randomUUID()+'.png');
        const input=path.join(studio,'ai','render-'+randomUUID()+'.json');
        fs.mkdirSync(path.dirname(input),{recursive:true});
        fs.writeFileSync(input,JSON.stringify({title:el.text,subtitle:el.subtitle,variant:el.variant}));
        try{
          await new Promise<void>((resolve,reject)=>{
            const child=spawn('node',[path.resolve(__dirname,'../../bin/nivoo-gerar-asset'),input,target],
              {stdio:['ignore','ignore','pipe']});
            let err='';
            const timer=setTimeout(()=>child.kill('SIGTERM'),25000);
            child.stderr?.on('data',b=>{err=(err+String(b)).slice(-1000);});
            child.on('error',e=>{clearTimeout(timer);reject(e)});
            child.on('close',code=>{clearTimeout(timer);code===0?resolve():reject(new Error(err||'Falha ao gerar imagem local'))});
          });
        }finally{fs.rmSync(input,{force:true})}
        generated.push(target);
        assets.push({id:'ai-'+randomUUID(),source:'midia/saida/'+path.basename(target),start:el.start,end:el.end,
          x:el.x,y:el.y,w:el.w!,h:el.h!,animation:el.style==='slide'?'slide':'fade'});
      }else assets.push({id:'ai-'+randomUUID(),source:el.asset!,start:el.start,end:el.end,
        x:el.x,y:el.y,w:el.w!,h:el.h!});
    }
    // Validação centralizada no mesmo método de salvamento manual.
    const saved=await this.save(pid,id,{...p,captions,assets});
    aiStates.delete(key);
    return saved;
    }catch(e){generated.forEach(f=>fs.rmSync(f,{force:true}));throw e}
  }

  async render(pid:string,id:string) {
    const {media} = await this.dir(pid);
    const p=this.validate(await this.get(pid,id),media);
    if (!p.clips.length) throw new BadRequestException('Adicione vídeos à timeline antes de exportar');
    const key=pid+':'+id, existing=status.get(key);
    if (existing?.result.state==='running') throw new ConflictException('Esta edição já está renderizando');
    const result:Status={state:'running',started:new Date().toISOString()};
    status.set(key,{result});
    // Executar após devolver resposta HTTP. O processo é externo e não bloqueia o event loop.
    setImmediate(()=>this.execute(media,p,key).catch(e=>{
      const current=status.get(key);
      if(current?.result.state==='running') current.result={...result,state:'failed',error:String(e?.message??e).slice(0,600)};
    }));
    return result;
  }
  state(pid:string,id:string) { return status.get(pid+':'+id)?.result ?? {state:'idle'}; }
  cancel(pid:string,id:string) {
    const entry=status.get(pid+':'+id);
    if(entry?.result.state==='running') {
      entry.result={...entry.result,state:'cancelled'};
      entry.process?.kill('SIGTERM');
    }
    return entry?.result??{state:'idle'};
  }
  private async execute(media:string,p:StudioProject,key:string) {
    const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'nivoo-studio-'));
    const entry=status.get(key)!;
    const ff=(args:string[])=>new Promise<void>((resolve,reject)=>{
      if(entry.result.state==='cancelled') return reject(new Error('cancelado'));
      const child=spawn('ffmpeg',['-nostdin','-hide_banner','-loglevel','error','-y',...args],{stdio:['ignore','ignore','pipe']});
      entry.process=child;let err='';
      child.stderr?.on('data',b=>{err=(err+String(b)).slice(-1800);});
      child.on('error',reject);
      child.on('close',code=>code===0?resolve():reject(new Error('FFmpeg: '+err.slice(-500))));
    });
    const probe=(file:string)=> {
      const r=spawnSync('ffprobe',['-v','error','-show_entries','stream=codec_type,width,height:format=duration','-of','json',file],{encoding:'utf8'});
      if(r.status!==0) throw new Error('Falha ffprobe: '+String(r.stderr).slice(-300));
      const j=JSON.parse(r.stdout);return {v:j.streams.find((s:any)=>s.codec_type==='video'),audio:j.streams.some((s:any)=>s.codec_type==='audio'),duration:Number(j.format.duration)};
    };
    try {
      const first=probe(this.src(media,p.clips[0].source));
      if(!first.v) throw new Error('Primeiro arquivo não é vídeo');
      const W=first.v.width%2?first.v.width-1:first.v.width, H=first.v.height%2?first.v.height-1:first.v.height;
      if(!W||!H) throw new Error('Resolução inválida');
      let current=0;
      const segments:string[]=[];
      for(const [i,c] of p.clips.entries()) {
        const source=this.src(media,c.source);
        const info=probe(source);
        if(!info.v) throw new Error('A faixa contém um áudio no lugar de vídeo');
        if(c.end>info.duration+.05) throw new Error('Corte excede duração de '+c.source);
        const duration=c.end-c.start;
        if(Math.abs(duration-c.duration)>.1) throw new Error('Duração incoerente em '+c.id);
        const file=path.join(tmp,'part-'+i+'.mp4');
        const input=info.audio?['-i',source]:['-i',source,'-f','lavfi','-t',String(duration),'-i','anullsrc=r=48000:cl=stereo'];
        await ff(['-ss',String(c.start),...input,'-t',String(duration),
          '-map','0:v:0','-map',info.audio?'0:a:0':'1:a:0',
          '-vf',`scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2,fps=30,format=yuv420p`,
          '-af',`volume=${c.volume??1}`,
          '-c:v','libx264','-preset','veryfast','-crf','20','-c:a','aac','-ar','48000','-ac','2','-movflags','+faststart',file]);
        segments.push(file); current+=duration;
      }
      const concat=path.join(tmp,'concat.txt');
      fs.writeFileSync(concat,segments.map(x=>`file '${x}'`).join('\n'));
      const joined=path.join(tmp,'joined.mp4');
      await ff(['-f','concat','-safe','0','-i',concat,'-c','copy',joined]);
      let audioBase=joined;
      if(p.soundtrack||(p.audioTracks?.length??0)>0) {
        const mix=path.join(tmp,'mix.mp4');
        const inputs:string[]=['-i',joined], f:string[]=[];
        const outputs:string[]=['[0:a]'];
        let stream=1;
        if(p.soundtrack){
          inputs.push('-stream_loop','-1','-i',this.src(media,p.soundtrack.source));
          f.push(`[${stream}:a]volume=${p.soundtrack.volume},atrim=duration=${current},asetpts=PTS-STARTPTS[music]`);
          outputs.push('[music]');stream++;
        }
        for(const [i,a] of (p.audioTracks??[]).entries()){
          const source=this.src(media,a.source);
          const info=probe(source);
          if(!info.audio||a.end>info.duration+.05)throw new Error('Faixa de áudio inválida: '+a.source);
          inputs.push('-i',source);
          const ms=Math.round(a.offset*1000);
          const len=a.end-a.start;
          const fi=Math.min(a.fadeIn??0,len/2),fo=Math.min(a.fadeOut??0,len/2);
          const fades=(fi>.001?`,afade=t=in:st=0:d=${fi}`:'')+
            (fo>.001?`,afade=t=out:st=${Math.max(0,len-fo)}:d=${fo}`:'');
          f.push(`[${stream}:a]atrim=start=${a.start}:end=${a.end},asetpts=PTS-STARTPTS,volume=${a.volume}${fades},adelay=${ms}:all=1[track${i}]`);
          outputs.push(`[track${i}]`);stream++;
        }
        f.push(outputs.join('')+`amix=inputs=${outputs.length}:duration=first:dropout_transition=0[a]`);
        await ff([...inputs,'-filter_complex',f.join(';'),'-map','0:v:0','-map','[a]',
          '-c:v','copy','-c:a','aac','-b:a','192k','-t',String(current),mix]);
        audioBase=mix;
      }
      const ass=path.join(tmp,'captions.ass');
      const h='[Script Info]\nScriptType: v4.00+\nPlayResX: '+W+'\nPlayResY: '+H+'\nScaledBorderAndShadow: yes\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,DejaVu Sans,54,&H00FFFFFF,&H00FFFFFF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,3,1,7,0,0,0,1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n';
      const lines=p.captions.map(c=>{
        const x=Math.round(c.x*W),y=Math.round(c.y*H);
        const offset=Math.round(Math.min(W*0.12,120));
        const sx=c.animation==='enter-left'?x-offset:c.animation==='enter-right'?x+offset:x;
        const sy=c.animation==='slide'?y+50:c.animation==='rise'?y+Math.round(H*.08):y;
        const moving=['slide','rise','enter-left','enter-right'].includes(c.animation??'');
        const effect=moving?`\\move(${sx},${sy},${x},${y},0,350)`:`\\pos(${x},${y})`;
        const fade=c.animation==='fade'?'\\fad(160,160)':'';
        const pop=c.animation==='pop'?'\\t(0,200,\\fscx110\\fscy110)':'';
        const kinetic=c.animation==='karaoke'?karaokeAss(c,esc):null;
        const subtitle=kinetic??esc(c.text);
        const kineticColors=kinetic?'\\1c&H0000D7FF&\\2c&H00D1D5DB&':'';
        return `Dialogue: 0,${assTime(c.start)},${assTime(c.end)},Default,,0,0,0,,{\\an5\\fs${c.fontSize??54}\\c${assColor(c.color&&color(c.color)?c.color:'#FFFFFF')}${effect}${fade}${pop}${kineticColors}}${subtitle}`;
      });
      fs.writeFileSync(ass,h+lines.join('\n')+'\n');
      const imgs=p.assets;
      const args=['-i',audioBase,...imgs.flatMap(a=>['-loop','1','-i',this.src(media,a.source)])];
      const filters:string[]=[];let v='[0:v]';
      for(let i=0;i<imgs.length;i++){
        const a=imgs[i],wid=Math.max(2,Math.floor(a.w*W/2)*2),hei=Math.max(2,Math.floor(a.h*H/2)*2);
        // A animação acontece na timeline global; o áudio original fica intacto.
        const intro=Math.min(.24,Math.max(.06,(a.end-a.start)/5));
        const ox=Math.round(a.x*W),oy=Math.round(a.y*H);
        const movement=Math.round(Math.min(W*.1,75));
        const x=a.animation==='slide'?
          `if(lt(t,${a.start+intro}),${ox}-${movement}*(1-(t-${a.start})/${intro}),${ox})`:String(ox);
        const fade=a.animation==='none'?'':`,fade=t=in:st=0:d=${intro}:alpha=1`;
        filters.push(`[${i+1}:v]scale=${wid}:${hei},format=rgba${fade},setpts=PTS-STARTPTS+${a.start}/TB[asset${i}]`);
        filters.push(`${v}[asset${i}]overlay=x='${x}':y=${oy}:enable='between(t,${a.start},${a.end})':shortest=0:eof_action=repeat[v${i}]`);
        v=`[v${i}]`;
      }
      filters.push(`${v}subtitles=${ass},format=yuv420p[video]`);
      const output=path.join(media,'saida','studio-'+p.id+'-'+Date.now()+'.mp4');
      fs.mkdirSync(path.dirname(output),{recursive:true});
      await ff([...args,'-filter_complex',filters.join(';'),'-map','[video]','-map','0:a:0',
        '-c:v','libx264','-preset','veryfast','-crf','20','-pix_fmt','yuv420p','-c:a','copy','-t',String(current),'-movflags','+faststart',output]);
      if(entry.result.state==='cancelled') {fs.rmSync(output,{force:true});return;}
      if(!fs.existsSync(output)||!fs.statSync(output).size) throw new Error('Exportação vazia');
      entry.result={...entry.result,state:'done',output:'midia/saida/'+path.basename(output)};
    } finally {entry.process=undefined;fs.rmSync(tmp,{recursive:true,force:true});}
  }
}
