import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Link, useParams, useLocation } from 'react-router-dom';
import { api, enviarVideo, urlAutenticada } from '../api';
import './VideoStudio.css';

type Media = { caminho:string; nome:string; bytes:number; pasta:string };
type Clip = { id:string; source:string; start:number; end:number; duration:number; volume?:number };
type Caption = { id:string; text:string; start:number; end:number; x:number; y:number; fontSize?:number; color?:string; animation?:'fade'|'pop'|'slide'|'karaoke'|'rise'|'enter-left'|'enter-right'; words?:Array<{text:string;start:number;end:number}> };
type ProtectedZone = {id:string;label:string;start:number;end:number;x:number;y:number;w:number;h:number};
type AudioTrack = {id:string;source:string;start:number;end:number;offset:number;volume:number};
type Asset = { id:string; source:string; start:number; end:number; x:number; y:number; w:number; h:number; animation?:'fade'|'slide'|'none' };
type Studio = { version:1; id:string; title:string; clips:Clip[]; captions:Caption[]; assets:Asset[]; audioTracks?:AudioTrack[]; protectedZones?:ProtectedZone[]; soundtrack?:{source:string; volume:number}|null;updatedAt:string };
type AiElement={kind:'caption'|'image'|'graphic';text?:string;asset?:string;subtitle?:string;variant?:string;start:number;end:number;x:number;y:number;w?:number;h?:number};
type AiResult={state:'idle'|'running'|'draft'|'failed';error?:string;elements?:AiElement[];explanation?:string};
type ZonesResult={state:'idle'|'running'|'draft'|'failed';error?:string;regions?:ProtectedZone[];warning?:string};
type Render = { state:'idle'|'running'|'done'|'failed'|'cancelled';error?:string;output?:string;
  inspection?:{durationMs:number;blackFrameCount:number;hasAudio:boolean;audioPeakDbfs?:number;warnings:string[]} };
const num = (v:string,fallback=0) => Number.isFinite(Number(v))?Number(v):fallback;
const fmt = (s:number) => !Number.isFinite(s) ? '00:00' : String(Math.floor(s/60)).padStart(2,'0')+':'+String(Math.floor(s%60)).padStart(2,'0');
const midiaUrl=(pid:string,p:string,standalone=false)=>urlAutenticada((standalone?'/studio/projects/':'/projects/')+pid+'/midia/content?path='+encodeURIComponent(p));
const ident=()=>crypto.randomUUID();

export function VideoStudio() {
  const {pid=''}=useParams();
  const standalone=useLocation().pathname.startsWith('/studio/');
  const base=standalone?'/studio/projects/'+pid:'/projects/'+pid;
  const edits=standalone?base+'/edits':base+'/studio';
  const [list,setList]=useState<Array<{id:string;title:string}>>([]);
  const [media,setMedia]=useState<Media[]>([]);
  const [project,setProject]=useState<Studio|null>(null);
  const [selected,setSelected]=useState<string|null>(null);
  const [tab,setTab]=useState<'clips'|'captions'|'assets'|'audio'|'protected'>('clips');
  const [playhead,setPlayhead]=useState(0);
  const [running,setRunning]=useState<Render>({state:'idle'});
  const [aiDraft,setAiDraft]=useState<AiResult>({state:'idle'});
  const [zoneDraft,setZoneDraft]=useState<ZonesResult>({state:'idle'});
  const [aligning,setAligning]=useState<{state:string;error?:string;captions?:number}>({state:'idle'});
  const [busy,setBusy]=useState(false);
  const [script,setScript]=useState('');
  const [voice,setVoice]=useState('pf_dora');
  const [speechBusy,setSpeechBusy]=useState(false);
  const [dirty,setDirty]=useState(false);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const [progress,setProgress]=useState(0);
  const inputRef=useRef<HTMLInputElement>(null);
  const captionsPollBusy=useRef(false);
  const aiPollBusy=useRef(false);
  const zonesPollBusy=useRef(false);
  const actionsInFlight=useRef(new Set<string>());
  const player=useRef<HTMLVideoElement>(null);
  const canvasRef=useRef<HTMLDivElement>(null);
  const dragState=useRef<{kind:'caption'|'image'|'zone';id:string;initialX:number;initialY:number;px:number;py:number}|null>(null);
  const soundtrackPlayer=useRef<HTMLAudioElement>(null);
  const audioPlayers=useRef(new Map<string,HTMLAudioElement>());
  const undoStack=useRef<Studio[]>([]);
  const redoStack=useRef<Studio[]>([]);
  const dragged=useRef<string|null>(null);
  const timelineDrag=useRef<{
    kind:'caption'|'asset'|'audio'|'zone'; id:string;
    edge:'move'|'start'|'end'; originX:number; width:number; baseline:Studio;
  }|null>(null);
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
      api<Array<{id:string;title:string}>>(edits),
      api<{videos:Media[]}>(base+'/videos')
    ]);
    setList(s);setMedia(m.videos);
    return s;
  };
  useEffect(()=>{
    setProject(null);setDirty(false);setPlayhead(0);setSelected(null);
    refresh().then(async editions=>{
      if(!standalone||!editions.length)return;
      const latest=[...editions].sort((a:any,b:any)=>String(b.updatedAt||'').localeCompare(String(a.updatedAt||'')))[0];
      setProject(await api<Studio>(edits+'/'+latest.id));
    }).catch(e=>setError(e.message));
  },[pid,standalone]);
  useEffect(()=>{
    if(!project || running.state!=='running')return;
    const timer=setInterval(()=>api<Render>(edits+'/'+project.id+'/render').then(setRunning).catch(()=>undefined),1700);
    return()=>clearInterval(timer);
  },[project?.id,pid,running.state]);
  const open=async(id:string)=>{
    if(dirty&&!window.confirm('Descartar alterações não salvas?')) return;
    const p=await api<Studio>(edits+'/'+id);
    setProject(p);setRunning({state:'idle'});setPlayhead(0);setSelected(null);setDirty(false);setError('');setNotice('');setAiDraft({state:'idle'});setZoneDraft({state:'idle'});undoStack.current=[];redoStack.current=[];
  };
  useEffect(()=>{
    if(!project || aligning.state!=='running')return;
    let activePoll=true;
    const timer=setInterval(async()=>{
      if(captionsPollBusy.current)return;
      captionsPollBusy.current=true;
      try {
        const st=await api<{state:string;error?:string;captions?:number}>(edits+'/'+project.id+'/captions/auto');
        if(!activePoll)return;
        setAligning(st);
        if(st.state==='done'){
          const fresh=await api<Studio>(edits+'/'+project.id);
          if(!activePoll)return;
          setProject(fresh);setDirty(false);setNotice(st.captions+' legendas adicionadas.');
        }
      }catch(e:any){if(activePoll)setError(e.message)}
      finally{captionsPollBusy.current=false}
    },2000);
    return()=>{activePoll=false;clearInterval(timer)};
  },[project?.id,pid,aligning.state]);
  const gerarLegendas=async()=>{
    if(!project)return;
    if(aligning.state==='running'||actionsInFlight.current.has('captions'))return;
    if(dirty)return setError('Para gerar legendas, clique em Salvar primeiro.');
    if(!project.clips.length)return setError('Adicione um vídeo à linha do tempo antes de gerar legendas.');
    const direct=project.clips.length===1&&!project.soundtrack&&!(project.audioTracks?.length);
    if(!direct&&(running.state!=='done'||!running.output)){
      return setError('Sua montagem contém várias cenas ou faixas de áudio. Salve, clique em Exportar MP4 e, quando terminar, gere as legendas.');
    }
    const texto=window.prompt('Cole o roteiro exato, se existir. Se não houver, deixe vazio para transcrever a fala do vídeo.','');
    if(texto===null)return;
    actionsInFlight.current.add('captions');
    try{
      const r=await api<{state:string}>(edits+'/'+project.id+'/captions/auto','POST',{script:texto});
      setAligning(r);setNotice('Alinhamento local iniciado.');
    }catch(e:any){setError(e.message)}
    finally{actionsInFlight.current.delete('captions')}
  };
  useEffect(()=>{
    if(!project||aiDraft.state!=='running')return;
    let activePoll=true;
    const timer=setInterval(async()=>{
      if(aiPollBusy.current)return;
      aiPollBusy.current=true;
      try{
        const result=await api<AiResult>(edits+'/'+project.id+'/ai/plan');
        if(activePoll)setAiDraft(result);
      }catch(e:any){if(activePoll)setAiDraft({state:'failed',error:e.message})}
      finally{aiPollBusy.current=false}
    },1800);
    return()=>{activePoll=false;clearInterval(timer)};
  },[pid,project?.id,aiDraft.state]);
  useEffect(()=>{
    if(!project || zoneDraft.state!=='running')return;
    let activePoll=true;
    const timer=setInterval(async()=>{
      if(zonesPollBusy.current)return;
      zonesPollBusy.current=true;
      try{
        const result=await api<ZonesResult>(edits+'/'+project.id+'/zones/detect');
        if(activePoll)setZoneDraft(result);
      }catch(e:any){if(activePoll)setZoneDraft({state:'failed',error:String(e.message||e)})}
      finally{zonesPollBusy.current=false}
    },1800);
    return()=>{activePoll=false;clearInterval(timer)};
  },[pid,project?.id,zoneDraft.state]);
  const detectZones=async()=>{
    if(!project||dirty)return setError('Salve primeiro o projeto antes de analisar rostos e textos.');
    if(zoneDraft.state==='running'||actionsInFlight.current.has('zones'))return;
    actionsInFlight.current.add('zones');
    try{
      setZoneDraft(await api<ZonesResult>(edits+'/'+project.id+'/zones/detect','POST',{}));
      setError('');
    }catch(e:any){setError(e.message)}
    finally{actionsInFlight.current.delete('zones')}
  };
  const applyZones=async()=>{
    if(!project||dirty)return setError('Salve o projeto antes de aplicar as regiões.');
    try{
      const p=await api<Studio>(edits+'/'+project.id+'/zones/apply','POST',{updatedAt:project.updatedAt});
      setProject(p);setZoneDraft({state:'idle'});setNotice('Regiões protegidas adicionadas. Revise suas posições na timeline.');
    }catch(e:any){setError(e.message)}
  };
  const planAi=async()=>{
    if(!project)return;
    if(aiDraft.state==='running'||actionsInFlight.current.has('ai-plan'))return;
    if(dirty)return setError('Para criar o design com IA, clique em Salvar primeiro.');
    if(!project.clips.length)return setError('Adicione pelo menos um vídeo à timeline.');
    if(!project.captions.length)return setError('Para criar o design com IA, primeiro gere as legendas pela narração. Se precisar, exporte a montagem antes.');
    const brief=window.prompt('Qual estilo de pós-produção você deseja?','Legendas dinâmicas, palavras destacadas e imagens de apoio contextuais, sem exageros.');
    if(brief===null)return;
    actionsInFlight.current.add('ai-plan');
    try{setAiDraft(await api<AiResult>(edits+'/'+project.id+'/ai/plan','POST',{brief}));setError('');}
    catch(e:any){setError(e.message)}
    finally{actionsInFlight.current.delete('ai-plan')}
  };
  const applyAi=async()=>{
    if(!project||dirty)return setError('Salve o projeto antes de aceitar a proposta.');
    if(actionsInFlight.current.has('ai-apply'))return;
    actionsInFlight.current.add('ai-apply');
    try{
      const p=await api<Studio>(edits+'/'+project.id+'/ai/apply','POST',{updatedAt:project.updatedAt});
      setProject(p);setAiDraft({state:'idle'});setNotice('Composição sugerida aplicada à timeline. Você pode ajustar cada elemento.');setSelected(null);
    }catch(e:any){setError(e.message)}
    finally{actionsInFlight.current.delete('ai-apply')}
  };
  const removeAiDraft=async(index:number)=>{
    if(!project)return;
    try{
      setAiDraft(await api<AiResult>(edits+'/'+project.id+'/ai/revise','POST',{removeIndex:index}));
    }catch(e:any){setError(e.message)}
  };
  const newProject=async()=>{
    const name=window.prompt('Nome da edição','Novo vídeo');
    if(name===null)return;
    const p=await api<Studio>(edits,'POST',{title:name||'Novo vídeo'});
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
      const p=await api<Studio>(edits+'/'+project.id,'PATCH',project);
      setProject(p);setDirty(false);setNotice('Projeto salvo');
      await refresh();
    }catch(e:any){setError(e.message)}finally{setBusy(false)}
  };
  // A mídia é armazenada com UUID, mas a lista da biblioteca mantém o nome original.
  const mediaNameByPath=new Map(media.map(m=>[m.caminho,m.nome]));
  const mediaName=(source:string)=>mediaNameByPath.get(source)||source.split('/').pop()||'Arquivo';
  const mediaVideo=media.filter(m=>/\.(mp4|mov|webm|mkv|m4v)$/i.test(m.caminho));
  const mediaAudio=media.filter(m=>/\.(mp3|wav|m4a|aac|ogg|flac)$/i.test(m.caminho));
  const mediaImage=media.filter(m=>/\.(png|jpg|jpeg|webp)$/i.test(m.caminho));
  const removeMedia=async(m:Media)=>{
    if(m.pasta!=='entrada')return setError('Somente arquivos enviados podem ser excluídos desta biblioteca.');
    if(dirty)return setError('Salve ou descarte as alterações da edição antes de excluir mídias.');
    const fileId=m.caminho.split('/').pop();
    if(!fileId)return;
    const used=Boolean(project?.clips.some(c=>c.source===m.caminho)||
      project?.assets.some(a=>a.source===m.caminho)||
      project?.audioTracks?.some(a=>a.source===m.caminho)||
      project?.soundtrack?.source===m.caminho);
    if(used)return setError('Este arquivo está na edição atual. Remova a faixa de voz ou trilha (ou clipe) e salve antes de excluir.');
    if(!window.confirm('Excluir definitivamente "'+m.nome+'" do armazenamento do projeto? Essa ação não pode ser desfeita.'))return;
    setBusy(true);setError('');
    try {
      const response=await api<{videos:Media[]}>(base+'/videos/'+encodeURIComponent(fileId),'DELETE');
      setMedia(response.videos);
      setNotice('Arquivo de mídia excluído da biblioteca.');
    } catch(e:any){setError(e.message)}
    finally{setBusy(false)}
  };
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
    obj.src=midiaUrl(pid,m.caminho,standalone);
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
      // Voz e narração começam no início da montagem, independentemente do cursor.
      // Não repetir nem esticar falas; se o áudio for menor, sua faixa termina antes.
      const end=Math.min(Number(obj.duration),total);
      if(!Number.isFinite(end)||end<=0)return setError('Áudio sem duração válida');
      const a:AudioTrack={id:ident(),source:m.caminho,start:0,end,offset:0,volume:1};
      mutate(p=>({...p,audioTracks:[...(p.audioTracks??[]),a]}));setSelected(a.id);setTab('audio');
    };
    obj.onerror=()=>setError('Falha ao ler a duração do áudio.');
    obj.src=midiaUrl(pid,m.caminho,standalone);
  };
  const generateSpeech=async()=>{
    if(!standalone)return;
    if(!script.trim())return setError('Digite o roteiro da narração primeiro.');
    setSpeechBusy(true);setError('');
    try{
      const item=await api<Media>(base+'/narration','POST',{script,voice});
      await refresh();
      setNotice('Narração gerada e salva no projeto. Ela foi adicionada à timeline se houver vídeo.');
      if(total>0)addAudio(item);
    }catch(e:any){setError(e.message)}
    finally{setSpeechBusy(false)}
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
  const beginDrag=(e:ReactPointerEvent<HTMLElement>,kind:'caption'|'image'|'zone',item:{id:string;x:number;y:number})=>{
    if(!project)return;
    e.stopPropagation();e.currentTarget.setPointerCapture(e.pointerId);
    dragState.current={kind,id:item.id,initialX:item.x,initialY:item.y,px:e.clientX,py:e.clientY};
    undoStack.current.push(project);
    if(undoStack.current.length>60)undoStack.current.shift();
    redoStack.current=[];
    setSelected(item.id);
    setTab(kind==='caption'?'captions':kind==='image'?'assets':'protected');
  };
  const moveDrag=(e:ReactPointerEvent<HTMLElement>)=>{
    const d=dragState.current,rect=canvasRef.current?.getBoundingClientRect();
    if(!d||!rect||rect.width<1||rect.height<1)return;
    const dx=(e.clientX-d.px)/rect.width,dy=(e.clientY-d.py)/rect.height;
    setProject(p=>{
      if(!p)return p;
      const position=<T extends {id:string;x:number;y:number;w?:number;h?:number}>(a:T):T=>
        a.id===d.id?{...a,x:Math.min(1-(a.w??0),Math.max(0,d.initialX+dx)),
        y:Math.min(1-(a.h??0),Math.max(0,d.initialY+dy))}:a;
      if(d.kind==='caption')return {...p,captions:p.captions.map(position)};
      if(d.kind==='image')return {...p,assets:p.assets.map(position)};
      return {...p,protectedZones:(p.protectedZones??[]).map(position)};
    });
    setDirty(true);
  };
  const endDrag=(e:ReactPointerEvent<HTMLElement>)=>{
    if(!dragState.current)return;
    try{e.currentTarget.releasePointerCapture(e.pointerId)}catch{/* pointer já liberado */}
    dragState.current=null;
  };
  // Ajustes não destrutivos da timeline. O snapshot inicial evita deriva no
  // arraste e gera um único ponto de desfazer por operação.
  const beginTimelineDrag=(e:ReactPointerEvent<HTMLElement>,kind:'caption'|'asset'|'audio'|'zone',id:string)=>{
    if(!project||total<=0||timelineDrag.current)return;
    if(e.button!==0)return;
    const parent=e.currentTarget.parentElement;
    const width=parent?.getBoundingClientRect().width??0;
    if(width<=0)return;
    const edgeNode=(e.target as HTMLElement).closest('[data-timeline-edge]');
    const edgeAttr=edgeNode?.getAttribute('data-timeline-edge');
    const edge: 'move'|'start'|'end'=edgeAttr==='start'||edgeAttr==='end'?edgeAttr:'move';
    e.preventDefault();e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    timelineDrag.current={kind,id,edge,originX:e.clientX,width,baseline:project};
    undoStack.current.push(project);
    if(undoStack.current.length>60)undoStack.current.shift();
    redoStack.current=[];
    setSelected(id);
    setTab(kind==='caption'?'captions':kind==='asset'?'assets':kind==='audio'?'audio':'protected');
    setError('');
  };
  const moveTimelineDrag=(e:ReactPointerEvent<HTMLElement>)=>{
    const d=timelineDrag.current;
    if(!d||total<=0)return;
    const shift=Math.round(((e.clientX-d.originX)/d.width)*total*100)/100;
    const min=.05;
    const clamp=(v:number,a:number,b:number)=>Math.min(Math.max(v,a),b);
    const updateRange=<T extends {id:string;start:number;end:number}>(item:T):T=>{
      if(item.id!==d.id)return item;
      const length=item.end-item.start;
      let start=item.start,end=item.end;
      if(d.edge==='move'){
        start=clamp(item.start+shift,0,Math.max(0,total-length));
        end=start+length;
      }else if(d.edge==='start')start=clamp(item.start+shift,0,item.end-min);
      else end=clamp(item.end+shift,item.start+min,total);
      return {...item,start:+start.toFixed(2),end:+end.toFixed(2)};
    };
    const baseline=d.baseline;
    if(d.kind==='caption'){
      setProject({...baseline,captions:baseline.captions.map(c=>{
        const next=updateRange(c);
        if(c.id!==d.id)return c;
        if(!c.words?.length)return next;
        const delta=next.start-c.start;
        const words=d.edge==='move'?c.words.map(w=>({...w,start:+(w.start+delta).toFixed(3),end:+(w.end+delta).toFixed(3)})):
          c.words.filter(w=>w.end>next.start && w.start<next.end)
            .map(w=>({...w,start:Math.max(w.start,next.start),end:Math.min(w.end,next.end)}))
            .filter(w=>w.end-w.start>.01);
        return words.length?{...next,words}:({...next,words:undefined,animation:c.animation==='karaoke'?'fade':c.animation});
      })});
    }else if(d.kind==='asset'){
      setProject({...baseline,assets:baseline.assets.map(updateRange)});
    }else if(d.kind==='zone'){
      setProject({...baseline,protectedZones:(baseline.protectedZones??[]).map(updateRange)});
    }else{
      setProject({...baseline,audioTracks:(baseline.audioTracks??[]).map(a=>{
        if(a.id!==d.id)return a;
        const length=a.end-a.start;
        const maxOffset=Math.max(0,total-length);
        if(d.edge==='move')return {...a,offset:+clamp(a.offset+shift,0,maxOffset).toFixed(2)};
        if(d.edge==='start'){
          const change=clamp(shift,-Math.min(a.offset,a.start),length-min);
          return {...a,offset:+(a.offset+change).toFixed(2),
            start:+(a.start+change).toFixed(2)};
        }
        // O áudio jamais é prolongado artificialmente. Para ampliar um corte,
        // a duração original é obtida dos metadados carregados no player.
        const audioDuration=audioPlayers.current.get(a.id)?.duration;
        const maxSource=audioDuration&&Number.isFinite(audioDuration)&&audioDuration>0?
          audioDuration:a.end;
        const maxEnd=Math.min(maxSource,a.start+total-a.offset);
        return {...a,end:+clamp(a.end+shift,a.start+min,Math.max(a.start+min,maxEnd)).toFixed(2)};
      })});
    }
    setDirty(true);
  };
  const endTimelineDrag=(e:ReactPointerEvent<HTMLElement>)=>{
    if(!timelineDrag.current)return;
    try{e.currentTarget.releasePointerCapture(e.pointerId)}catch{/* ponteiro liberado */}
    timelineDrag.current=null;
  };
  const timelineBlock=(kind:'caption'|'asset'|'audio'|'zone',id:string,text:string,start:number,end:number)=>{
    const duration=Math.max(.05,total);
    return <div key={id} className={'studio-timeline-block'+(selected===id?' chosen':'')}
      role="button" tabIndex={0}
      aria-label={text+'. Arraste para mover; bordas para ajustar duração.'}
      title={text+' · '+fmt(start)+'–'+fmt(end)+' · arraste para mover ou ajustar as bordas'}
      style={{left:(100*start/duration)+'%',width:(100*(end-start)/duration)+'%'}}
      onPointerDown={e=>beginTimelineDrag(e,kind,id)}
      onPointerMove={moveTimelineDrag}
      onPointerUp={endTimelineDrag}
      onPointerCancel={endTimelineDrag}
      onKeyDown={e=>{
        if(e.key!=='ArrowLeft'&&e.key!=='ArrowRight')return;
        e.preventDefault();
        const rect=e.currentTarget.parentElement?.getBoundingClientRect();
        if(!rect || !project)return;
        const amount=e.shiftKey?1:.1;
        const fakeX=rect.width*amount/Math.max(total,.05)*(e.key==='ArrowRight'?1:-1);
        const startX=0;
        timelineDrag.current={kind,id,edge:'move',originX:startX,width:rect.width,baseline:project};
        undoStack.current.push(project);
        redoStack.current=[];
        moveTimelineDrag({clientX:fakeX} as ReactPointerEvent<HTMLElement>);
        timelineDrag.current=null;
      }}>
      <span className="studio-timeline-grip" data-timeline-edge="start" title="Ajustar início"/>
      <span className="studio-timeline-label">{text}</span>
      <span className="studio-timeline-grip" data-timeline-edge="end" title="Ajustar fim"/>
    </div>;
  };
  const remove=()=>{
    mutate(p=>({...p,clips:p.clips.filter(c=>c.id!==selected),captions:p.captions.filter(c=>c.id!==selected),assets:p.assets.filter(c=>c.id!==selected),audioTracks:(p.audioTracks??[]).filter(c=>c.id!==selected),protectedZones:(p.protectedZones??[]).filter(c=>c.id!==selected)}));
    setSelected(null);
  };
  const exportar=async()=>{
    if(!project)return;
    if(dirty)return setError('Salve a edição antes de exportar.');
    if(running.state==='running'||actionsInFlight.current.has('render'))return;
    actionsInFlight.current.add('render');
    setError('');
    try {setRunning(await api<Render>(edits+'/'+project.id+'/render','POST',{}))}
    catch(e:any){setError(e.message)}
    finally{actionsInFlight.current.delete('render')}
  };
  const upload=async(files:FileList|null)=>{
    if(!files)return;
    setBusy(true);setError('');
    try {
      for(const f of Array.from(files)) await enviarVideo(pid,f,setProgress,standalone);
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
      <div><Link to={standalone?'/studio':'/p/'+pid}>← {standalone?'Produções':'Projeto'}</Link><h2>Nivoo Studio</h2><span>Edição não destrutiva • assistência de IA opcional</span></div>
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
    {running.state==='done'&&running.output&&<a href={midiaUrl(pid,running.output,standalone)} target="_blank" rel="noreferrer">Abrir vídeo exportado</a>}
    {running.state==='done'&&running.inspection&&<div className="studio-notice" role="status">MP4 inspecionado: {(running.inspection.durationMs/1000).toFixed(1)}s · {running.inspection.hasAudio?'com áudio':'sem áudio'} · {running.inspection.blackFrameCount} trecho(s) preto(s) detectado(s).{running.inspection.warnings.length>0&&<span> Atenção: {running.inspection.warnings.join('; ')}.</span>} Revisão visual ainda necessária.</div>}
    {!project?<div className="studio-start"><h3>Suas edições</h3>{list.map(x=><button key={x.id} onClick={()=>open(x.id)}>{x.title}</button>)}<button onClick={newProject}>Criar primeira edição</button></div>:
    <>
      <div className="studio-workspace">
        <aside className="studio-library">
          <h3>Biblioteca</h3>
          <label className="studio-upload">+ Importar mídias<input ref={inputRef} type="file" multiple hidden accept="video/*,audio/*,image/png,image/jpeg,image/webp" onChange={e=>upload(e.target.files)} /></label>
          {busy&&progress>0&&<small>Enviando {progress}%</small>}
          <h4>Vídeos</h4>{mediaVideo.map(m=><div className="studio-media-row" key={m.caminho}>
            <button className="studio-media-add" title={'Adicionar '+m.nome} onClick={()=>append(m)}>＋ <span>{m.nome}</span></button>
            {m.pasta==='entrada'&&<button className="studio-media-delete" disabled={busy} title={'Excluir '+m.nome+' do projeto'} aria-label={'Excluir vídeo '+m.nome} onClick={()=>removeMedia(m)}>✕</button>}
          </div>)}
          <h4>Imagens</h4>{mediaImage.map(m=><button title={m.nome} key={m.caminho} onClick={()=>addImage(m)}>＋ {m.nome}</button>)}
          {standalone&&<div className="studio-narration">
            <h4>🎙 Criar narração com Kokoro</h4>
            <textarea aria-label="Roteiro da narração" placeholder="Cole ou escreva o texto que será narrado…" value={script} onChange={e=>setScript(e.target.value)} rows={4} maxLength={5000}/>
            <select aria-label="Voz da narração" value={voice} onChange={e=>setVoice(e.target.value)}>
              <option value="pf_dora">Dora · Feminina</option>
              <option value="pm_alex">Alex · Masculina</option>
              <option value="pm_santa">Santa · Masculina</option>
            </select>
            <button disabled={speechBusy||busy||!script.trim()} onClick={generateSpeech}>{speechBusy?'Gerando áudio…':'Gerar narração'}</button>
            <small>Áudio salvo na biblioteca e inserido na timeline quando houver vídeo.</small>
          </div>}
          <h4>Áudios</h4><small className="studio-audio-help">Escolha Voz ou Trilha para cada áudio.</small>{mediaAudio.map(m=><div key={m.caminho} className="studio-audio-source">
            <div className="studio-audio-heading">
              <span className="studio-audio-name" title={m.nome}>{m.nome}</span>
              {m.pasta==='entrada'&&<button className="studio-audio-delete" disabled={busy} title={'Excluir '+m.nome+' da biblioteca'} aria-label={'Excluir áudio '+m.nome} onClick={()=>removeMedia(m)}>✕</button>}
            </div>
            <div className="studio-audio-actions">
              <button disabled={project.soundtrack?.source===m.caminho} onClick={()=>addAudio(m)} title={project.soundtrack?.source===m.caminho?'Este áudio já é uma trilha':'Adicionar na faixa de voz'}>＋ Voz</button>
              <button onClick={()=>{mutate(p=>({...p,audioTracks:(p.audioTracks??[]).filter(a=>a.source!==m.caminho),soundtrack:{source:m.caminho,volume:.24}}));setSelected(null);setTab('audio');}} title="Usar como trilha musical">♫ Trilha</button>
            </div>
          </div>)}
          <h4>Edições</h4>{list.map(x=><button key={x.id} onClick={()=>open(x.id)}>{x.title}</button>)}
        </aside>
        <main className="studio-preview-panel">
          <div className="studio-canvas" ref={canvasRef}>
            {project.soundtrack&&<audio ref={soundtrackPlayer} src={midiaUrl(pid,project.soundtrack.source,standalone)} loop preload="metadata"/>}
            {(project.audioTracks??[]).map(t=><audio key={t.id} ref={el=>{if(el)audioPlayers.current.set(t.id,el);else audioPlayers.current.delete(t.id);}} src={midiaUrl(pid,t.source,standalone)} preload="metadata"/>)}
            {active?<video key={active.clip.source} ref={player} src={midiaUrl(pid,active.clip.source,standalone)} playsInline onTimeUpdate={onVideoTime} onEnded={onVideoEnded} onPause={()=>{playing.current=false;syncAudio(playhead,false)}} />:<span>Adicione um vídeo para começar</span>}
            {(project.protectedZones??[]).filter(z=>z.start<=playhead&&z.end>playhead).map(z=><div key={z.id} onPointerDown={e=>beginDrag(e,'zone',z)} onPointerMove={moveDrag} onPointerUp={endDrag} className="studio-protected" style={{left:(z.x*100)+'%',top:(z.y*100)+'%',width:(z.w*100)+'%',height:(z.h*100)+'%'}} title={z.label}><span>{z.label}</span></div>)}
            {activeAssets.map(a=><img key={a.id} draggable={false} onPointerDown={e=>beginDrag(e,'image',a)} onPointerMove={moveDrag} onPointerUp={endDrag} src={midiaUrl(pid,a.source,standalone)} className={'studio-asset studio-asset-'+(a.animation||'fade')} alt="" style={{left:(a.x*100)+'%',top:(a.y*100)+'%',width:(a.w*100)+'%',height:(a.h*100)+'%'}}/>)}
            {aiDraft.state==='draft'&&(aiDraft.elements??[]).filter(el=>el.start<=playhead&&el.end>playhead).map((el,i)=>
              <div className="studio-ai-overlay" key={'draft-'+i}
                style={{left:(el.x*100)+'%',top:(el.y*100)+'%',
                width:el.kind==='caption'?'auto':((el.w??.3)*100)+'%',
                height:el.kind==='caption'?'auto':((el.h??.2)*100)+'%'}}>
                {el.kind==='caption'?el.text:el.kind==='graphic'?(el.text||'Gráfico de apoio'):'Imagem de apoio'}
              </div>)}
            {activeCaptions.map(c=><div key={c.id} onPointerDown={e=>beginDrag(e,'caption',c)} onPointerMove={moveDrag} onPointerUp={endDrag} className={'studio-caption studio-caption-'+(c.animation||'fade')} style={{left:(c.x*100)+'%',top:(c.y*100)+'%',fontSize:'clamp(12px,'+(c.fontSize??54)/25+'vw,64px)',color:c.color||'#fff'}}>{c.animation==='karaoke'&&c.words?.length?c.words.map((w,i)=><span key={i} className={playhead>=w.start&&playhead<w.end?'studio-word-active':'studio-word'}>{w.text}{i<c.words!.length-1?' ':''}</span>):c.text}</div>)}
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
            <label>Animação <select value={selectedCaption.animation||'fade'} onChange={e=>updateCaption('animation',e.target.value)}><option value="fade">Fade</option><option value="pop">Pop</option><option value="slide">Slide vertical</option><option value="rise">Subir</option><option value="enter-left">Entrar da esquerda</option><option value="enter-right">Entrar da direita</option><option value="karaoke" disabled={!selectedCaption.words?.length}>Destaque palavra a palavra</option></select></label>
            <button onClick={remove}>Remover legenda</button></>}</div>}
          {tab==='assets'&&<div className="studio-fields"><p>Escolha uma imagem da biblioteca para inserir na timeline.</p>{selectedAsset&&<>{(['start','end','x','y','w','h'] as const).map(k=><label key={k}>{k}<input type="number" step=".01" value={selectedAsset[k]} onChange={e=>updateAsset(k,e.target.value)}/></label>)}
            <label>Animação <select value={selectedAsset.animation||'fade'} onChange={e=>updateAsset('animation',e.target.value)}>
              <option value="fade">Fade</option><option value="slide">Slide lateral</option><option value="none">Sem animação</option>
            </select></label><button onClick={remove}>Remover imagem</button></>}</div>}
          {tab==='audio'&&<div className="studio-fields">{selectedAudio&&<><h4>Faixa de áudio selecionada</h4>{(['start','end','offset','volume'] as const).map(k=><label key={k}>{k}<input type="number" step=".01" value={selectedAudio[k]} onChange={e=>updateAudio(k,e.target.value)}/></label>)}<button disabled={selectedAudio.offset===0} onClick={()=>mutate(p=>({...p,audioTracks:(p.audioTracks??[]).map(a=>a.id===selected?{...a,offset:0,end:Math.min(a.end,total)}:a)}))}>Alinhar voz ao início (00:00)</button><button onClick={remove}>Remover somente esta voz</button></>}{project.soundtrack?<><p>Trilha: {mediaName(project.soundtrack.source)}</p><label>Volume da trilha <input type="range" min="0" max="2" step=".01" value={project.soundtrack.volume} onChange={e=>mutate(p=>({...p,soundtrack:p.soundtrack?{...p.soundtrack,volume:Number(e.target.value)}:null}))}/></label><button onClick={()=>mutate(p=>({...p,soundtrack:null}))}>Remover trilha</button></>:<p>Escolha um áudio da biblioteca para adicionar uma trilha.</p>}</div>}
          {tab==='protected'&&<div className="studio-fields"><button disabled={zoneDraft.state==='running'||dirty} onClick={detectZones}>Detectar rostos e textos localmente</button>{zoneDraft.state==='running'&&<p>Analisando quadros das cenas…</p>}{zoneDraft.state==='failed'&&<p className="studio-error">{zoneDraft.error}</p>}{zoneDraft.state==='draft'&&<><p>{zoneDraft.regions?.length??0} regiões sugeridas. {zoneDraft.warning}</p><button disabled={!(zoneDraft.regions?.length)} onClick={applyZones}>Aplicar regiões detectadas</button><button onClick={()=>setZoneDraft({state:'idle'})}>Descartar detecção</button></>}<button onClick={addZone}>+ Proteger uma região</button><p>Regiões marcadas ficam bloqueadas para legendas e imagens sobrepostas.</p>{(project.protectedZones??[]).map(z=><button key={z.id} onClick={()=>setSelected(z.id)}>{z.label}</button>)}{selectedZone&&<><label>Nome <input value={selectedZone.label} onChange={e=>updateZone('label',e.target.value)}/></label>{(['start','end','x','y','w','h'] as const).map(k=><label key={k}>{k}<input type="number" step=".01" value={selectedZone[k]} onChange={e=>updateZone(k,e.target.value)}/></label>)}<button onClick={remove}>Remover proteção</button></>}</div>}
          <div className="studio-ai">
            <h4>✦ Assistente de IA</h4>
            <button disabled={aligning.state==='running'} onClick={gerarLegendas}>Gerar legendas pela narração</button>
            <button disabled={aiDraft.state==='running'} onClick={planAi}>✦ Criar design com IA</button>
            <p className="studio-ai-guide">{dirty?'● Salve as alterações antes de utilizar a IA.':!project.clips.length?'Adicione um vídeo para começar.':project.clips.length!==1||Boolean(project.soundtrack)||Boolean(project.audioTracks?.length)?running.state!=='done'?'Sua montagem tem várias cenas ou faixas: exporte o MP4 antes de gerar legendas.':'Montagem exportada: agora você pode gerar as legendas.':'Você pode gerar as legendas diretamente do vídeo.'}</p>
            {!project.captions.length&&<p className="studio-ai-guide">Para criar o design com IA, primeiro gere ou adicione legendas.</p>}
            {aiDraft.state==='running'&&<p>Analisando narração e componentes disponíveis…</p>}
            {aiDraft.state==='failed'&&<p className="studio-error">IA: {aiDraft.error}</p>}
            {aiDraft.state==='draft'&&<div className="studio-ai-draft">
              <strong>Proposta pronta para revisão</strong>
              <p>{aiDraft.explanation}</p>
              <p>{aiDraft.elements?.length||0} elementos propostos</p>
              <ul>{aiDraft.elements?.map((el,i)=><li key={i}>{el.kind==='caption'?el.text:el.kind==='image'?el.asset:el.text||'Gráfico contextual'} ({fmt(el.start)}–{fmt(el.end)}) <button onClick={()=>removeAiDraft(i)} title="Retirar somente esta proposta">Retirar</button></li>)}</ul>
              <button disabled={!aiDraft.elements?.length} onClick={applyAi}>Aplicar à timeline</button>
              <button onClick={()=>setAiDraft({state:'idle'})}>Descartar prévia</button>
            </div>}
            <p>Vídeo único: alinhar diretamente sem exportar. Montagens com várias cenas e faixas: exportar antes. Requer faster-whisper/WhisperX locais.</p>
            <p>O agente poderá analisar a narração e sugerir efeitos dinâmicos. O editor manual já funciona sem IA.</p>
            <button onClick={()=>{navigator.clipboard?.writeText(chatInstruction).then(()=>setNotice('Pedido copiado. Abra a conversa do projeto e cole o pedido.')).catch(()=>setNotice(chatInstruction))}}>Copiar pedido para o agente</button>
            {!standalone&&<Link to={'/p/'+pid}>Abrir conversa do projeto</Link>}
          </div>
        </aside>
      </div>
      <div className="studio-timeline">
        <div className="studio-timeline-head"><h3>Linha do tempo</h3><span>Selecione um elemento para editar · Duração {fmt(total)}</span></div>
        <div className="studio-tracks">
          <div className="studio-track"><span>Vídeo</span><div className="studio-track-items">{clips.map(c=><button key={c.id} draggable onDragStart={()=>{dragged.current=c.id}} onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();if(dragged.current)reorder(dragged.current,c.id);dragged.current=null}} onClick={()=>{setSelected(c.id);setTab('clips');seek(clips.slice(0,clips.indexOf(c)).reduce((n,v)=>n+v.duration,0))}} className={selected===c.id?'chosen':''} style={{flex:c.duration,minWidth:40}} title={mediaName(c.source)}>{mediaName(c.source)}<small>{c.duration.toFixed(1)}s</small></button>)}</div></div>
          <div className="studio-track"><span>Legendas</span><div className="studio-track-overlay">{project.captions.map(c=>timelineBlock('caption',c.id,c.text,c.start,c.end))}</div></div>
          <div className="studio-track"><span>Imagens</span><div className="studio-track-overlay">{project.assets.map(a=>timelineBlock('asset',a.id,mediaName(a.source),a.start,a.end))}</div></div>
          <div className="studio-track"><span>Voz/Áudio</span><div className="studio-track-overlay studio-audio-timeline">{(project.audioTracks??[]).map(a=>timelineBlock('audio',a.id,mediaName(a.source),a.offset,a.offset+a.end-a.start))}</div></div>
          <div className="studio-track"><span>Proteção</span><div className="studio-track-overlay studio-protection-timeline">{(project.protectedZones??[]).map(z=>timelineBlock('zone',z.id,z.label,z.start,z.end))}</div></div>
          <div className="studio-track"><span>Trilha</span><div className="studio-track-audio">{project.soundtrack?mediaName(project.soundtrack.source):'Sem trilha'}</div></div>
        </div>
      </div>
    </>}
  </section>;
}
