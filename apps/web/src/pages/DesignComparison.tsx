import { useEffect,useState } from 'react';
import { api,apiBlob } from '../api';
type Job={id:string;title:string;status:string};
type Artifact={id:string;nome:string;bytes:number};
type Pair={name:string;before?:Artifact;after?:Artifact};
function pairsOf(items:Artifact[]):Pair[]{
  const pairs=new Map<string,Pair>();
  for(const a of items){
    const match=/^remodelagem\/(antes|depois)\/([a-zA-Z0-9_.-]+\.(?:png|jpe?g|webp))$/i.exec(a.nome);
    if(!match)continue;
    const key=match[2];const p=pairs.get(key)??{name:key};
    if(match[1].toLowerCase()==='antes')p.before=a;else p.after=a;
    pairs.set(key,p);
  }
  return [...pairs.values()].sort((a,b)=>a.name.localeCompare(b.name));
}
function Picture({projectId,artifact,label}:{projectId:string;artifact?:Artifact;label:string}){
  const [url,setUrl]=useState('');const [error,setError]=useState('');
  useEffect(()=>{
    let cancelled=false;let objectUrl='';
    setUrl('');setError('');
    if(!artifact)return;
    if(artifact.bytes>20*1024*1024){setError('Imagem acima de 20 MB. Abra pelos resultados do trabalho.');return;}
    apiBlob('/projects/'+projectId+'/artifacts/'+artifact.id).then(blob=>{
      if(cancelled)return;
      if(!/^image\/(png|jpeg|webp)$/.test(blob.type))throw Error('O resultado não é uma imagem suportada.');
      objectUrl=URL.createObjectURL(blob);setUrl(objectUrl);
    }).catch(e=>{if(!cancelled)setError(e instanceof Error?e.message:String(e));});
    return ()=>{cancelled=true;if(objectUrl)URL.revokeObjectURL(objectUrl);};
  },[projectId,artifact?.id]);
  return <figure><figcaption>{label}</figcaption>{url?<a href={url} target="_blank" rel="noreferrer"><img src={url} alt={label}/></a>:<p>{error||(!artifact?'Captura não entregue.':'Carregando captura…')}</p>}</figure>;
}
export function DesignComparison({projectId}:{projectId:string}){
  const [jobs,setJobs]=useState<Job[]|null>(null);
  const [job,setJob]=useState('');
  const [pairs,setPairs]=useState<Pair[]|null>(null);
  const [selected,setSelected]=useState('');
  const [error,setError]=useState('');
  const [version,setVersion]=useState(0);
  useEffect(()=>{
    let live=true;setJobs(null);setError('');
    api<Job[]>('/projects/'+projectId+'/jobs').then(rows=>{if(live)setJobs(rows.filter(j=>j.title.startsWith('Remodelagem — ')));}).catch(e=>{if(live){setJobs([]);setError(e instanceof Error?e.message:String(e));}});
    return ()=>{live=false};
  },[projectId,version]);
  useEffect(()=>{
    let live=true;setPairs(null);setSelected('');
    if(!job)return;
    api<Artifact[]>('/projects/'+projectId+'/jobs/'+job+'/resultados').then(items=>{if(live){const found=pairsOf(items);setPairs(found);setSelected(found[0]?.name??'');}}).catch(e=>{if(live){setPairs([]);setError(e instanceof Error?e.message:String(e));}});
    return ()=>{live=false};
  },[projectId,job,version]);
  const pair=pairs?.find(p=>p.name===selected);
  return <section className="design-target"><h3>Comparar antes e depois</h3>
    <p>Capturas reais entregues pelos trabalhos de remodelagem deste projeto.</p>
    <button type="button" className="secondary" onClick={()=>{setError('');setVersion(v=>v+1)}}>Atualizar resultados</button>
    <label>Trabalho<select value={job} onChange={e=>{setError('');setJob(e.target.value)}}><option value="">{jobs===null?'Carregando…':'Selecione um trabalho'}</option>{jobs?.map(j=><option key={j.id} value={j.id}>{j.title} · {j.status}</option>)}</select></label>
    {jobs?.length===0&&<p>Nenhum trabalho de remodelagem encontrado.</p>}
    {job&&pairs?.length===0&&<p>Este trabalho ainda não entregou capturas no padrão do comparador. Consulte os resultados e o relatório do trabalho.</p>}
    {pairs&&pairs.length>0&&<label>Tela / viewport<select value={selected} onChange={e=>setSelected(e.target.value)}>{pairs.map(p=><option key={p.name}>{p.name}</option>)}</select></label>}
    {pair&&<div className="design-comparison"><Picture projectId={projectId} artifact={pair.before} label="Antes"/><Picture projectId={projectId} artifact={pair.after} label="Depois"/></div>}
    {error&&<p role="alert" className="error">{error}</p>}
  </section>;
}
