import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { spawn, spawnSync, ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { WorkspaceService } from '../storage/workspace.service';
import { arquivoDaMidia } from '../projects/midia';

export type StudioClip = {
  id: string; source: string; start: number; end: number; duration: number;
  volume?: number;
};
export type StudioCaption = {
  id: string; text: string; start: number; end: number; x: number; y: number;
  fontSize?: number; color?: string; animation?: 'fade'|'pop'|'slide';
};
export type StudioAsset = {
  id: string; source: string; start: number; end: number;
  x: number; y: number; w: number; h: number;
};
export type StudioProject = {
  version: 1; id: string; title: string; clips: StudioClip[];
  soundtrack?: { source: string; volume: number } | null;
  captions: StudioCaption[]; assets: StudioAsset[];
  updatedAt: string;
};
type Status = { state: 'running'|'done'|'failed'|'cancelled'; error?: string; output?: string; started: string };
const finite = (n: unknown, min = 0, max = 100000) => typeof n === 'number' && Number.isFinite(n) && n >= min && n <= max;
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

@Injectable()
export class VideoStudioService {
  constructor(private readonly prisma: PrismaService, private readonly workspace: WorkspaceService) {}

  private async dir(pid: string) {
    const project = await this.prisma.project.findUnique({ where: { id: pid }, select: { dirKey: true } });
    if (!project) throw new NotFoundException('Projeto não encontrado');
    const media = this.workspace.projectDirs(project.dirKey).midia;
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
        p.clips.length > 200 || p.captions.length > 1000 || p.assets.length > 150)
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
    for (const c of p.captions) {
      ident(c);
      if (typeof c.text !== 'string' || !c.text.trim() || c.text.length > 250 ||
          !finite(c.start,0,total) || !finite(c.end,0,total) || c.end<=c.start ||
          !finite(c.x,0,1) || !finite(c.y,0,1) || !finite(c.fontSize ?? 54,12,140) ||
          (c.color && !color(c.color))) throw new BadRequestException('Legenda inválida');
    }
    for (const a of p.assets) {
      ident(a); this.src(media,a.source);
      if (!finite(a.start,0,total) || !finite(a.end,0,total) || a.end<=a.start ||
          !finite(a.x,0,1) || !finite(a.y,0,1) || !finite(a.w,.01,1) ||
          !finite(a.h,.01,1) || a.x+a.w>1 || a.y+a.h>1)
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
    const p:StudioProject = {version:1,id:randomUUID(),title:String(title).slice(0,150),clips:[],captions:[],assets:[],soundtrack:null,updatedAt:new Date().toISOString()};
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
    if(done?.state!=='done'||!done.output) throw new BadRequestException('Exporte primeiro o vídeo com a narração para gerar legendas por palavra');
    if(script!==undefined&&(typeof script!=='string'||script.length>10000))
      throw new BadRequestException('Roteiro inválido');
    transcriptions.set(key,{state:'running'});
    setImmediate(async()=>{
      const temp=fs.mkdtempSync(path.join(os.tmpdir(),'nivoo-caption-'));
      try {
        const {media,studio}=await this.dir(pid);
        const input=this.src(media,done.output!);
        const alignment=path.join(temp,'aligned.json');
        const cmd=path.resolve(__dirname,'../../bin/nivoo-alinhar-narracao');
        const args=[cmd,'--video',input,'--saida',alignment];
        if(script?.trim()){
          const textFile=path.join(temp,'script.txt');
          fs.writeFileSync(textFile,script.trim());
          args.push('--roteiro',textFile);
        }
        await new Promise<void>((resolve,reject)=>{
          const child=spawn('python3',args,{stdio:['ignore','ignore','pipe']});
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
          groups.push({
            id:'auto-'+randomUUID(),text:w.map((v:any)=>v.text).join(' ').trim(),
            start:w[0].start,end:w[w.length-1].end,x:.50,y:.82,
            animation:'pop',fontSize:54,color:'#FFFFFF'
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
      if(p.soundtrack) {
        const music=path.join(tmp,'music.mp4');
        await ff(['-i',joined,'-stream_loop','-1','-i',this.src(media,p.soundtrack.source),
          '-filter_complex',`[1:a]volume=${p.soundtrack.volume}[music];[0:a][music]amix=inputs=2:duration=first:dropout_transition=0[a]`,
          '-map','0:v:0','-map','[a]','-c:v','copy','-c:a','aac','-b:a','192k','-t',String(current),music]);
        audioBase=music;
      }
      const ass=path.join(tmp,'captions.ass');
      const h='[Script Info]\nScriptType: v4.00+\nPlayResX: '+W+'\nPlayResY: '+H+'\nScaledBorderAndShadow: yes\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,DejaVu Sans,54,&H00FFFFFF,&H00FFFFFF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,3,1,7,0,0,0,1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n';
      const lines=p.captions.map(c=>{
        const x=Math.round(c.x*W),y=Math.round(c.y*H);
        const effect=c.animation==='slide'?`\\move(${x},${y+50},${x},${y},0,350)`: `\\pos(${x},${y})`;
        const fade=c.animation==='fade'?'\\fad(160,160)':'';
        const pop=c.animation==='pop'?'\\t(0,200,\\fscx110\\fscy110)':'';
        return `Dialogue: 0,${assTime(c.start)},${assTime(c.end)},Default,,0,0,0,,{\\an5\\fs${c.fontSize??54}\\c${assColor(c.color&&color(c.color)?c.color:'#FFFFFF')}${effect}${fade}${pop}}${esc(c.text)}`;
      });
      fs.writeFileSync(ass,h+lines.join('\n')+'\n');
      const imgs=p.assets;
      const args=['-i',audioBase,...imgs.flatMap(a=>['-loop','1','-i',this.src(media,a.source)])];
      const filters:string[]=[];let v='[0:v]';
      for(let i=0;i<imgs.length;i++){
        const a=imgs[i],wid=Math.max(2,Math.floor(a.w*W/2)*2),hei=Math.max(2,Math.floor(a.h*H/2)*2);
        filters.push(`[${i+1}:v]scale=${wid}:${hei},format=rgba[asset${i}]`);
        filters.push(`${v}[asset${i}]overlay=x=${Math.round(a.x*W)}:y=${Math.round(a.y*H)}:enable='between(t,${a.start},${a.end})':shortest=0:eof_action=repeat[v${i}]`);
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
