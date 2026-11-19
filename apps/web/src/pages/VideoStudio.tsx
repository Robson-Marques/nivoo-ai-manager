import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, enviarVideo, urlAutenticada } from '../api';
import './VideoStudio.css';

type Media = { caminho:string; nome:string; bytes:number; pasta:string };
type Clip = { id:string; source:string; start:number; end:number; duration:number; volume?:number };
type Caption = { id:string; text:string; start:number; end:number; x:number; y:number; fontSize?:number; color?:string; animation?:'fade'|'pop'|'slide'|'karaoke'; words?:Array<{text:string;start:number;end:number}> };
type ProtectedZone = {id:string;label:string;start:number;end:number;x:number;y:number;w:number;h:number};
type AudioTrack = {id:string;source:string;start:number;end:number;offset:number;volume:number};
type Asset = { id:string; source:string; start:number; end:number; x:number; y:number; w:number; h:number; animation?:'fade'|'slide'|'none' };
type Studio = { version:1; id:string; title:string; clips:Clip[]; captions:Caption[]; assets:Asset[]; audioTracks?:AudioTrack[]; protectedZones?:ProtectedZone[]; soundtrack?:{source:string; volume:number}|null;updatedAt:string };
type AiElement={kind:'caption'|'image';text?:string;asset?:string;start:number;end:number;x:number;y:number;w?:number;h?:number};
type AiResult={state:'idle'|'running'|'draft'|'failed';error?:string;elements?:AiElement[];explanation?:string};
type Render = { state:'idle'|'running'|'done'|'failed'|'cancelled';error?:string;output?:string };
const num = (v:string,fallback=0) => Number.isFinite(Number(v))?Number(v):fallback;
const fmt = (s:number) => !Number.isFinite(s) ? '00:00' : String(Math.floor(s/60)).padStart(2,'0')+':'+String(Math.floor(s%60)).padStart(2,'0');
const midiaUrl=(pid:string,p:string)=>urlAutenticada('/api/projects/'+pid+'/midia/content?path='+encodeURIComponent(p));
const ident=()=>crypto.randomUUID();

export function VideoStudio() {
  const {pid=''}=useParams();
  const [list,setList]=useState<Array<{id:string;title:string}>>([]);
  const [media,setMedia]=useState<Media[]>([]);
  const [project,setProject]=useState<Studio|null>(null);
  const [selected,setSelected]=useState<string|null>(null);
  const [tab,setTab]=useState<'clips'|'captions'|'assets'|'audio'|'protected'>('clips');
  const [playhead,setPlayhead]=useState(0);
  const [running,setRunning]=useState<Render>({state:'idle'});
  const [aiDraft,setAiDraft]=useState<AiResult>({state:'idle'});
  const [aligning,setAligning]=useState<{state:string;error?:string;captions?:number}>({state:'idle'});
  const [busy,setBusy]=useState(false);
  const [dirty,setDirty]=useState(false);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const [progress,setProgress]=useState(0);
  const inputRef=useRef<HTMLInputElement>(null);
  const player=useRef<HTMLVideoElement>(null);
  const soundtrackPlayer=useRef<HTMLAudioElement>(null);
  const audioPlayers=useRef(new Map<string,HTMLAudioElement>());
  const undoStack=useRef<Studio[]>([]);
  const redoStack=useRef<Studio[]>([]);
  const dragged=useRef<string|null>(null);
  const clips=project?.clips||[];
  const total=clips.reduce((n,c)=>n+c.duration,0);
  const active=useMemo(()=>{
    let pos=0;
    for(const c of clips) { if(playhead<pos+c.duration) return {clip:c,offset:playhead-pos,begin:pos};pos+=c.duration; }
    return clips.length?{clip:clips[clips.length-1],offset:clips[clips.length-1].duration,begin:pos-clips[clips.length-1].duration}:null;
  },[clips,playhead]);
  const selectedClip=clips.find(c=>c.id===selected);
  const selectedCaption=project?.captions.find(c=>c.id===selected);
  const selectedAsset=project?.assets.find(c=>c.id===selected);
  const selectedAudio=project?.audioTracks?.find(c=>c.id===selected);
  const selectedZone=project?.protectedZones?.find(c=>c.id===selected);

  const refresh=async()=> {
    const [s,m]=await Promise.all([
      api<Array<{id:string;title:string}>>('/projects/'+pid+'/studio'),
      api<{videos:Media[]}>('/projects/'+pid+'/videos')
    ]);
    setList(s);setMedia(m.videos);
  };
  useEffect(()=>{refresh().catch(e=>setError(e.message));},[pid]);
  useEffect(()=>{
    if(!project || running.state!=='running')return;
    const timer=setInterval(()=>api<Render>('/projects/'+pid+'/studio/'+project.id+'/render').then(setRunning).catch(()=>undefined),1700);
    return()=>clearInterval(timer);
  },[project?.id,pid,running.state]);
  const open=async(id:string)=>{
    if(dirty&&!window.confirm('Descartar alterações não salvas?')) return;
    const p=await api<Studio>('/projects/'+pid+'/studio/'+id);
    setProject(p);setPlayhead(0);setSelected(null);setDirty(false);setError('');setNotice('');setAiDraft({state:'idle'});undoStack.current=[];redoStack.current=[];
  };
  useEffect(()=>{
    if(!project || aligning.state!=='running')return;
    const timer=setInterval(async()=>{
      try {
        const st=await api<{state:string;error?:string;captions?:number}>('/projects/'+pid+'/studio/'+project.id+'/captions/auto');
        setAligning(st);
        if(st.state==='done'){
          const fresh=await api<Studio>('/projects/'+pid+'/studio/'+project.id);
          setProject(fresh);setDirty(false);setNotice(st.captions+' legendas adicionadas.');
        }
      }catch(e:any){setError(e.message)}
    },2000);
    return()=>clearInterval(timer);
  },[project?.id,pid,aligning.state]);
  const gerarLegendas=async()=>{
    if(!project || dirty)return setError('Salve primeiro as alterações da timeline.');
    const texto=window.prompt('Cole o roteiro exato, se existir. Se não houver, deixe vazio para transcrever a fala do vídeo.','');
    if(texto===null)return;
    try{
      const r=await api<{state:string}>('/projects/'+pid+'/studio/'+project.id+'/captions/auto','POST',{script:texto});
      setAligning(r);setNotice('Alinhamento local iniciado.');
    }catch(e:any){setError(e.message)}
  };
  useEffect(()=>{
    if(!project||aiDraft.state!=='running')return;
    const timer=setInterval(async()=>{
      try{setAiDraft(await api<AiResult>('/projects/'+pid+'/studio/'+project.id+'/ai/plan'));}
      catch(e:any){setAiDraft({state:'failed',error:e.message})}
    },1800);
    return()=>clearInterval(timer);
  },[pid,project?.id,aiDraft.state]);
  const planAi=async()=>{
    if(!project||dirty)return setError('Salve o projeto antes de solicitar a análise de IA.');
    const brief=window.prompt('Qual estilo de pós-produção você deseja?','Legendas dinâmicas, palavras destacadas e imagens de apoio contextuais, sem exageros.');
    if(brief===null)return;
    try{setAiDraft(await api<AiResult>('/projects/'+pid+'/studio/'+project.id+'/ai/plan','POST',{brief}));setError('');}
    catch(e:any){setError(e.message)}
  };
  const applyAi=async()=>{
    if(!project||dirty)return setError('Salve o projeto antes de aceitar a proposta.');
    try{
      const p=await api<Studio>('/projects/'+pid+'/studio/'+project.id+'/ai/apply','POST',{updatedAt:project.updatedAt});
      setProject(p);setAiDraft({state:'idle'});setNotice('Composição sugerida aplicada à timeline. Você pode ajustar cada elemento.');setSelected(null);
    }catch(e:any){setError(e.message)}
  };
  const newProject=async()=>{
    const name=window.prompt('Nome da edição','Novo vídeo');
    if(name===null)return;
    const p=await api<Studio>('/projects/'+pid+'/studio','POST',{title:name||'Novo vídeo'});
    await refresh();setProject(p);setDirty(false);setPlayhead(0);setSelected(null);undoStack.current=[];redoStack.current=[];
  };
  const mutate=(fn:(p:Studio)=>Studio)=>{
    if(!project)return;
    undoStack.current.push(project);
    if(undoStack.current.length>60)undoStack.current.shift();
    redoStack.current=[];
    setProject(fn(project));setDirty(true);setNotice('');
  };
  const undo=()=>{
    const prev=undoStack.current.pop();if(!prev||!project)return;
    redoStack.current.push(project);setProject(prev);setDirty(true);
  };
  const redo=()=>{
    const next=redoStack.current.pop();if(!next||!project)return;
    undoStack.current.push(project);setProject(next);setDirty(true);
  };
  useEffect(()=>{
    const listener=(e:KeyboardEvent)=>{
      if(!(e.ctrlKey||e.metaKey)||e.key.toLowerCase()!=='z')return;
      const target=e.target as HTMLElement;
      if(['INPUT','TEXTAREA'].includes(target.tagName)||target.isContentEditable)return;
      e.preventDefault();if(e.shiftKey)redo();else undo();
    };
    document.addEventListener('keydown',listener);
    return()=>document.removeEventListener('keydown',listener);
  });
  const save=async()=>{
    if(!project)return;
    setBusy(true);setError('');
    try {
      const p=await api<Studio>('/projects/'+pid+'/studio/'+project.id,'PATCH',project);
      setProject(p);setDirty(false);setNotice('Projeto salvo');
      await refresh();
    }catch(e:any){setError(e.message)}finally{setBusy(false)}
  };
  const mediaVideo=media.filter(m=>/\.(mp4|mov|webm|mkv|m4v)$/i.test(m.caminho));
  const mediaAudio=media.filter(m=>/\.(mp3|wav|m4a|aac|ogg|flac)$/i.test(m.caminho));
  const mediaImage=media.filter(m=>/\.(png|jpg|jpeg|webp)$/i.test(m.caminho));
  const append=(m:Media)=>{
    if(!project)return;
    // Duracão real obtida pelo player de metadados antes de inserir.
    const obj=document.createElement('video');
    obj.preload='metadata';
    obj.onloadedmetadata=()=>{
      const duration=Math.min(14400,Number(obj.duration));
      if(!Number.isFinite(duration)||duration<=0)return setError('Não consegui identificar a duração deste vídeo.');
      const c:Clip={id:ident(),source:m.caminho,start:0,end:duration,duration};
      mutate(p=>({...p,clips:[...p.clips,c]}));setSelected(c.id);setTab('clips');
    };
    obj.onerror=()=>setError('Não consegui carregar metadados do vídeo. Verifique o formato.');
    obj.src=midiaUrl(pid,m.caminho);
  };
  const addCaption=()=>{
    const c:Caption={id:ident(),text:'Seu texto aqui',start:Math.min(playhead,Math.max(0,total-.5)),end:Math.min(total,playhead+2),x:.5,y:.82,fontSize:54,color:'#FFFFFF',animation:'fade'};
    if(c.end<=c.start)return setError('Adicione vídeos à timeline antes de criar legendas.');
    mutate(p=>({...p,captions:[...p.captions,c]}));setSelected(c.id);setTab('captions');
  };
  const addAudio=(m:Media)=>{
    if(total<=0)return setError('Adicione vídeos à timeline antes de inserir narração.');
    const obj=document.createElement('audio');
    obj.preload='metadata';
    obj.onloadedmetadata=()=>{
      const end=Math.min(obj.duration,Math.max(.05,total-playhead));
      if(!Number.isFinite(end)||end<=0)return setError('Áudio sem duração válida');
      const a:AudioTrack={id:ident(),source:m.caminho,start:0,end,offset:playhead,volume:1};
      mutate(p=>({...p,audioTracks:[...(p.audioTracks??[]),a]}));setSelected(a.id);setTab('audio');
    };
    obj.onerror=()=>setError('Falha ao ler a duração do áudio.');
    obj.src=midiaUrl(pid,m.caminho);
  };
  const addImage=(m:Media)=>{
    if(!total)return setError('Adicione vídeos à timeline antes de inserir imagens.');
    const a:Asset={id:ident(),source:m.caminho,start:Math.min(playhead,Math.max(0,total-.5)),end:Math.min(total,playhead+3),x:.58,y:.25,w:.32,h:.2,animation:'fade'};
    if(a.end<=a.start)return;
    mutate(p=>({...p,assets:[...p.assets,a]}));setSelected(a.id);setTab('assets');
  };
  const updateClip=(key:keyof Clip,value:string)=>{
    const n=num(value);
    mutate(p=>({...p,clips:p.clips.map(c=>{
      if(c.id!==selected)return c;
      const next={...c,[key]:n};
      if(key==='start'||key==='end') next.duration=Math.max(.05,next.end-next.start);
      return next;
    })}));
  };
  const updateCaption=(key:keyof Caption,value:string)=>{
    mutate(p=>({...p,captions:p.captions.map(c=>c.id===selected?{...c,[key]:key==='text'||key==='color'||key==='animation'?value:num(value),...(key==='text'?{words:undefined,animation:c.animation==='karaoke'?'fade':c.animation}:{})}:c)}));
  };
  const addZone=()=>{
    if(total<=0)return setError('Adicione vídeo antes de definir uma zona protegida.');
    const zone:ProtectedZone={id:ident(),label:'Rosto / logo',start:0,end:total,x:.67,y:.04,w:.27,h:.2};
    mutate(p=>({...p,protectedZones:[...(p.protectedZones??[]),zone]}));
    setTab('protected');setSelected(zone.id);
  };
  const updateZone=(key:keyof ProtectedZone,value:string)=>{
    mutate(p=>({...p,protectedZones:(p.protectedZones??[]).map(z=>z.id===selected?{...z,[key]:key==='label'?value:num(value)}:z)}));
  };
  const updateAudio=(key:keyof AudioTrack,value:string)=>{
    mutate(p=>({...p,audioTracks:(p.audioTracks??[]).map(a=>a.id===selected?{...a,[key]:key==='source'?value:num(value)}:a)}));
  };
  const updateAsset=(key:keyof Asset,value:string)=>{
    mutate(p=>({...p,assets:p.assets.map(a=>a.id===selected?{...a,[key]:key==='source'||key==='animation'?value:num(value)}:a)}));
  };
  const move=(id:string,dir:number)=>{
    mutate(p=>{const a=[...p.clips],i=a.findIndex(c=>c.id===id),j=i+dir;
      if(i<0||j<0||j>=a.length)return p;
      [a[i],a[j]]=[a[j],a[i]];return {...p,clips:a};});
  };
  const split=()=>{
    if(!active || active.clip.id!==selected || active.offset<=.05 || active.offset>=active.clip.duration-.05) return setError('Posicione o cursor dentro do clipe selecionado para dividir.');
    const c=active.clip,cut=c.start+active.offset;
    const left={...c,end:cut,duration:cut-c.start};
    const right={...c,id:ident(),start:cut,duration:c.end-cut};
    mutate(p=>{const i=p.clips.findIndex(v=>v.id===c.id);return {...p,clips:[...p.clips.slice(0,i),left,right,...p.clips.slice(i+1)]};});
    setSelected(right.id);
  };
  const reorder=(id:string,target:string)=>{
    if(id===target)return;
    mutate(p=>{
      const arr=[...p.clips],from=arr.findIndex(v=>v.id===id),to=arr.findIndex(v=>v.id===target);
      if(from<0||to<0)return p;
      const [clip]=arr.splice(from,1);
      arr.splice(to,0,clip);
      return {...p,clips:arr};
    });
  };
  const remove=()=>{
    mutate(p=>({...p,clips:p.clips.filter(c=>c.id!==selected),captions:p.captions.filter(c=>c.id!==selected),assets:p.assets.filter(c=>c.id!==selected),audioTracks:(p.audioTracks??[]).filter(c=>c.id!==selected),protectedZones:(p.protectedZones??[]).filter(c=>c.id!==selected)}));
    setSelected(null);
  };
  const exportar=async()=>{
    if(!project)return;
    if(dirty)return setError('Salve a edição antes de exportar.');
    setError('');
    try {setRunning(await api<Render>('/projects/'+pid+'/studio/'+project.id+'/render','POST',{}))}
    catch(e:any){setError(e.message)}
  };
  const upload=async(files:FileList|null)=>{
    if(!files)return;
    setBusy(true);setError('');
    try {
      for(const f of Array.from(files)) await enviarVideo(pid,f,setProgress);
      await refresh();setNotice('Arquivos adicionados à biblioteca de mídia.');
    }catch(e:any){setError(e.message)}finally{setBusy(false);setProgress(0)}
  };
  const syncAudio=(t:number,shouldPlay:boolean)=>{
    if(soundtrackPlayer.current){
      const a=soundtrackPlayer.current;
      a.volume=Math.min(1,Math.max(0,project?.soundtrack?.volume??0));
      if(Math.abs(a.currentTime-t)>.35){try{a.currentTime=t}catch{/* metadata pendente */}}
      if(shouldPlay&&a.paused)a.play().catch(()=>undefined);
      if(!shouldPlay&&!a.paused)a.pause();
    }
    for(const track of project?.audioTracks??[]){
      const a=audioPlayers.current.get(track.id);
      if(!a)continue;
      a.volume=Math.min(1,Math.max(0,track.volume));
      const position=t-track.offset,inside=position>=0&&position<track.end-track.start;
      if(inside){
        const at=track.start+position;
        if(Math.abs(a.currentTime-at)>.35){try{a.currentTime=at}catch{/* metadata pendente */}}
        if(shouldPlay&&a.paused)a.play().catch(()=>undefined);
        if(!shouldPlay&&!a.paused)a.pause();
      }else if(!a.paused)a.pause();
    }
  };
  const seek=(t:number)=>{
    const target=Math.max(0,Math.min(total,t));
    const same=active && target>=active.begin && target<active.begin+active.clip.duration;
    if(same && player.current) player.current.currentTime=active.clip.start+(target-active.begin);
    setPlayhead(target);
    syncAudio(target,Boolean(player.current&&!player.current.paused));
  };
  const playing=useRef(false);
  const onVideoTime=()=>{
    if(!active||!player.current)return;
    const pos=Math.max(0,player.current.currentTime-active.clip.start);
    syncAudio(active.begin+pos,!player.current.paused);
    if(pos>=active.clip.duration-.06 && active.begin+active.clip.duration<total-.05) {
      const continuePlay=!player.current.paused;
      playing.current=continuePlay;
      setPlayhead(Math.min(total,active.begin+active.clip.duration+.002));
    } else setPlayhead(Math.min(total,active.begin+pos));
  };
  const onVideoEnded=()=>{
    if(active && playhead<total-.05) seek(active.begin+active.clip.duration+.005);
    else playing.current=false;
  };
  useEffect(()=>{
    if(!active||!player.current)return;
    const target=active.clip.start+active.offset;
    if(Math.abs(player.current.currentTime-target)>.20)player.current.currentTime=target;
    player.current.volume=Math.max(0,Math.min(1,active.clip.volume??1));
    if(playing.current&&player.current.paused) player.current.play().catch(()=>undefined);
  },[active?.clip.id,active?.offset===0]);
  const chatInstruction='Analise a narração do vídeo e crie legendas cinéticas e imagens de apoio no Nivoo Studio. Não cubra rostos, logos ou textos importantes. Utilize o vídeo e a timeline salvos no projeto.';
  const activeCaptions=project?.captions.filter(c=>c.start<=playhead&&c.end>playhead)||[];
  const activeAssets=project?.assets.filter(a=>a.start<=playhead&&a.end>playhead)||[];

  return <section className="studio">
    <header className="studio-head">
      <div><Link to={'/p/'+pid}>← Projeto</Link><h2>Nivoo Studio</h2><span>Edição não destrutiva • assistência de IA opcional</span></div>
      <div className="studio-actions">
        {project&&<><button disabled={!undoStack.current.length} onClick={undo}>↶ Desfazer</button><button disabled={!redoStack.current.length} onClick={redo}>↷ Refazer</button><button disabled={!dirty||busy} onClick={save}>Salvar {dirty?'●':''}</button><button disabled={busy||running.state==='running'} onClick={exportar}>Exportar MP4</button></>}
        <button onClick={newProject}>+ Nova edição</button>
      </div>
    </header>
    {error&&<p className="studio-error" role="alert">{error}</p>}
    {notice&&<p className="studio-notice">{notice}</p>}
    {aligning.state==='failed'&&<p className="studio-error">Legendas automáticas: {aligning.error}</p>}
    {aligning.state==='running'&&<p className="studio-notice">Alinhando a fala com o vídeo localmente…</p>}
    {running.state==='running'&&<p className="studio-notice">Renderização em execução. Você pode continuar usando a interface.</p>}
    {running.state==='failed'&&<p className="studio-error">Falha na exportação: {running.error}</p>}
    {running.state==='done'&&running.output&&<a href={midiaUrl(pid,running.output)} target="_blank" rel="noreferrer">Abrir vídeo exportado</a>}
    {!project?<div className="studio-start"><h3>Suas edições</h3>{list.map(x=><button key={x.id} onClick={()=>open(x.id)}>{x.title}</button>)}<button onClick={newProject}>Criar primeira edição</button></div>:
    <>
      <div className="studio-workspace">
        <aside className="studio-library">
          <h3>Biblioteca</h3>
          <label className="studio-upload">+ Importar mídias<input ref={inputRef} type="file" multiple hidden accept="video/*,audio/*,image/png,image/jpeg,image/webp" onChange={e=>upload(e.target.files)} /></label>
          {busy&&progress>0&&<small>Enviando {progress}%</small>}
          <h4>Vídeos</h4>{mediaVideo.map(m=><button title={m.nome} key={m.caminho} onClick={()=>append(m)}>＋ {m.nome}</button>)}
          <h4>Imagens</h4>{mediaImage.map(m=><button title={m.nome} key={m.caminho} onClick={()=>addImage(m)}>＋ {m.nome}</button>)}
          <h4>Áudios</h4>{mediaAudio.map(m=><div key={m.caminho} className="studio-audio-source"><span title={m.nome}>{m.nome}</span><button onClick={()=>addAudio(m)} title="Adicionar faixa de narração">＋ Voz</button><button onClick={()=>{mutate(p=>({...p,soundtrack:{source:m.caminho,volume:.24}}));setTab('audio');}} title="Definir trilha musical">♫ Trilha</button></div>)}
          <h4>Edições</h4>{list.map(x=><button key={x.id} onClick={()=>open(x.id)}>{x.title}</button>)}
        </aside>
        <main className="studio-preview-panel">
          <div className="studio-canvas">
            {project.soundtrack&&<audio ref={soundtrackPlayer} src={midiaUrl(pid,project.soundtrack.source)} loop preload="metadata"/>}
            {(project.audioTracks??[]).map(t=><audio key={t.id} ref={el=>{if(el)audioPlayers.current.set(t.id,el);else audioPlayers.current.delete(t.id);}} src={midiaUrl(pid,t.source)} preload="metadata"/>)}
            {active?<video key={active.clip.source} ref={player} src={midiaUrl(pid,active.clip.source)} playsInline onTimeUpdate={onVideoTime} onEnded={onVideoEnded} onPause={()=>{playing.current=false;syncAudio(playhead,false)}} />:<span>Adicione um vídeo para começar</span>}
            {(project.protectedZones??[]).filter(z=>z.start<=playhead&&z.end>playhead).map(z=><div key={z.id} className="studio-protected" style={{left:(z.x*100)+'%',top:(z.y*100)+'%',width:(z.w*100)+'%',height:(z.h*100)+'%'}} title={z.label}><span>{z.label}</span></div>)}
            {activeAssets.map(a=><img key={a.id} src={midiaUrl(pid,a.source)} className={'studio-asset studio-asset-'+(a.animation||'fade')} alt="" style={{left:(a.x*100)+'%',top:(a.y*100)+'%',width:(a.w*100)+'%',height:(a.h*100)+'%'}}/>)}
            {activeCaptions.map(c=><div key={c.id} className={'studio-caption studio-caption-'+(c.animation||'fade')} style={{left:(c.x*100)+'%',top:(c.y*100)+'%',fontSize:'clamp(12px,'+(c.fontSize??54)/25+'vw,64px)',color:c.color||'#fff'}}>{c.animation==='karaoke'&&c.words?.length?c.words.map((w,i)=><span key={i} className={playhead>=w.start&&playhead<w.end?'studio-word-active':'studio-word'}>{w.text}{i<c.words!.length-1?' ':''}</span>):c.text}</div>)}
          </div>
          <div className="studio-play-controls">
            <button onClick={()=>seek(playhead-5)}>−5s</button>
            <button onClick={()=>{if(!player.current)return;if(player.current.paused){playing.current=true;player.current.play().catch(()=>undefined);syncAudio(playhead,true);}else{player.current.pause();syncAudio(playhead,false);}}}>▶ / ❚❚</button>
            <button onClick={()=>seek(playhead+5)}>+5s</button>
            <span>{fmt(playhead)} / {fmt(total)}</span>
          </div>
          <input aria-label="Posição do vídeo" type="range" min="0" max={Math.max(total,.01)} step=".01" value={Math.min(playhead,total)} onChange={e=>seek(Number(e.target.value))}/>
        </main>
        <aside className="studio-properties">
          <h3>Ferramentas</h3>
          <div className="studio-tabs">{(['clips','captions','assets','audio','protected'] as const).map(t=><button key={t} className={tab===t?'on':''} onClick={()=>setTab(t)}>{ {clips:'Cortes',captions:'Legendas',assets:'Imagens',audio:'Áudio',protected:'Proteção'}[t]}</button>)}</div>
          {tab==='clips'&&selectedClip&&<div className="studio-fields"><h4>Corte selecionado</h4>
            <label>Início (seg) <input type="number" step=".1" value={selectedClip.start} onChange={e=>updateClip('start',e.target.value)}/></label>
            <label>Fim (seg) <input type="number" step=".1" value={selectedClip.end} onChange={e=>updateClip('end',e.target.value)}/></label>
            <label>Volume <input type="number" min="0" max="2" step=".1" value={selectedClip.volume??1} onChange={e=>updateClip('volume',e.target.value)}/></label>
            <button onClick={split}>✂ Dividir no cursor</button><button onClick={()=>move(selectedClip.id,-1)}>Mover para esquerda</button><button onClick={()=>move(selectedClip.id,1)}>Mover para direita</button><button onClick={remove}>Remover corte</button>
          </div>}
          {tab==='clips'&&!selectedClip&&<p>Selecione um clipe na timeline para cortar ou mover.</p>}
          {tab==='captions'&&<div className="studio-fields"><button onClick={addCaption}>+ Adicionar legenda</button>{selectedCaption&&<>
            <label>Texto <textarea value={selectedCaption.text} onChange={e=>updateCaption('text',e.target.value)}/></label>
            {(['start','end','x','y','fontSize'] as const).map(k=><label key={k}>{k} <input type="number" step=".01" value={selectedCaption[k]??54} onChange={e=>updateCaption(k,e.target.value)}/></label>)}
            <label>Cor <input type="color" value={selectedCaption.color||'#ffffff'} onChange={e=>updateCaption('color',e.target.value)}/></label>
            <label>Animação <select value={selectedCaption.animation||'fade'} onChange={e=>updateCaption('animation',e.target.value)}><option value="fade">Fade</option><option value="pop">Pop</option><option value="slide">Slide</option><option value="karaoke" disabled={!selectedCaption.words?.length}>Destaque palavra a palavra</option></select></label>
            <button onClick={remove}>Remover legenda</button></>}</div>}
          {tab==='assets'&&<div className="studio-fields"><p>Escolha uma imagem da biblioteca para inserir na timeline.</p>{selectedAsset&&<>{(['start','end','x','y','w','h'] as const).map(k=><label key={k}>{k}<input type="number" step=".01" value={selectedAsset[k]} onChange={e=>updateAsset(k,e.target.value)}/></label>)}
            <label>Animação <select value={selectedAsset.animation||'fade'} onChange={e=>updateAsset('animation',e.target.value)}>
              <option value="fade">Fade</option><option value="slide">Slide lateral</option><option value="none">Sem animação</option>
            </select></label><button onClick={remove}>Remover imagem</button></>}</div>}
          {tab==='audio'&&<div className="studio-fields">{selectedAudio&&<><h4>Faixa de áudio selecionada</h4>{(['start','end','offset','volume'] as const).map(k=><label key={k}>{k}<input type="number" step=".01" value={selectedAudio[k]} onChange={e=>updateAudio(k,e.target.value)}/></label>)}<button onClick={remove}>Remover faixa</button></>}{project.soundtrack?<><p>Trilha: {project.soundtrack.source.split('/').pop()}</p><label>Volume da trilha <input type="range" min="0" max="2" step=".01" value={project.soundtrack.volume} onChange={e=>mutate(p=>({...p,soundtrack:p.soundtrack?{...p.soundtrack,volume:Number(e.target.value)}:null}))}/></label><button onClick={()=>mutate(p=>({...p,soundtrack:null}))}>Remover trilha</button></>:<p>Escolha um áudio da biblioteca para adicionar uma trilha.</p>}</div>}
          {tab==='protected'&&<div className="studio-fields"><button onClick={addZone}>+ Proteger uma região</button><p>Regiões marcadas ficam bloqueadas para legendas e imagens sobrepostas.</p>{(project.protectedZones??[]).map(z=><button key={z.id} onClick={()=>setSelected(z.id)}>{z.label}</button>)}{selectedZone&&<><label>Nome <input value={selectedZone.label} onChange={e=>updateZone('label',e.target.value)}/></label>{(['start','end','x','y','w','h'] as const).map(k=><label key={k}>{k}<input type="number" step=".01" value={selectedZone[k]} onChange={e=>updateZone(k,e.target.value)}/></label>)}<button onClick={remove}>Remover proteção</button></>}</div>}
          <div className="studio-ai">
            <h4>✦ Assistente de IA</h4>
            <button disabled={aligning.state==='running'||(running.state!=='done'&&!(project.clips.length===1&&!project.soundtrack&&!(project.audioTracks?.length)))} onClick={gerarLegendas}>Gerar legendas pela narração</button>
            <button disabled={aiDraft.state==='running'||dirty||!project.captions.length} onClick={planAi}>✦ Criar design com IA</button>
            {aiDraft.state==='running'&&<p>Analisando narração e componentes disponíveis…</p>}
            {aiDraft.state==='failed'&&<p className="studio-error">IA: {aiDraft.error}</p>}
            {aiDraft.state==='draft'&&<div className="studio-ai-draft">
              <strong>Proposta pronta para revisão</strong>
              <p>{aiDraft.explanation}</p>
              <p>{aiDraft.elements?.length||0} elementos propostos</p>
              <ul>{aiDraft.elements?.slice(0,12).map((el,i)=><li key={i}>{el.kind==='caption'?el.text:el.asset} ({fmt(el.start)}–{fmt(el.end)})</li>)}</ul>
              <button onClick={applyAi}>Aplicar à timeline</button>
              <button onClick={()=>setAiDraft({state:'idle'})}>Descartar prévia</button>
            </div>}
            <p>Vídeo único: alinhar diretamente sem exportar. Montagens com várias cenas e faixas: exportar antes. Requer faster-whisper/WhisperX locais.</p>
            <p>O agente poderá analisar a narração e sugerir efeitos dinâmicos. O editor manual já funciona sem IA.</p>
            <button onClick={()=>{navigator.clipboard?.writeText(chatInstruction).then(()=>setNotice('Pedido copiado. Abra a conversa do projeto e cole o pedido.')).catch(()=>setNotice(chatInstruction))}}>Copiar pedido para o agente</button>
            <Link to={'/p/'+pid}>Abrir conversa do projeto</Link>
          </div>
        </aside>
      </div>
      <div className="studio-timeline">
        <div className="studio-timeline-head"><h3>Linha do tempo</h3><span>Selecione um elemento para editar · Duração {fmt(total)}</span></div>
        <div className="studio-tracks">
          <div className="studio-track"><span>Vídeo</span><div className="studio-track-items">{clips.map(c=><button key={c.id} draggable onDragStart={()=>{dragged.current=c.id}} onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();if(dragged.current)reorder(dragged.current,c.id);dragged.current=null}} onClick={()=>{setSelected(c.id);setTab('clips');seek(clips.slice(0,clips.indexOf(c)).reduce((n,v)=>n+v.duration,0))}} className={selected===c.id?'chosen':''} style={{flex:c.duration,minWidth:40}} title={c.source}>{c.source.split('/').pop()}<small>{c.duration.toFixed(1)}s</small></button>)}</div></div>
          <div className="studio-track"><span>Legendas</span><div className="studio-track-overlay">{project.captions.map(c=><button key={c.id} className={selected===c.id?'chosen':''} onClick={()=>{setSelected(c.id);setTab('captions');seek(c.start)}} style={{left:(100*c.start/Math.max(total,1))+'%',width:(100*(c.end-c.start)/Math.max(total,1))+'%'}}>{c.text}</button>)}</div></div>
          <div className="studio-track"><span>Imagens</span><div className="studio-track-overlay">{project.assets.map(a=><button key={a.id} className={selected===a.id?'chosen':''} onClick={()=>{setSelected(a.id);setTab('assets');seek(a.start)}} style={{left:(100*a.start/Math.max(total,1))+'%',width:(100*(a.end-a.start)/Math.max(total,1))+'%'}}>Imagem</button>)}</div></div>
          <div className="studio-track"><span>Voz/Áudio</span><div className="studio-track-overlay studio-audio-timeline">{(project.audioTracks??[]).map(a=><button key={a.id} className={selected===a.id?'chosen':''} onClick={()=>{setSelected(a.id);setTab('audio');seek(a.offset)}} style={{left:(100*a.offset/Math.max(total,1))+'%',width:(100*(a.end-a.start)/Math.max(total,1))+'%'}}>{a.source.split('/').pop()}</button>)}</div></div>
          <div className="studio-track"><span>Proteção</span><div className="studio-track-overlay studio-protection-timeline">{(project.protectedZones??[]).map(z=><button key={z.id} className={selected===z.id?'chosen':''} onClick={()=>{setSelected(z.id);setTab('protected');seek(z.start)}} style={{left:(100*z.start/Math.max(total,1))+'%',width:(100*(z.end-z.start)/Math.max(total,1))+'%'}}>{z.label}</button>)}</div></div>
          <div className="studio-track"><span>Trilha</span><div className="studio-track-audio">{project.soundtrack?.source.split('/').pop()||'Sem trilha'}</div></div>
        </div>
      </div>
    </>}
  </section>;
}
