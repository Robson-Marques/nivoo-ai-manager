import { useEffect, useState } from 'react';
import { api, urlAutenticada } from '../../api';
import './StudioMotionMaker.css';
import { StudioOfficialCatalog } from './StudioOfficialCatalog';

type Preset={id:string;label:string;description:string;category:'title'|'light'|'transition';durationSeconds:number;origin:string;version:number};
type State={state:'idle'|'running'|'done'|'failed'|'cancelled';output?:string;error?:string;durationMs?:number;warnings?:string[]};

export function StudioMotionMaker(props:{
  edits:string;mediaBase:string;editId:string;
  ready:boolean;onAdd:(source:string)=>void;
}) {
  const [presets,setPresets]=useState<Preset[]>([]);
  const [preset,setPreset]=useState('kinetic-title');
  const [category,setCategory]=useState<'all'|'title'|'light'|'transition'>('all');
  const [title,setTitle]=useState('');
  const [replay,setReplay]=useState(0);
  const [state,setState]=useState<State>({state:'idle'});
  const [error,setError]=useState('');
  const endpoint=props.edits+'/'+props.editId+'/motion';
  useEffect(()=>{
    let alive=true;
    setState({state:'idle'});setError('');
    Promise.all([api<Preset[]>(props.edits+'/motion/presets'),api<State>(endpoint)])
      .then(([list,current])=>{if(alive){setPresets(list);setState(current)}})
      .catch(e=>{if(alive)setError(String(e?.message??e))});
    return()=>{alive=false};
  },[props.edits,props.editId]);
  useEffect(()=>{
    if(state.state!=='running')return;
    let alive=true;
    const interval=setInterval(()=>{
      api<State>(endpoint).then(next=>{if(alive)setState(next)})
        .catch(e=>{if(alive)setError(String(e?.message??e))});
    },1400);
    return()=>{alive=false;clearInterval(interval)};
  },[endpoint,state.state]);
  const create=async()=>{
    if(!title.trim()||state.state==='running')return;
    setError('');
    try {setState(await api<State>(endpoint,'POST',{preset,title:title.trim()}))}
    catch(e:any){setError(e.message)}
  };
  const cancel=async()=>{
    try {setState(await api<State>(endpoint+'/cancel','POST',{}))}
    catch(e:any){setError(e.message)}
  };
  const videoUrl=state.output?urlAutenticada(props.mediaBase+
    '/midia/content?path='+encodeURIComponent(state.output)):undefined;
  return <div className="studio-motion" aria-label="Biblioteca de motion design">
    <h4>✦ Motion design · HyperFrames</h4>
    <p>Gere uma prévia curta e insira o vídeo na timeline.</p>
    <select aria-label="Categoria de efeito" value={category} onChange={e=>{
      const next=e.target.value as typeof category;
      setCategory(next);
      const first=presets.find(p=>next==='all'||p.category===next);
      if(first)setPreset(first.id);
      setReplay(n=>n+1);
    }}>
      <option value="all">Todos os efeitos</option>
      <option value="title">Títulos</option>
      <option value="light">Luz e neon</option>
      <option value="transition">Revelações e transições</option>
    </select>
    <select aria-label="Animação HyperFrames" value={preset} onChange={e=>{setPreset(e.target.value);setReplay(n=>n+1)}}>
      {(presets.filter(p=>category==='all'||p.category===category)).map(p=>
        <option key={p.id} value={p.id}>{p.label}</option>)}
    </select>
    {presets.find(p=>p.id===preset)?.description&&<small>{presets.find(p=>p.id===preset)?.description} · Modelo revisado v{presets.find(p=>p.id===preset)?.version}</small>}
    <input aria-label="Texto do motion" placeholder="Texto da animação" maxLength={100}
      value={title} onChange={e=>setTitle(e.target.value)}/>
    <div className="studio-motion-example" aria-label="Simulação local do efeito, sem renderização">
      <span key={preset+'-'+replay} className={'studio-motion-preview-text studio-motion-'+preset}>
        {title.trim()||'SEU TÍTULO'}
      </span>
      <button type="button" title="Repetir animação" aria-label="Repetir exemplo"
        onClick={()=>setReplay(n=>n+1)}>↻</button>
    </div>
    <button disabled={!props.ready||!presets.length||!title.trim()||state.state==='running'}
      onClick={create}>{state.state==='running'?'Renderizando prévia…':'Gerar prévia HyperFrames'}</button>
    {!props.ready&&<small>HyperFrames não disponível no servidor. Confira Ferramentas.</small>}
    {state.state==='running'&&<div role="status"><small>Gerando MP4 local de 3,2 segundos…</small>
      <button onClick={cancel}>Cancelar prévia</button></div>}
    {(error||state.error)&&<p className="studio-motion-error" role="alert">{error||state.error}</p>}
    {state.state==='cancelled'&&<small>Prévia cancelada.</small>}
    {state.state==='done'&&videoUrl&&<div className="studio-motion-result">
      <video src={videoUrl} controls playsInline preload="metadata" aria-label="Prévia de motion design"/>
      <button onClick={()=>props.onAdd(state.output!)}>+ Inserir na timeline</button>
      {state.warnings?.map(w=><small key={w}>{w}</small>)}
    </div>}
    <StudioOfficialCatalog edits={props.edits}/>
    <small>Modelos locais. Blocos externos ainda exigem revisão antes de executar.</small>
  </div>;
}
