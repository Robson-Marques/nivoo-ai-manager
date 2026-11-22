import { useEffect, useState } from 'react';
import { api } from '../../api';

type RegistryItem={
  name:string;type:'block'|'component';title:string;description:string;
  tags:string[];status:'reference-only';preview?:{video?:string;poster?:string};
};
type ReviewRequest={name:string;type:string;title:string;state:'needs-review';executable:false};
type SearchResult={
  query:string;tier:string;total:number;items:RegistryItem[];notice:string;
};
const searches=[
  {title:'Transições',query:'transition reveal'},
  {title:'Tipografia',query:'kinetic text title'},
  {title:'Brilho',query:'neon glow'},
  {title:'Glitch',query:'glitch'},
  {title:'Partículas',query:'particles'},
  {title:'3D',query:'3d camera'},
];
export function StudioOfficialCatalog({edits}:{edits:string}){
  const [query,setQuery]=useState('transition reveal');
  const [search,setSearch]=useState<SearchResult|null>(null);
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState('');
  const [reviews,setReviews]=useState<ReviewRequest[]>([]);
  const [reviewing,setReviewing]=useState<string|null>(null);
  const [previewing,setPreviewing]=useState<string|null>(null);
  useEffect(()=>{
    let alive=true;
    setReviews([]);
    api<ReviewRequest[]>(edits+'/motion/reviews')
      .then(items=>{if(alive)setReviews(items)})
      .catch(e=>{if(alive)setError(String(e?.message??e))});
    return()=>{alive=false};
  },[edits]);
  const requestReview=async(item:RegistryItem)=>{
    if(!search||reviewing)return;
    setReviewing(item.name);setError('');
    try {
      const created=await api<ReviewRequest>(edits+'/motion/reviews','POST',
        {query:search.query,name:item.name});
      setReviews(prev=>prev.some(v=>v.name===created.name)?prev:[...prev,created]);
    }catch(e:any){setError(String(e?.message??e))}
    finally{setReviewing(null)}
  };
  const request=async(value:string)=>{
    if(loading)return;
    setLoading(true);setError('');setPreviewing(null);
    try{
      const data=await api<SearchResult>(edits+'/motion/catalog?query='+encodeURIComponent(value));
      setSearch(data);setQuery(value);
    }catch(e:any){setError(String(e?.message??e));setSearch(null)}
    finally{setLoading(false)}
  };
  return <details className="studio-official-catalog">
    <summary>Explorar catálogo oficial HyperFrames <small>(somente consulta)</small></summary>
    <p>Pesquise por movimento em inglês e veja as prévias originais. Solicitar curadoria salva
      o bloco na fila técnica; não instala nem executa o código externo.</p>
    <div className="studio-catalog-chips">
      {searches.map(p=><button type="button" key={p.query} disabled={loading}
        onClick={()=>void request(p.query)}>{p.title}</button>)}
    </div>
    <form onSubmit={e=>{e.preventDefault();void request(query.trim())}}>
      <input aria-label="Buscar bloco HyperFrames em inglês" type="text" maxLength={90}
        placeholder="transition, animated title, particles…" value={query}
        onChange={e=>setQuery(e.target.value)}/>
      <button type="submit" disabled={loading||query.trim().length<2}>
        {loading?'Consultando…':'Buscar'}</button>
    </form>
    {error&&<p role="alert" className="studio-motion-error">{error}</p>}
    {reviews.length>0&&<small>{reviews.length} bloco(s) aguardando revisão técnica nesta produção.</small>}
    {search&&<>
      <small>Consulta: {search.query} · mecanismo: {search.tier} · itens: {search.total}</small>
      {search.items.length===0?<p>Nenhum bloco encontrado nesta consulta.</p>:
        <ul className="studio-catalog-results">{search.items.map(item=>
          <li key={item.name}>
            <strong>{item.title||item.name}</strong>
            <small>{item.type==='block'?'Bloco':'Componente'} · {item.name}</small>
            {item.description&&<p>{item.description}</p>}
            {item.tags.length>0&&<small>{item.tags.join(' · ')}</small>}
            {item.preview?.video&&<div className="studio-catalog-preview">
              {previewing===item.name?<video key={item.name} controls playsInline preload="none"
                poster={item.preview.poster} aria-label={'Prévia oficial de '+item.title}>
                <source src={item.preview.video} type="video/mp4"/>
              </video>:<button type="button" onClick={()=>setPreviewing(item.name)}>
                <span aria-hidden="true">▶</span> Ver prévia original
              </button>}
            </div>}
            {reviews.some(v=>v.name===item.name)?
              <small>Em curadoria técnica · não executável</small>:
              <button type="button" disabled={Boolean(reviewing)}
                onClick={()=>void requestReview(item)}>
                {reviewing===item.name?'Registrando…':'Solicitar curadoria'}
              </button>}
          </li>)}</ul>}
      <small>{search.notice}</small>
    </>}
  </details>;
}
