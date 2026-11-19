import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Link, useParams, useLocation } from 'react-router-dom';
import { api, enviarVideo, urlAutenticada } from '../api';
import './VideoStudio.css';
import { StudioWaveform } from './StudioWaveform';
import { StudioFilmstrip } from './StudioFilmstrip';

type Media = { caminho:string; nome:string; bytes:number; pasta:string; roteiro?:boolean };
type TransitionType='fade'|'wipeleft'|'wiperight'|'slideleft'|'slideright'|'circleopen';
type ClipTransition={type:TransitionType;duration:number};
type Clip = { id:string; source:string; start:number; end:number; duration:number; volume?:number; freeze?:boolean; transition?:ClipTransition };
type Caption = { id:string; text:string; start:number; end:number; x:number; y:number; fontSize?:number; color?:string; animation?:'fade'|'pop'|'slide'|'karaoke'|'rise'|'enter-left'|'enter-right'; words?:Array<{text:string;start:number;end:number}> };
type ProtectedZone = {id:string;label:string;start:number;end:number;x:number;y:number;w:number;h:number};
type AudioTrack = {id:string;source:string;start:number;end:number;offset:number;volume:number;fadeIn?:number;fadeOut?:number};
type Asset = { id:string; source:string; start:number; end:number; x:number; y:number; w:number; h:number; animation?:'fade'|'slide'|'none' };
type Studio = { version:1; id:string; title:string; clips:Clip[]; captions:Caption[]; assets:Asset[]; audioTracks?:AudioTrack[]; protectedZones?:ProtectedZone[]; soundtrack?:{source:string; volume:number}|null;updatedAt:string };
type AiElement={kind:'caption'|'image'|'graphic';text?:string;asset?:string;subtitle?:string;variant?:string;start:number;end:number;x:number;y:number;w?:number;h?:number};
type AiResult={state:'idle'|'running'|'draft'|'failed';error?:string;elements?:AiElement[];explanation?:string};
type ZonesResult={state:'idle'|'running'|'draft'|'failed';error?:string;regions?:ProtectedZone[];warning?:string};
type Render = { state:'idle'|'running'|'done'|'failed'|'cancelled';error?:string;output?:string;stage?:string };
const num = (v:string,fallback=0) => Number.isFinite(Number(v))?Number(v):fallback;
const fmt = (s:number) => !Number.isFinite(s) ? '00:00' : String(Math.floor(s/60)).padStart(2,'0')+':'+String(Math.floor(s%60)).padStart(2,'0');
const midiaUrl=(pid:string,p:string,standalone=false)=>urlAutenticada((standalone?'/studio/projects/':'/projects/')+pid+'/midia/content?path='+encodeURIComponent(p));
const ident=()=>crypto.randomUUID();
/** Transições pertencem à entrada da cena; após cortes ou reordenação a
 * primeira cena nunca recebe transição e a duração nunca ultrapassa o clipe. */
function normalizeTransitions(p:Studio):Studio{
  return {...p,clips:p.clips.map((c,i)=>{
    if(!c.transition)return c;
    const limit=Math.min(2,c.duration-.05);
    if(i===0||limit<.1){
      const {transition:_,...without}=c;
      return without;
    }
    return {...c,transition:{...c.transition,duration:+Math.min(limit,Math.max(.1,c.transition.duration)).toFixed(2)}};
  })};
}
const transitionPresets:{type:TransitionType;label:string;symbol:string;description:string}[]=[
  {type:'fade',label:'Dissolver',symbol:'◐',description:'Mistura suave entre duas cenas'},
  {type:'wipeleft',label:'Revelar →',symbol:'▣',description:'Revela a próxima cena na horizontal'},
  {type:'wiperight',label:'Revelar ←',symbol:'▤',description:'Revelação no sentido contrário'},
  {type:'slideleft',label:'Deslizar ←',symbol:'⇠',description:'A próxima cena entra pela lateral'},
  {type:'slideright',label:'Deslizar →',symbol:'⇢',description:'Deslizamento no sentido contrário'},
  {type:'circleopen',label:'Círculo',symbol:'◉',description:'A nova imagem surge pelo centro'},
];
/** Extende o vídeo com o último quadro estático, sem modificar a voz. */
function fitVideoToNarration(p:Studio,ending:number):Studio{
  const length=p.clips.reduce((v,c)=>v+c.duration,0);
  if(ending<=length+.001)return p;
  if(!p.clips.length)throw new Error('Adicione uma cena de vídeo antes de estender o final.');
  if(ending>14400)throw new Error('O projeto ultrapassaria quatro horas.');
  const extra=+(ending-length).toFixed(3);
  const last=p.clips[p.clips.length-1];
  if(last.freeze)return {...p,clips:[...p.clips.slice(0,-1),{...last,duration:+(last.duration+extra).toFixed(3)}]};
  if(p.clips.length>=200)throw new Error('Limite de 200 clipes atingido.');
  const position=Math.max(last.start,+(last.end-.08).toFixed(3));
  const freeze:Clip={id:ident(),source:last.source,start:position,end:last.end,
    duration:extra,volume:0,freeze:true};
  return {...p,clips:[...p.clips,freeze]};
}
/** Ripple delete em tempo de montagem. Remove o intervalo e fecha o espaço
 * em TODAS as faixas, preservando a parte anterior/posterior da narração. */
function rippleDelete(p:Studio,from:number,to:number):Studio{
  const gap=to-from;
  if(gap<=.001)return p;
  const time=(t:number)=>t<=from?t:t>=to?t-gap:from;
  const range=<T extends {start:number;end:number}>(item:T):T|null=>{
    const start=time(item.start),end=time(item.end);
    return end-start>.01?{...item,start:+start.toFixed(3),end:+end.toFixed(3)}:null;
  };
  const captions=p.captions.flatMap(c=>{
    const result=range(c);if(!result)return [];
    const words=c.words?.flatMap(w=>{
      const a=range(w);return a&&a.end>a.start?[a]:[];
    });
    return [{...result,words:words?.length?words:undefined,
      animation:words?.length?c.animation:c.animation==='karaoke'?'fade':c.animation}];
  });
  const audioTracks=(p.audioTracks??[]).flatMap(a=>{
    const end=a.offset+(a.end-a.start);
    // Separar áudio que cruza o corte: a segunda parte recomeça no ponto certo do arquivo.
    const spans=[
      {start:a.offset,end:Math.min(end,from)},
      {start:Math.max(a.offset,to),end}
    ];
    return spans.flatMap((span,i)=>{
      if(span.end-span.start<=.01)return [];
      const sourceStart=a.start+(span.start-a.offset);
      const duration=span.end-span.start;
      return [{...a,id:i===0?a.id:ident(),offset:+time(span.start).toFixed(3),
        start:+sourceStart.toFixed(3),end:+(sourceStart+duration).toFixed(3),
        fadeIn:Math.min(a.fadeIn??0,duration/2),fadeOut:Math.min(a.fadeOut??0,duration/2)}];
    });
  });
  return {...p,captions,assets:p.assets.flatMap(a=>{const v=range(a);return v?[v]:[]}),
    protectedZones:(p.protectedZones??[]).flatMap(a=>{const v=range(a);return v?[v]:[]}),audioTracks};
}
/** Inserção de tempo ao ampliar um corte: mantém sincronismo nas outras faixas. */
function rippleInsert(p:Studio,at:number,amount:number):Studio{
  if(amount<=.001)return p;
  const shifted=(t:number)=>t>=at?+(t+amount).toFixed(3):t;
  const range=<T extends {start:number;end:number}>(x:T):T=>({...x,
    start:shifted(x.start),end:shifted(x.end)});
  const audioTracks=(p.audioTracks??[]).flatMap(a=>{
    const stop=a.offset+a.end-a.start;
    if(a.offset<at&&stop>at){
      const cut=at-a.offset;
      const rest=stop-at;
      return [
        {...a,end:+(a.start+cut).toFixed(3),
          fadeIn:Math.min(a.fadeIn??0,cut/2),fadeOut:Math.min(a.fadeOut??0,cut/2)},
        {...a,id:ident(),start:+(a.start+cut).toFixed(3),offset:+(at+amount).toFixed(3),
          fadeIn:Math.min(a.fadeIn??0,rest/2),fadeOut:Math.min(a.fadeOut??0,rest/2)}
      ];
    }
    return [{...a,offset:shifted(a.offset)}];
  });
  return {...p,captions:p.captions.map(c=>({...range(c),words:c.words?.map(range)})),
    assets:p.assets.map(range),protectedZones:(p.protectedZones??[]).map(range),audioTracks};
}


export function VideoStudio() {
  const {pid=''}=useParams();
  const standalone=useLocation().pathname.startsWith('/studio/');
  const base=standalone?'/studio/projects/'+pid:'/projects/'+pid;
  const edits=standalone?base+'/edits':base+'/studio';
  const [list,setList]=useState<Array<{id:string;title:string}>>([]);
  const [productionName,setProductionName]=useState('');
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
  const [speed,setSpeed]=useState(1);
  const [previewing,setPreviewing]=useState<string|null>(null);
  const previewAudioRef=useRef<HTMLAudioElement|null>(null);
  const [speechBusy,setSpeechBusy]=useState(false);
  const [dirty,setDirty]=useState(false);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const [progress,setProgress]=useState(0);
  const inputRef=useRef<HTMLInputElement>(null);
  const player=useRef<HTMLVideoElement>(null);
  const canvasRef=useRef<HTMLDivElement>(null);
  const dragState=useRef<{kind:'caption'|'image'|'zone';id:string;initialX:number;initialY:number;px:number;py:number}|null>(null);
  const soundtrackPlayer=useRef<HTMLAudioElement>(null);
  const audioPlayers=useRef(new Map<string,HTMLAudioElement>());
  const undoStack=useRef<Studio[]>([]);
  const redoStack=useRef<Studio[]>([]);
  const dragged=useRef<string|null>(null);
  const mediaDuration=useRef(new Map<string,number>());
  const videoTrim=useRef<{id:string;edge:'start'|'end';x:number;width:number;original:Studio}|null>(null);
  const suppressClipClick=useRef(false);
  const [editMode,setEditMode]=useState<'select'|'blade'>('select');
  const [zoom,setZoom]=useState(1);
  const [snap,setSnap]=useState(true);
  const [transitionOpen,setTransitionOpen]=useState(false);
  const [transitionClip,setTransitionClip]=useState<string|null>(null);
  const [transitionType,setTransitionType]=useState<TransitionType>('fade');
  const [transitionDuration,setTransitionDuration]=useState(.6);
  const [transitionPosition,setTransitionPosition]=useState<{x:number;y:number}>({x:120,y:115});
  const transitionPanelDrag=useRef<{x:number;y:number;originX:number;originY:number}|null>(null);
  const transitionPanelRef=useRef<HTMLDivElement>(null);
  const [libraryOpen,setLibraryOpen]=useState<Record<string,boolean>>({videos:true,images:false,narration:false,audios:true,edits:false});
  const toggleLibrary=(key:string)=>setLibraryOpen(prev=>({...prev,[key]:!prev[key]}));
  const timelineDrag=useRef<{
    kind:'caption'|'asset'|'audio'|'zone'; id:string;
    edge:'move'|'start'|'end'; originX:number; width:number; baseline:Studio;
  }|null>(null);
  const clips=project?.clips||[];
  const total=clips.reduce((n,c)=>n+c.duration,0);
  const tickStep=total<=60?5:total<=300?15:total<=900?30:total<=3600?120:300;
  const ticks=Array.from({length:Math.min(80,Math.floor(total/tickStep)+1)},(_,i)=>i*tickStep);
  const active=useMemo(()=>{
    let pos=0;
    for(const c of clips) { if(playhead<pos+c.duration) return {clip:c,offset:playhead-pos,begin:pos};pos+=c.duration; }
    return clips.length?{clip:clips[clips.length-1],offset:clips[clips.length-1].duration,begin:pos-clips[clips.length-1].duration}:null;
  },[clips,playhead]);
  const selectedClip=clips.find(c=>c.id===selected);
  const transitionTargetIndex=clips.findIndex(c=>c.id===transitionClip);
  const transitionTarget=transitionTargetIndex>0?clips[transitionTargetIndex]:null;
  const activeTransition=active && clips.findIndex(c=>c.id===active.clip.id)>0?
    active.clip.transition:undefined;
  const transitionProgress=activeTransition&&active?Math.min(1,active.offset/activeTransition.duration):1;
  const incomingIndex=active?clips.findIndex(c=>c.id===active.clip.id):-1;
  const outgoingClip=activeTransition&&incomingIndex>0?clips[incomingIndex-1]:null;
  const previousFrameStyle=activeTransition?(
    activeTransition.type==='fade'?{opacity:1-transitionProgress}:
    activeTransition.type==='wipeleft'?{clipPath:`inset(0 ${transitionProgress*100}% 0 0)`}:
    activeTransition.type==='wiperight'?{clipPath:`inset(0 0 0 ${transitionProgress*100}%)`}:
    activeTransition.type==='circleopen'?{clipPath:`circle(${(1-transitionProgress)*78}% at center)`}:
    activeTransition.type==='slideleft'?{transform:`translateX(-${transitionProgress*100}%)`}:
    {transform:`translateX(${transitionProgress*100}%)`}
  ):undefined;
  const selectedCaption=project?.captions.find(c=>c.id===selected);
  const selectedAsset=project?.assets.find(c=>c.id===selected);
  const selectedAudio=project?.audioTracks?.find(c=>c.id===selected);
  // Empacota áudios que se sobrepõem em faixas distintas, sem alterar
  // posição, ordem, volume ou conteúdo do projeto salvo.
  const audioLanes=useMemo(()=>{
    const lanes:AudioTrack[][]=[];
    const endings:number[]=[];
    const tracks=[...(project?.audioTracks??[])].sort((a,b)=>a.offset-b.offset);
    for(const track of tracks){
      const length=track.end-track.start;
      let lane=endings.findIndex(end=>end<=track.offset+.001);
      if(lane<0){lane=lanes.length;lanes.push([]);endings.push(0);}
      lanes[lane].push(track);
      endings[lane]=track.offset+length;
    }
    return lanes.length?lanes:[[]];
  },[project?.audioTracks]);
  const selectedZone=project?.protectedZones?.find(c=>c.id===selected);
  // A duração real é carregada também para clipes já salvos: permite alongar
  // novamente uma extremidade sem reimportar o arquivo original.
  useEffect(()=>{
    const source=selectedClip?.source;
    if(!source||mediaDuration.current.has(source))return;
    const el=document.createElement('video');
    el.preload='metadata';
    el.onloadedmetadata=()=>{
      if(Number.isFinite(el.duration)&&el.duration>0)
        mediaDuration.current.set(source,Math.min(el.duration,14400));
    };
    el.src=midiaUrl(pid,source,standalone);
    return()=>{el.onloadedmetadata=null;el.removeAttribute('src');el.load();};
  },[selectedClip?.source,pid,standalone]);

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
    if(standalone)api<{title:string}>('/studio/productions/'+pid).then(p=>setProductionName(p.title)).catch(e=>setError(e.message));
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
    setProject(p);setPlayhead(0);setSelected(null);setDirty(false);setError('');setNotice('');setAiDraft({state:'idle'});setZoneDraft({state:'idle'});undoStack.current=[];redoStack.current=[];
  };
  useEffect(()=>{
    if(!project || aligning.state!=='running')return;
    const timer=setInterval(async()=>{
      try {
        const st=await api<{state:string;error?:string;captions?:number}>(edits+'/'+project.id+'/captions/auto');
        setAligning(st);
        if(st.state==='done'){
          const fresh=await api<Studio>(edits+'/'+project.id);
          setProject(fresh);setDirty(false);setNotice(st.captions+' legendas adicionadas.');
        }
      }catch(e:any){setError(e.message)}
    },2000);
    return()=>clearInterval(timer);
  },[project?.id,pid,aligning.state]);
  const gerarLegendas=async()=>{
    if(!project)return;
    if(aligning.state==='running')return;
    if(dirty)return setError('Para gerar legendas, clique em Salvar primeiro.');
    if(!project.clips.length)return setError('Adicione um vídeo à linha do tempo antes de gerar legendas.');
    const direct=project.clips.length===1&&!project.soundtrack&&!(project.audioTracks?.length);
    if(!direct&&(running.state!=='done'||!running.output)){
      return setError('Sua montagem contém várias cenas ou faixas de áudio. Salve, clique em Exportar MP4 e, quando terminar, gere as legendas.');
    }
    const texto=window.prompt('Cole o roteiro exato, se existir. Se não houver, deixe vazio para transcrever a fala do vídeo.','');
    if(texto===null)return;
    try{
      const r=await api<{state:string}>(edits+'/'+project.id+'/captions/auto','POST',{script:texto});
      setAligning(r);setNotice('Alinhamento local iniciado.');
    }catch(e:any){setError(e.message)}
  };
  useEffect(()=>{
    if(!project||aiDraft.state!=='running')return;
    const timer=setInterval(async()=>{
      try{setAiDraft(await api<AiResult>(edits+'/'+project.id+'/ai/plan'));}
      catch(e:any){setAiDraft({state:'failed',error:e.message})}
    },1800);
    return()=>clearInterval(timer);
  },[pid,project?.id,aiDraft.state]);
  useEffect(()=>{
    if(!project || zoneDraft.state!=='running')return;
    const timer=setInterval(()=>{
      api<ZonesResult>(edits+'/'+project.id+'/zones/detect')
        .then(setZoneDraft).catch(e=>setZoneDraft({state:'failed',error:String(e.message||e)}));
    },1800);
    return()=>clearInterval(timer);
  },[pid,project?.id,zoneDraft.state]);
  const detectZones=async()=>{
    if(!project||dirty)return setError('Salve primeiro o projeto antes de analisar rostos e textos.');
    try{
      setZoneDraft(await api<ZonesResult>(edits+'/'+project.id+'/zones/detect','POST',{}));
      setError('');
    }catch(e:any){setError(e.message)}
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
    if(aiDraft.state==='running')return;
    if(dirty)return setError('Para criar o design com IA, clique em Salvar primeiro.');
    if(!project.clips.length)return setError('Adicione pelo menos um vídeo à timeline.');
    if(!project.captions.length)return setError('Para criar o design com IA, primeiro gere as legendas pela narração. Se precisar, exporte a montagem antes.');
    const brief=window.prompt('Qual estilo de pós-produção você deseja?','Legendas dinâmicas, palavras destacadas e imagens de apoio contextuais, sem exageros.');
    if(brief===null)return;
    try{setAiDraft(await api<AiResult>(edits+'/'+project.id+'/ai/plan','POST',{brief}));setError('');}
    catch(e:any){setError(e.message)}
  };
  const applyAi=async()=>{
    if(!project||dirty)return setError('Salve o projeto antes de aceitar a proposta.');
    try{
      const p=await api<Studio>(edits+'/'+project.id+'/ai/apply','POST',{updatedAt:project.updatedAt});
      setProject(p);setAiDraft({state:'idle'});setNotice('Composição sugerida aplicada à timeline. Você pode ajustar cada elemento.');setSelected(null);
    }catch(e:any){setError(e.message)}
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
    setProject(normalizeTransitions(fn(project)));setDirty(true);setNotice('');
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
      const target=e.target as HTMLElement;
      if(['INPUT','TEXTAREA','SELECT'].includes(target.tagName)||target.isContentEditable)return;
      const mod=e.ctrlKey||e.metaKey,key=e.key.toLowerCase();
      if(mod&&key==='z'){e.preventDefault();if(e.shiftKey)redo();else undo();return;}
      if(mod&&key==='y'){e.preventDefault();redo();return;}
      if(mod&&key==='s'){e.preventDefault();if(dirty&&!busy)save();return;}
      if(mod||e.altKey||!project)return;
      if(key==='b'){setEditMode('blade');return;}
      if(key==='v'){setEditMode('select');return;}
      if(e.key==='ArrowLeft'||e.key==='ArrowRight'){
        e.preventDefault();
        seek(playhead+(e.key==='ArrowRight'?1:-1)*(e.shiftKey?1:1/30));return;
      }
      if(e.key==='Delete'||e.key==='Backspace'){if(selected){e.preventDefault();remove();}return;}
      if(e.code==='Space'){e.preventDefault();togglePlayback();}
    };
    document.addEventListener('keydown',listener);
    return()=>document.removeEventListener('keydown',listener);
  });
  // Proteção contra fechamento/atualização com cortes não salvos.
  useEffect(()=>{
    const warn=(e:BeforeUnloadEvent)=>{
      if(!dirty)return;
      e.preventDefault();
      e.returnValue='';
    };
    window.addEventListener('beforeunload',warn);
    return()=>window.removeEventListener('beforeunload',warn);
  },[dirty]);
  const save=async()=>{
    if(!project)return;
    setBusy(true);setError('');
    try {
      const p=await api<Studio>(edits+'/'+project.id,'PATCH',project);
      setProject(p);setDirty(false);setRunning({state:'idle'});setNotice('Projeto salvo');
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
      mediaDuration.current.set(m.caminho,duration);
      const c:Clip={id:ident(),source:m.caminho,start:0,end:duration,duration};
      // Se houver um último quadro congelado, a nova cena entra antes dele.
      // O tempo da voz permanece fixo e a parte congelada diminui conforme couber.
      mutate(p=>{
        const final=p.clips[p.clips.length-1];
        if(!final?.freeze)return {...p,clips:[...p.clips,c]};
        const remaining=+(final.duration-c.duration).toFixed(3);
        return {...p,clips:[...p.clips.slice(0,-1),c,...(remaining>=.05?[{...final,duration:remaining}]:[])]};
      });
      setSelected(c.id);setTab('clips');
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
      const length=Number(obj.duration);
      if(!Number.isFinite(length)||length<=0)return setError('Áudio sem duração válida');
      const offset=Math.max(0,...(project?.audioTracks??[]).map(a=>a.offset+(a.end-a.start)));
      const a:AudioTrack={id:ident(),source:m.caminho,start:0,end:+length.toFixed(3),offset:+offset.toFixed(3),volume:1,fadeIn:.12,fadeOut:.12};
      try{
        mutate(p=>fitVideoToNarration({...p,audioTracks:[...(p.audioTracks??[]),a]},offset+length));
        setSelected(a.id);setTab('audio');
        if(offset+length>total+.001)setNotice('Último quadro congelado até o fim da narração, sem acelerar ou cortar a voz. Você pode inserir mais cenas antes dele.');
      }catch(e:any){setError(e.message||'Não foi possível ajustar o vídeo à narração.');}
    };
    obj.onerror=()=>setError('Falha ao ler a duração do áudio.');
    obj.src=midiaUrl(pid,m.caminho,standalone);
  };
  const previewAudio=(m:Media)=>{
    const existing=previewAudioRef.current;
    if(existing){existing.pause();existing.removeAttribute('src');existing.load();previewAudioRef.current=null;}
    if(previewing===m.caminho){setPreviewing(null);return;}
    const player=new Audio(midiaUrl(pid,m.caminho,standalone));
    previewAudioRef.current=player;
    setPreviewing(m.caminho);
    player.onended=()=>{if(previewAudioRef.current===player){previewAudioRef.current=null;setPreviewing(null)}};
    player.play().catch(()=>{setPreviewing(null);setError('Não foi possível ouvir este áudio.')});
  };
  useEffect(()=>()=>{previewAudioRef.current?.pause();previewAudioRef.current=null},[pid]);
  const loadScript=async(m:Media)=>{
    const id=m.caminho.split('/').pop();
    if(!id||!standalone)return;
    try{
      const result=await api<{script:string}>(base+'/narration/'+encodeURIComponent(id)+'/script');
      setScript(result.script);
      setNotice('Roteiro carregado. Gere outra voz para criar uma versão nova sem substituir a anterior.');
    }catch(e:any){setError(e.message)}
  };
  const generateSpeech=async()=>{
    if(!standalone)return;
    if(!script.trim())return setError('Digite o roteiro da narração primeiro.');
    setSpeechBusy(true);setError('');
    try{
      const item=await api<Media>(base+'/narration','POST',{script,voice,speed});
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
      if(key==='start'||key==='end') {
        if(next.start<0||next.end-next.start<.05)return c;
        next.duration=+(next.end-next.start).toFixed(3);
      }
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
  const splitNarration=()=>{
    if(!project||!selectedAudio)return;
    const a=selectedAudio;
    const cut=playhead-a.offset;
    const len=a.end-a.start;
    if(cut<.05||cut>len-.05)return setError('Posicione o cursor dentro da narração selecionada para dividir.');
    const point=+(a.start+cut).toFixed(3);
    const left={...a,end:point,fadeIn:Math.min(a.fadeIn??0,cut/2),fadeOut:Math.min(a.fadeOut??0,cut/2)};
    const right={...a,id:ident(),start:point,offset:+playhead.toFixed(3),
      fadeIn:Math.min(a.fadeIn??0,(len-cut)/2),fadeOut:Math.min(a.fadeOut??0,(len-cut)/2)};
    mutate(p=>({...p,audioTracks:(p.audioTracks??[]).flatMap(v=>v.id===a.id?[left,right]:[v])}));
    setSelected(right.id);setTab('audio');
  };
  const extendEnding=()=>{
    if(!project?.clips.length)return setError('Adicione vídeo à montagem primeiro.');
    const ending=Math.max(0,...(project.audioTracks??[]).map(a=>a.offset+a.end-a.start));
    if(ending<=total+.001)return setNotice('O vídeo já cobre toda a narração.');
    try{
      mutate(p=>fitVideoToNarration(p,ending));
      setNotice('Último quadro congelado até o final da voz, sem modificar a narração.');
    }catch(e:any){setError(e.message)}
  };
  const duplicateNarration=()=>{
    if(!project||!selectedAudio)return;
    const a=selectedAudio,position=a.offset+a.end-a.start;
    const available=total-position;
    if(available<.05)return setError('Não há espaço após esta narração para duplicar. Amplie o vídeo primeiro.');
    const length=Math.min(a.end-a.start,available);
    const copy={...a,id:ident(),end:+(a.start+length).toFixed(3),
      offset:+position.toFixed(3),fadeIn:Math.min(a.fadeIn??0,length/2),fadeOut:Math.min(a.fadeOut??0,length/2)};
    mutate(p=>({...p,audioTracks:[...(p.audioTracks??[]),copy]}));
    setSelected(copy.id);
  };
  const updateAudio=(key:keyof AudioTrack,value:string)=>{
    mutate(p=>({...p,audioTracks:(p.audioTracks??[]).map(a=>{
      if(a.id!==selected)return a;
      const val=key==='source'?value:num(value);
      if(key==='fadeIn'||key==='fadeOut')return {...a,[key]:Math.max(0,Math.min(Number(val),(a.end-a.start)/2))};
      if(key==='offset')return {...a,offset:Math.max(0,Math.min(total-(a.end-a.start),Number(val)))};
      if(key==='start'||key==='end'){
        const sourceLength=audioPlayers.current.get(a.id)?.duration;
        const maxEnd=typeof sourceLength==='number'&&Number.isFinite(sourceLength)&&sourceLength>0?sourceLength:Math.max(a.end,Number(val));
        const start=key==='start'?Math.max(0,Math.min(a.end-.05,Number(val))):a.start;
        const end=key==='end'?Math.max(a.start+.05,Math.min(maxEnd,Number(val))):a.end;
        const d=end-start;
        return {...a,start,end,fadeIn:Math.min(a.fadeIn??0,d/2),fadeOut:Math.min(a.fadeOut??0,d/2)};
      }
      return {...a,[key]:val};
    })}));
  };
  const updateAsset=(key:keyof Asset,value:string)=>{
    mutate(p=>({...p,assets:p.assets.map(a=>a.id===selected?{...a,[key]:key==='source'||key==='animation'?value:num(value)}:a)}));
  };
  const move=(id:string,dir:number)=>{
    mutate(p=>{const a=[...p.clips],i=a.findIndex(c=>c.id===id),j=i+dir;
      if(i<0||j<0||j>=a.length)return p;
      [a[i],a[j]]=[a[j],a[i]];return {...p,clips:a};});
  };
  const split=(clipId=selected,at=playhead)=>{
    if(!project)return;
    const index=project.clips.findIndex(c=>c.id===clipId);
    const timelineStart=project.clips.slice(0,index).reduce((n,c)=>n+c.duration,0);
    const c=project.clips[index];
    const offset=at-timelineStart;
    if(!c||index<0||offset<=.05||offset>=c.duration-.05)
      return setError('Posicione o cursor dentro do clipe para dividir.');
    const cut=c.start+offset;
    const left={...c,end:cut,duration:cut-c.start};
    const {transition:_,...rightBase}=c;
    const right={...rightBase,id:ident(),start:cut,duration:c.end-cut};
    mutate(p=>{const i=p.clips.findIndex(v=>v.id===c.id);return {...p,clips:[...p.clips.slice(0,i),left,right,...p.clips.slice(i+1)]};});
    setSelected(right.id);
  };
  // Alças dos clipes de vídeo: mudam o ponto de entrada/saída, sem tocar no arquivo original.
  // O tamanho do clipe e a timeline são recalculados simultaneamente.
  const startVideoTrim=(e:ReactPointerEvent<HTMLSpanElement>,id:string,edge:'start'|'end')=>{
    if(!project||total<=0||videoTrim.current)return;
    e.preventDefault();e.stopPropagation();
    const width=e.currentTarget.closest('.studio-track-items')?.getBoundingClientRect().width??0;
    if(width<1)return;
    e.currentTarget.setPointerCapture(e.pointerId);
    videoTrim.current={id,edge,x:e.clientX,width,original:project};
    undoStack.current.push(project);
    if(undoStack.current.length>60)undoStack.current.shift();
    redoStack.current=[];
    setSelected(id);setTab('clips');setError('');
  };
  const moveVideoTrim=(e:ReactPointerEvent<HTMLSpanElement>)=>{
    const d=videoTrim.current;if(!d)return;
    const baseline=d.original;
    const domain=baseline.clips.reduce((n,c)=>n+c.duration,0);
    const delta=Math.round((e.clientX-d.x)/d.width*domain*100)/100;
    const index=baseline.clips.findIndex(c=>c.id===d.id);
    if(index<0)return;
    const before=baseline.clips.slice(0,index).reduce((n,c)=>n+c.duration,0);
    const original=baseline.clips[index];
    const sourceLimit=mediaDuration.current.get(original.source)??original.end;
    const clamp=(v:number,min:number,max:number)=>Math.min(max,Math.max(min,v));
    const newStart=d.edge==='start'?clamp(original.start+delta,0,original.end-.05):original.start;
    const newEnd=d.edge==='end'?clamp(original.end+delta,original.start+.05,sourceLimit):original.end;
    const newDuration=+(newEnd-newStart).toFixed(3);
    const updated={...baseline,clips:baseline.clips.map(c=>c.id===d.id?
      {...c,start:+newStart.toFixed(3),end:+newEnd.toFixed(3),duration:newDuration}:c)};
    const difference=newDuration-original.duration;
    let synced:Studio=updated;
    if(difference<-.001){
      const cutStart=d.edge==='start'?before:before+newDuration;
      synced=rippleDelete(updated,cutStart,cutStart-difference);
    }else if(difference>.001){
      const insertAt=d.edge==='start'?before:before+original.duration;
      synced=rippleInsert(updated,insertAt,difference);
    }
    // A narração preparada jamais perde trechos durante aparos de vídeo.
    synced={...synced,audioTracks:baseline.audioTracks};
    setProject(normalizeTransitions(fitVideoToNarration(synced,Math.max(0,...(baseline.audioTracks??[]).map(a=>a.offset+a.end-a.start)))));
    setDirty(true);
  };
  const endVideoTrim=(e:ReactPointerEvent<HTMLSpanElement>)=>{
    if(!videoTrim.current)return;
    try{e.currentTarget.releasePointerCapture(e.pointerId)}catch{}
    videoTrim.current=null;
    suppressClipClick.current=true;
    window.setTimeout(()=>{suppressClipClick.current=false},0);
  };
  const keepSide=(side:'before'|'after')=>{
    if(!project||!selectedClip)return;
    const index=project.clips.findIndex(c=>c.id===selectedClip.id);
    const begin=project.clips.slice(0,index).reduce((n,c)=>n+c.duration,0);
    const offset=playhead-begin,c=selectedClip;
    if(offset<=.05||offset>=c.duration-.05)
      return setError('Coloque o cursor dentro do clipe para escolher qual lado manter.');
    const cut=+(c.start+offset).toFixed(3);
    const kept=side==='before'?{...c,end:cut,duration:cut-c.start}:
      {...c,start:cut,duration:c.end-cut};
    const baseline={...project,clips:project.clips.map(x=>x.id===c.id?kept:x)};
    const from=side==='before'?begin+offset:begin;
    const to=side==='before'?begin+c.duration:begin+offset;
    mutate(()=>fitVideoToNarration({...rippleDelete(baseline,from,to),audioTracks:project.audioTracks},
      Math.max(0,...(project.audioTracks??[]).map(a=>a.offset+a.end-a.start))));
    seek(Math.min(from,total-(to-from)));
  };
  const duplicateClip=()=>{
    if(!project||!selectedClip)return;
    const index=project.clips.findIndex(c=>c.id===selectedClip.id);
    const at=project.clips.slice(0,index+1).reduce((n,c)=>n+c.duration,0);
    const copy={...selectedClip,id:ident()};
    mutate(p=>({...rippleInsert({...p,clips:[...p.clips.slice(0,index+1),copy,...p.clips.slice(index+1)]},at,copy.duration),audioTracks:p.audioTracks}));
    setSelected(copy.id);
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
        if(d.edge==='move'){
          const raw=clamp(a.offset+shift,0,maxOffset);
          const candidates=[0,total-length,...(baseline.audioTracks??[]).filter(v=>v.id!==a.id).flatMap(v=>[v.offset,v.offset+v.end-v.start])];
          const nearest=snap?candidates.reduce<number|undefined>((best,t)=>
            Math.abs(t-raw)<=Math.max(.08,total/500)&&
              (best===undefined||Math.abs(t-raw)<Math.abs(best-raw))?t:best,undefined):undefined;
          return {...a,offset:+(nearest===undefined?raw:nearest).toFixed(2)};
        }
        if(d.edge==='start'){
          const change=clamp(shift,-Math.min(a.offset,a.start),length-min);
          const duration=length-change;
          return {...a,offset:+(a.offset+change).toFixed(2),
            start:+(a.start+change).toFixed(2),
            fadeIn:Math.min(a.fadeIn??0,duration/2),fadeOut:Math.min(a.fadeOut??0,duration/2)};
        }
        // O áudio jamais é prolongado artificialmente. Para ampliar um corte,
        // a duração original é obtida dos metadados carregados no player.
        const audioDuration=audioPlayers.current.get(a.id)?.duration;
        const maxSource=audioDuration&&Number.isFinite(audioDuration)&&audioDuration>0?
          audioDuration:a.end;
        const maxEnd=Math.min(maxSource,a.start+total-a.offset);
        const nextEnd=+clamp(a.end+shift,a.start+min,Math.max(a.start+min,maxEnd)).toFixed(2);
        const duration=nextEnd-a.start;
        return {...a,end:nextEnd,
          fadeIn:Math.min(a.fadeIn??0,duration/2),fadeOut:Math.min(a.fadeOut??0,duration/2)};
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
      <span className="studio-timeline-label">{kind==='audio'?<>
        <StudioWaveform src={midiaUrl(pid,project?.audioTracks?.find(a=>a.id===id)?.source||'',standalone)}
          start={project?.audioTracks?.find(a=>a.id===id)?.start||0}
          end={project?.audioTracks?.find(a=>a.id===id)?.end||0}/>
        <span className="studio-waveform-name">{text}</span>
      </>:text}</span>
      <span className="studio-timeline-grip" data-timeline-edge="end" title="Ajustar fim"/>
    </div>;
  };
  const openTransitions=(clipId?:string)=>{
    const idx=clipId?clips.findIndex(c=>c.id===clipId):Math.max(1,clips.findIndex(c=>c.id===selected));
    const target=clips[idx>0?idx:1];
    if(!target)return setError('Adicione pelo menos duas cenas para aplicar uma transição.');
    setTransitionClip(target.id);
    setTransitionType(target.transition?.type??'fade');
    setTransitionDuration(target.transition?.duration??Math.min(.6,Math.max(.1,target.duration-.05)));
    setTransitionOpen(true);setError('');
  };
  const saveTransition=()=>{
    if(!transitionTarget)return;
    const max=Math.min(2,transitionTarget.duration-.05);
    if(max<.1)return setError('Esta cena é curta demais para receber uma transição.');
    const duration=+Math.min(max,Math.max(.1,transitionDuration)).toFixed(2);
    mutate(p=>({...p,clips:p.clips.map(c=>c.id===transitionTarget.id?
      {...c,transition:{type:transitionType,duration}}:c)}));
    setTransitionOpen(false);
    setNotice('Transição aplicada. Salve a edição antes de exportar o MP4.');
  };
  const clearTransition=()=>{
    if(!transitionTarget)return;
    mutate(p=>({...p,clips:p.clips.map(c=>{
      if(c.id!==transitionTarget.id)return c;
      const {transition:_,...rest}=c;
      return rest;
    })}));
    setTransitionOpen(false);
  };
  const startTransitionPanelDrag=(e:ReactPointerEvent<HTMLDivElement>)=>{
    const target=e.target as HTMLElement;
    if(target.closest('button,select,input'))return;
    e.currentTarget.setPointerCapture(e.pointerId);
    transitionPanelDrag.current={x:e.clientX,y:e.clientY,
      originX:transitionPosition.x,originY:transitionPosition.y};
  };
  const moveTransitionPanelDrag=(e:ReactPointerEvent<HTMLDivElement>)=>{
    const d=transitionPanelDrag.current;
    if(!d)return;
    const width=transitionPanelRef.current?.offsetWidth??330;
    const height=transitionPanelRef.current?.offsetHeight??320;
    setTransitionPosition({
      x:Math.min(Math.max(8,d.originX+e.clientX-d.x),Math.max(8,window.innerWidth-width-8)),
      y:Math.min(Math.max(8,d.originY+e.clientY-d.y),Math.max(8,window.innerHeight-height-8)),
    });
  };
  const endTransitionPanelDrag=(e:ReactPointerEvent<HTMLDivElement>)=>{
    if(!transitionPanelDrag.current)return;
    transitionPanelDrag.current=null;
    try{e.currentTarget.releasePointerCapture(e.pointerId)}catch{}
  };
  const remove=()=>{
    mutate(p=>{
      const index=p.clips.findIndex(c=>c.id===selected);
      if(index>=0){
        const from=p.clips.slice(0,index).reduce((n,c)=>n+c.duration,0);
        const duration=p.clips[index].duration;
        const adjusted=rippleDelete({...p,clips:p.clips.filter(c=>c.id!==selected)},from,from+duration);
        return adjusted.clips.length?fitVideoToNarration({...adjusted,audioTracks:p.audioTracks},
          Math.max(0,...(p.audioTracks??[]).map(a=>a.offset+a.end-a.start))):
          {...adjusted,audioTracks:p.audioTracks};
      }
      return {...p,clips:p.clips.filter(c=>c.id!==selected),
        captions:p.captions.filter(c=>c.id!==selected),
        assets:p.assets.filter(c=>c.id!==selected),
        audioTracks:(p.audioTracks??[]).filter(c=>c.id!==selected),
        protectedZones:(p.protectedZones??[]).filter(c=>c.id!==selected)};
    });
    setSelected(null);
  };
  const exportar=async()=>{
    if(!project)return;
    if(dirty)return setError('Salve a edição antes de exportar.');
    setError('');
    try {setRunning(await api<Render>(edits+'/'+project.id+'/render','POST',{}))}
    catch(e:any){setError(e.message)}
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
      const duration=Number.isFinite(a.duration)&&a.duration>0?a.duration:0;
      // A trilha toca em loop na exportação: a prévia deve usar o MESMO módulo.
      const at=duration?t%duration:t;
      if(Math.abs(a.currentTime-at)>.25){try{a.currentTime=at}catch{/* metadata pendente */}}
      if(shouldPlay&&a.paused)a.play().catch(()=>undefined);
      if(!shouldPlay&&!a.paused)a.pause();
    }
    for(const track of project?.audioTracks??[]){
      const a=audioPlayers.current.get(track.id);
      if(!a)continue;
      const position=t-track.offset,duration=track.end-track.start;
      const fi=track.fadeIn??0,fo=track.fadeOut??0;
      const fade=Math.max(0,Math.min(1,fi>0?position/fi:1,fo>0?(duration-position)/fo:1));
      a.volume=Math.min(1,Math.max(0,track.volume*fade));
      const inside=position>=0&&position<duration;
      if(inside){
        const at=track.start+position;
        if(Math.abs(a.currentTime-at)>.35){try{a.currentTime=at}catch{/* metadata pendente */}}
        if(shouldPlay&&a.paused)a.play().catch(()=>undefined);
        if(!shouldPlay&&!a.paused)a.pause();
      }else if(!a.paused)a.pause();
    }
  };
  // Volume e término dos segmentos de voz precisam reagir em tempo de áudio,
  // não só ao evento timeupdate do <video> (que dispara poucas vezes/segundo).
  useEffect(()=>{
    let handle=0;
    const tick=()=>{
      const v=player.current;
      if(playing.current&&active?.clip.freeze){
        const now=performance.now();
        const clock=freezeClock.current;
        const elapsed=clock?.clipId===active.clip.id?Math.min(.1,(now-clock.stamp)/1000):0;
        freezeClock.current={clipId:active.clip.id,stamp:now};
        const next=Math.min(active.begin+active.clip.duration,playheadRef.current+elapsed);
        playheadRef.current=next;
        syncAudio(next,true);
        if(next>=active.begin+active.clip.duration-.015){
          if(active.begin+active.clip.duration<total-.015)setPlayhead(Math.min(total,active.begin+active.clip.duration+.002));
          else{playing.current=false;syncAudio(total,false);setPlayhead(total)}
        }else setPlayhead(next);
      }else if(playing.current&&v&&!v.paused&&active){
        const time=active.begin+Math.max(0,v.currentTime-active.clip.start);
        syncAudio(Math.min(time,total),true);
      }
      handle=requestAnimationFrame(tick);
    };
    handle=requestAnimationFrame(tick);
    return()=>cancelAnimationFrame(handle);
  },[project?.id,project?.clips,project?.audioTracks,project?.soundtrack,active?.clip.id]);
  const seek=(t:number)=>{
    const target=Math.max(0,Math.min(total,t));
    playheadRef.current=target;freezeClock.current=null;
    const same=active && target>=active.begin && target<active.begin+active.clip.duration;
    if(same && player.current && !active?.clip.freeze) player.current.currentTime=active.clip.start+(target-active.begin);
    setPlayhead(target);
    syncAudio(target,playing.current);
  };
  const playing=useRef(false);
  const freezeClock=useRef<{clipId:string;stamp:number}|null>(null);
  const playheadRef=useRef(playhead);
  playheadRef.current=playhead;
  // Uma nova cena pode vir do mesmo arquivo; o player precisa remontar
  // e posicionar a origem ANTES de iniciar, nunca inferir o tempo da cena anterior.
  const sceneReady=useRef<string|null>(null);
  const prepareScene=()=>{
    const video=player.current;
    if(!active||!video)return;
    const target=active.clip.start+(active.clip.freeze?0:active.offset);
    sceneReady.current=null;
    if(active.clip.freeze){
      freezeClock.current=null;
      try{video.pause();video.currentTime=active.clip.start}catch{}
      sceneReady.current=active.clip.id;
      syncAudio(active.begin+active.offset,playing.current);
      return;
    }
    try{
      if(Math.abs(video.currentTime-target)>.025){
        video.currentTime=target;
      }else{
        sceneReady.current=active.clip.id;
        if(playing.current)video.play().catch(()=>{
          playing.current=false;setError('Não foi possível reproduzir esta cena.');
        });
      }
    }catch(e){
      playing.current=false;
      setError('Não foi possível posicionar o vídeo no início do corte.');
    }
  };
  const onSceneSeeked=()=>{
    if(!active||!player.current)return;
    if(active.clip.freeze){sceneReady.current=active.clip.id;return;}
    const target=active.clip.start+active.offset;
    if(Math.abs(player.current.currentTime-target)>.15&&sceneReady.current!==active.clip.id)return;
    sceneReady.current=active.clip.id;
    if(playing.current)player.current.play().then(()=>syncAudio(active.begin+active.offset,true)).catch(()=>{
      playing.current=false;setError('Não foi possível continuar a reprodução.');
    });
    else syncAudio(active.begin+active.offset,false);
  };
  const togglePlayback=()=>{
    if(!player.current||!active)return;
    if(playing.current){
      playing.current=false;
      player.current.pause();
      syncAudio(playhead,false);
    }else{
      // Caso tenha chegado ao fim, iniciar novamente a partir da primeira cena.
      if(playhead>=total-.01&&total>0){playing.current=true;seek(0);return;}
      playing.current=true;
      if(active.clip.freeze){freezeClock.current=null;syncAudio(playhead,true);return;}
      if(sceneReady.current!==active.clip.id){
        prepareScene();return;
      }
      player.current.play().then(()=>syncAudio(playhead,true)).catch(()=>{
        playing.current=false;setError('Não foi possível reproduzir este vídeo.');
      });
    }
  };
  const onVideoTime=()=>{
    if(!active||!player.current||active.clip.freeze)return;
    // Não interpretar o tempo do player anterior como se fosse o novo clipe.
    if(sceneReady.current!==active.clip.id||player.current.seeking||player.current.readyState<1)return;
    const raw=player.current.currentTime-active.clip.start;
    if(raw<-.08)return;
    const pos=Math.max(0,raw);
    const nextTime=active.begin+Math.min(pos,active.clip.duration);
    if(pos>=active.clip.duration-.035){
      if(active.begin+active.clip.duration<total-.01){
        // Avança mesmo que o clipe seja outro corte do MESMO arquivo.
        setPlayhead(Math.min(total,active.begin+active.clip.duration+.002));
      }else{
        playing.current=false;
        player.current.pause();
        syncAudio(total,false);
        setPlayhead(total);
      }
    } else {
      setPlayhead(Math.min(total,nextTime));
      syncAudio(nextTime,playing.current&&!player.current.paused);
    }
  };
  const onVideoEnded=()=>{
    if(active?.clip.freeze)return;
    if(active&&active.begin+active.clip.duration<total-.01){
      const next=active.begin+active.clip.duration+.002;
      setPlayhead(next);
    }else{
      playing.current=false;
      syncAudio(total,false);
      setPlayhead(total);
    }
  };
  useEffect(()=>{
    if(!active||!player.current)return;
    player.current.volume=Math.max(0,Math.min(1,active.clip.volume??1));
    prepareScene();
  },[active?.clip.id]);
  const chatInstruction='Analise a narração do vídeo e crie legendas cinéticas e imagens de apoio no Nivoo Studio. Não cubra rostos, logos ou textos importantes. Utilize o vídeo e a timeline salvos no projeto.';
  const activeCaptions=project?.captions.filter(c=>c.start<=playhead&&c.end>playhead)||[];
  const activeAssets=project?.assets.filter(a=>a.start<=playhead&&a.end>playhead)||[];

  return <section className="studio">
    <header className="studio-head">
      <div><Link to={standalone?'/studio':'/p/'+pid}>← {standalone?'Produções':'Projeto'}</Link><h2>Nivoo Studio{standalone&&productionName?' · '+productionName:''}</h2><span>Edição não destrutiva • assistência de IA opcional</span></div>
      <div className="studio-actions">
        {project&&<><button disabled={!undoStack.current.length} onClick={undo}>↶ Desfazer</button><button disabled={!redoStack.current.length} onClick={redo}>↷ Refazer</button><button disabled={!dirty||busy} onClick={save}>Salvar {dirty?'●':''}</button><button disabled={busy||running.state==='running'} onClick={exportar}>Exportar MP4</button></>}
        <button onClick={newProject}>+ Nova edição</button>
      </div>
    </header>
    {error&&<p className="studio-error" role="alert">{error}</p>}
    {notice&&<p className="studio-notice">{notice}</p>}
    {aligning.state==='failed'&&<p className="studio-error">Legendas automáticas: {aligning.error}</p>}
    {aligning.state==='running'&&<p className="studio-notice">Alinhando a fala com o vídeo localmente…</p>}
    {running.state==='running'&&<p className="studio-notice" role="status">⏳ {running.stage||'Preparando renderização'} — você pode continuar usando a interface.</p>}
    {running.state==='failed'&&<p className="studio-error">Falha na exportação: {running.error}</p>}
    {running.state==='done'&&running.output&&<a href={midiaUrl(pid,running.output,standalone)} target="_blank" rel="noreferrer">Abrir vídeo exportado</a>}
    {!project?<div className="studio-start"><h3>Suas edições</h3>{list.map(x=><button key={x.id} onClick={()=>open(x.id)}>{x.title}</button>)}<button onClick={newProject}>Criar primeira edição</button></div>:
    <>
      <div className="studio-workspace">
        <aside className="studio-library">
          <h3>Biblioteca</h3>
          <label className="studio-upload">+ Importar mídias<input ref={inputRef} type="file" multiple hidden accept="video/*,audio/*,image/png,image/jpeg,image/webp" onChange={e=>upload(e.target.files)} /></label>
          {busy&&progress>0&&<small>Enviando {progress}%</small>}
          <button className="studio-section-toggle" type="button" aria-expanded={libraryOpen.videos} onClick={()=>toggleLibrary('videos')} title="Mostrar ou ocultar vídeos"><span>🎞 Vídeos <small>{mediaVideo.length}</small></span><span>{libraryOpen.videos?'▾':'▸'}</span></button>
          {libraryOpen.videos&&<div className="studio-section-contents">{mediaVideo.map(m=><div className="studio-media-row" key={m.caminho}>
            <button className="studio-media-add" title={'Adicionar '+m.nome} onClick={()=>append(m)}>＋ <span>{m.nome}</span></button>
            {m.pasta==='entrada'&&<button className="studio-media-delete" disabled={busy} title={'Excluir '+m.nome+' do projeto'} aria-label={'Excluir vídeo '+m.nome} onClick={()=>removeMedia(m)}>✕</button>}
          </div>)}</div>}
          <button className="studio-section-toggle" type="button" aria-expanded={libraryOpen.images} onClick={()=>toggleLibrary('images')} title="Mostrar ou ocultar imagens"><span>▧ Imagens <small>{mediaImage.length}</small></span><span>{libraryOpen.images?'▾':'▸'}</span></button>
          {libraryOpen.images&&<div className="studio-section-contents">{mediaImage.map(m=><div className="studio-media-row" key={m.caminho}>
            <span className="studio-media-filename" title={m.nome}>{m.nome}</span>
            <button className="studio-media-mini" title={'Adicionar imagem '+m.nome} aria-label={'Adicionar imagem '+m.nome} onClick={()=>addImage(m)}>＋</button>
          </div>)}</div>}
          {standalone&&<><button className="studio-section-toggle" type="button" aria-expanded={libraryOpen.narration} onClick={()=>toggleLibrary('narration')} title="Abrir ferramenta de narração"><span>🎙 Criar voz</span><span>{libraryOpen.narration?'▾':'▸'}</span></button>
          {libraryOpen.narration&&<div className="studio-narration">
            <h4>🎙 Criar narração com Kokoro</h4>
            <textarea aria-label="Roteiro da narração" placeholder="Cole ou escreva o texto que será narrado…" value={script} onChange={e=>setScript(e.target.value)} rows={4} maxLength={5000}/>
            <select aria-label="Voz da narração" value={voice} onChange={e=>setVoice(e.target.value)}>
              <option value="pf_dora">Dora · Feminina</option>
              <option value="pm_alex">Alex · Masculina</option>
              <option value="pm_santa">Santa · Masculina</option>
            </select>
            <label className="studio-speed-label">Velocidade da voz
              <select value={speed} onChange={e=>setSpeed(Number(e.target.value))}>
                <option value={0.85}>Lenta (0,85×)</option>
                <option value={1}>Natural (1×)</option>
                <option value={1.15}>Rápida (1,15×)</option>
              </select>
            </label>
            <button disabled={speechBusy||busy||!script.trim()} onClick={generateSpeech}>{speechBusy?'Gerando áudio…':'Gerar narração'}</button>
            <small>Áudio salvo na biblioteca e inserido na timeline quando houver vídeo.</small>
          </div>}</>}
          <button className="studio-section-toggle" type="button" aria-expanded={libraryOpen.audios} onClick={()=>toggleLibrary('audios')} title="Mostrar ou ocultar áudios"><span>♫ Áudios <small>{mediaAudio.length}</small></span><span>{libraryOpen.audios?'▾':'▸'}</span></button>
          {libraryOpen.audios&&<div className="studio-section-contents">{mediaAudio.map(m=><div key={m.caminho} className="studio-audio-source">
            <div className="studio-audio-heading">
              <span className="studio-audio-name" title={m.nome}>{m.nome}</span>
              {m.pasta==='entrada'&&<button className="studio-audio-delete" disabled={busy} title={'Excluir '+m.nome+' da biblioteca'} aria-label={'Excluir áudio '+m.nome} onClick={()=>removeMedia(m)}>✕</button>}
            </div>
            <div className="studio-audio-actions">
              <button className="studio-audio-icon-button" type="button" aria-label={previewing===m.caminho?'Parar áudio '+m.nome:'Ouvir áudio '+m.nome} title={previewing===m.caminho?'Parar prévia':'Ouvir áudio'} onClick={()=>previewAudio(m)}>{previewing===m.caminho?'■':'▶'}</button>
              {standalone&&m.roteiro&&<button className="studio-audio-icon-button" type="button" aria-label={'Carregar roteiro de '+m.nome} title="Carregar roteiro" onClick={()=>loadScript(m)}>✎</button>}
              <button className="studio-audio-icon-button" type="button" aria-label={'Adicionar '+m.nome+' à faixa de voz'} disabled={project.soundtrack?.source===m.caminho} onClick={()=>addAudio(m)} title={project.soundtrack?.source===m.caminho?'Este áudio já é uma trilha':'Adicionar à voz'}>🎙</button>
              <button className="studio-audio-icon-button" type="button" aria-label={'Usar '+m.nome+' como trilha musical'} onClick={()=>{mutate(p=>({...p,audioTracks:(p.audioTracks??[]).filter(a=>a.source!==m.caminho),soundtrack:{source:m.caminho,volume:.24}}));setSelected(null);setTab('audio');}} title="Adicionar à trilha musical">♫</button>
            </div>
          </div>)}</div>}
          <button className="studio-section-toggle" type="button" aria-expanded={libraryOpen.edits} onClick={()=>toggleLibrary('edits')} title="Mostrar ou ocultar edições"><span>▤ Edições <small>{list.length}</small></span><span>{libraryOpen.edits?'▾':'▸'}</span></button>
          {libraryOpen.edits&&<div className="studio-section-contents">{list.map(x=><button className="studio-edition-row" key={x.id} title={'Abrir edição '+x.title} onClick={()=>open(x.id)}>▸ {x.title}</button>)}</div>}
        </aside>
        <main className="studio-preview-panel">
          <div className="studio-canvas" ref={canvasRef}>
            {project.soundtrack&&<audio ref={soundtrackPlayer} src={midiaUrl(pid,project.soundtrack.source,standalone)} loop preload="metadata"/>}
            {(project.audioTracks??[]).map(t=><audio key={t.id} ref={el=>{if(el)audioPlayers.current.set(t.id,el);else audioPlayers.current.delete(t.id);}} src={midiaUrl(pid,t.source,standalone)} preload="metadata"/>)}
            {active?<video key={active.clip.id} ref={player} src={midiaUrl(pid,active.clip.source,standalone)} preload="auto" playsInline onLoadedMetadata={prepareScene} onSeeked={onSceneSeeked} onTimeUpdate={onVideoTime} onEnded={onVideoEnded} onPause={()=>{if(!playing.current)syncAudio(playhead,false)}} onError={()=>{playing.current=false;setError('Falha ao carregar esta cena. Verifique o arquivo ou o formato do vídeo.')}} />:<span>Adicione um vídeo para começar</span>}
            {outgoingClip&&activeTransition&&active&&active.offset<activeTransition.duration&&
              <video key={'previous-'+outgoingClip.id+'-'+active.clip.id} className="studio-transition-previous"
                src={midiaUrl(pid,outgoingClip.source,standalone)} preload="auto" muted playsInline
                style={previousFrameStyle}
                onLoadedMetadata={e=>{
                  const el=e.currentTarget;
                  const end=Math.min(Math.max(0,el.duration-.04),Math.max(0,outgoingClip.end-.04));
                  el.currentTime=outgoingClip.freeze?outgoingClip.start:end;
                }}/>}

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
            <button onClick={togglePlayback} title="Reproduzir ou pausar (Espaço)">▶ / ❚❚</button>
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
            <button onClick={()=>split()}>✂ Dividir no cursor</button>
            <button onClick={()=>keepSide('before')} title="Manter o começo do clipe até o cursor">Manter antes do cursor</button>
            <button onClick={()=>keepSide('after')} title="Manter apenas o trecho após o cursor">Manter depois do cursor</button>
            <button onClick={duplicateClip}>Duplicar clipe</button><button onClick={extendEnding} title="Congelar último quadro para a narração caber">❄ Estender final até narração</button>
            <button onClick={()=>move(selectedClip.id,-1)}>Mover para esquerda</button><button onClick={()=>move(selectedClip.id,1)}>Mover para direita</button><button onClick={remove}>Remover corte</button>
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
          {tab==='audio'&&<div className="studio-fields">{selectedAudio&&<><h4>Faixa de áudio selecionada</h4>{(['start','end','offset','volume','fadeIn','fadeOut'] as const).map(k=><label key={k}>{ {start:'Início no arquivo',end:'Fim no arquivo',offset:'Posição na timeline',volume:'Volume',fadeIn:'Fade de entrada (s)',fadeOut:'Fade de saída (s)'}[k]}<input type="number" min="0" step=".01" value={selectedAudio[k]??0} onChange={e=>updateAudio(k,e.target.value)}/></label>)}<button onClick={extendEnding} title="Congelar o último quadro até a narração terminar">❄ Ajustar vídeo à voz</button><button onClick={splitNarration}>✂ Dividir voz no cursor</button><button onClick={duplicateNarration}>Duplicar voz em sequência</button><button disabled={selectedAudio.offset===0} onClick={()=>mutate(p=>({...p,audioTracks:(p.audioTracks??[]).map(a=>a.id===selected?{...a,offset:0,end:Math.min(a.end,total)}:a)}))}>Alinhar voz ao início (00:00)</button><button onClick={remove}>Excluir segmento da voz</button></>}{project.soundtrack?<><p>Trilha: {mediaName(project.soundtrack.source)}</p><label>Volume da trilha <input type="range" min="0" max="2" step=".01" value={project.soundtrack.volume} onChange={e=>mutate(p=>({...p,soundtrack:p.soundtrack?{...p.soundtrack,volume:Number(e.target.value)}:null}))}/></label><button onClick={()=>mutate(p=>({...p,soundtrack:null}))}>Remover trilha</button></>:<p>Escolha um áudio da biblioteca para adicionar uma trilha.</p>}</div>}
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
        <div className="studio-timeline-head"><h3>Linha do tempo · {fmt(total)} {dirty&&<span className="studio-unsaved">● Não salvo</span>}</h3>
          <div className="studio-edit-tools">
            <button className={editMode==='select'?'on':''} title="Selecionar e mover clipes (V)" onClick={()=>setEditMode('select')}>↖ Selecionar</button>
            <button className={editMode==='blade'?'on':''} title="Clique no clipe para dividir no ponto escolhido (B)" onClick={()=>setEditMode('blade')}>✂ Cortar</button>
            <button disabled={!selectedClip} title="Excluir o trecho selecionado, fechando o espaço (Delete)" onClick={remove}>⌫ Excluir trecho</button>
            <button title="Abrir paleta de transições entre cenas" onClick={()=>openTransitions()}>◐ Transições</button>
            <button className={snap?'on':''} title="Imantar narração ao início e às bordas de outras falas" onClick={()=>setSnap(v=>!v)}>⊙ Imã {snap?'ligado':'desligado'}</button>
            <label title="Ampliar a linha do tempo">Zoom <input type="range" min="1" max="4" step=".25" value={zoom} onChange={e=>setZoom(Number(e.target.value))}/></label>
          </div></div>
        <div className="studio-tracks-viewport"><div className="studio-tracks" style={{width:(100*zoom)+'%'}}>
          <div className="studio-track studio-time-ruler"><span>Tempo</span><div className="studio-ruler" onClick={e=>{
            const rect=e.currentTarget.getBoundingClientRect();
            seek(Math.max(0,Math.min(total,((e.clientX-rect.left)/Math.max(1,rect.width))*total)));
          }}>{ticks.map(t=><span className="studio-ruler-tick" key={t} style={{left:(t/Math.max(total,.01)*100)+'%'}}>{fmt(t)}</span>)}
            <span className="studio-ruler-cursor" style={{left:(playhead/Math.max(total,.01)*100)+'%'}}/>
          </div></div>
          <div className="studio-track"><span>Vídeo</span><div className="studio-track-items studio-video-clips">{clips.map(c=>
            <div key={c.id} className={'studio-video-clip'+(selected===c.id?' chosen':'')}
              draggable={editMode==='select'} onDragStart={()=>{dragged.current=c.id}} onDragOver={e=>e.preventDefault()}
              onDrop={e=>{e.preventDefault();if(dragged.current)reorder(dragged.current,c.id);dragged.current=null}}
              onClick={e=>{
                if(suppressClipClick.current)return;
                setSelected(c.id);setTab('clips');
                const begin=clips.slice(0,clips.indexOf(c)).reduce((n,v)=>n+v.duration,0);
                if(editMode==='blade'){
                  const rect=e.currentTarget.getBoundingClientRect();
                  const fraction=Math.max(0,Math.min(1,(e.clientX-rect.left)/Math.max(rect.width,1)));
                  const at=begin+c.duration*fraction;
                  split(c.id,at);setPlayhead(at);
                }else seek(begin);
              }}
              style={{flex:c.duration,minWidth:30}} title={mediaName(c.source)+' · '+c.start.toFixed(2)+'–'+c.end.toFixed(2)+'s'}>
              {clips.indexOf(c)>0&&<button type="button" className={'studio-transition-marker'+(c.transition?' configured':'')}
                title={c.transition?'Editar transição '+transitionPresets.find(p=>p.type===c.transition?.type)?.label:'Adicionar transição entre cenas'}
                aria-label={'Configurar transição antes de '+mediaName(c.source)}
                onPointerDown={e=>e.stopPropagation()} onClick={e=>{e.stopPropagation();openTransitions(c.id)}}>
                ◇
              </button>}
              <span className="studio-video-grip" data-edge="start" title="Arraste para aparar o começo"
                onPointerDown={e=>startVideoTrim(e,c.id,'start')} onPointerMove={moveVideoTrim} onPointerUp={endVideoTrim} onPointerCancel={endVideoTrim}/>
              <span className="studio-video-title"><StudioFilmstrip src={midiaUrl(pid,c.source,standalone)} start={c.start} end={c.end}/><span className="studio-video-caption">{c.freeze?'❄ Quadro congelado':mediaName(c.source)} <small>{c.duration.toFixed(1)}s</small></span></span>
              <span className="studio-video-grip" data-edge="end" title="Arraste para aparar o fim"
                onPointerDown={e=>startVideoTrim(e,c.id,'end')} onPointerMove={moveVideoTrim} onPointerUp={endVideoTrim} onPointerCancel={endVideoTrim}/>
            </div>)}</div></div>
          <div className="studio-track"><span>Legendas</span><div className="studio-track-overlay">{project.captions.map(c=>timelineBlock('caption',c.id,c.text,c.start,c.end))}</div></div>
          <div className="studio-track"><span>Imagens</span><div className="studio-track-overlay">{project.assets.map(a=>timelineBlock('asset',a.id,mediaName(a.source),a.start,a.end))}</div></div>
          {audioLanes.map((lane,i)=><div className="studio-track" key={'voice-'+i}><span className="studio-track-name" title={'Faixa de voz '+(i+1)}><span aria-hidden="true">🎙</span> Voz {i+1}</span>
            <div className="studio-track-overlay studio-audio-timeline">{lane.map(a=>timelineBlock('audio',a.id,mediaName(a.source),a.offset,a.offset+a.end-a.start))}</div>
          </div>)}
          <div className="studio-track"><span>Proteção</span><div className="studio-track-overlay studio-protection-timeline">{(project.protectedZones??[]).map(z=>timelineBlock('zone',z.id,z.label,z.start,z.end))}</div></div>
          <div className="studio-track"><span className="studio-track-name" title="Trilha musical"><span aria-hidden="true">♫</span> Trilha</span><div className="studio-track-audio">{project.soundtrack?mediaName(project.soundtrack.source):'Sem trilha'}</div></div>
        </div></div>
      </div>
      {transitionOpen&&<div ref={transitionPanelRef} className="studio-transition-panel"
        role="dialog" aria-modal="false" aria-label="Paleta de transições"
        style={{left:transitionPosition.x,top:transitionPosition.y}}>
        <div className="studio-transition-panel-head" title="Arraste para mover esta janela"
          onPointerDown={startTransitionPanelDrag}
          onPointerMove={moveTransitionPanelDrag}
          onPointerUp={endTransitionPanelDrag}
          onPointerCancel={endTransitionPanelDrag}>
          <strong>◐ Transições de cena</strong>
          <button type="button" title="Fechar paleta" aria-label="Fechar paleta" onClick={()=>setTransitionOpen(false)}>✕</button>
        </div>
        <div className="studio-transition-panel-body">
          <label>Entre quais cenas?
            <select value={transitionTarget?.id??''} onChange={e=>{
              const clip=clips.find(c=>c.id===e.target.value);
              setTransitionClip(clip?.id??null);
              setTransitionType(clip?.transition?.type??'fade');
              setTransitionDuration(clip?.transition?.duration??.6);
            }}>
              {clips.slice(1).map((c,i)=><option key={c.id} value={c.id}>
                {i+1} → {i+2} · {mediaName(c.source)}
              </option>)}
            </select>
          </label>
          <span className="studio-transition-label">Escolha o efeito</span>
          <div className="studio-transition-presets">
            {transitionPresets.map(p=><button type="button" key={p.type} className={transitionType===p.type?'selected':''}
              title={p.description} onClick={()=>setTransitionType(p.type)}>
              <span className={'studio-transition-swatch effect-'+p.type} aria-hidden="true">{p.symbol}</span>
              <span>{p.label}</span>
            </button>)}
          </div>
          <label>Duração <strong>{transitionDuration.toFixed(2)}s</strong>
            <input type="range" min=".1" max={Math.max(.1,Math.min(2,(transitionTarget?.duration??2)-.05))}
              step=".05" value={Math.min(transitionDuration,Math.max(.1,Math.min(2,(transitionTarget?.duration??2)-.05)))}
              onChange={e=>setTransitionDuration(Number(e.target.value))}/>
          </label>
          <p className="studio-transition-help">A transição não reduz o tempo do vídeo e não corta a narração.</p>
          <div className="studio-transition-panel-actions">
            <button onClick={saveTransition} disabled={!transitionTarget||transitionTarget.duration<.15}>Aplicar</button>
            <button onClick={clearTransition} disabled={!transitionTarget?.transition}>Remover</button>
            <button onClick={()=>setTransitionOpen(false)}>Fechar</button>
          </div>
        </div>
      </div>}
    </>}
  </section>;
}
