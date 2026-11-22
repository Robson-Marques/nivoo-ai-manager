import { useState } from 'react';
import { api } from '../../api';

type RegistryItem={
  name:string;type:'block'|'component';title:string;description:string;
  tags:string[];status:'reference-only';
};
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
  const request=async(value:string)=>{
    if(loading)return;
    setLoading(true);setError('');
    try{
      const data=await api<SearchResult>(edits+'/motion/catalog?query='+encodeURIComponent(value));
      setSearch(data);setQuery(value);
    }catch(e:any){setError(String(e?.message??e));setSearch(null)}
    finally{setLoading(false)}
  };
  return <details className="studio-official-catalog">
    <summary>Explorar catálogo oficial HyperFrames <small>(somente consulta)</small></summary>
    <p>Pesquise por movimento em inglês. Os blocos encontrados são referências externas;
      somente os efeitos locais revisados acima podem ser renderizados aqui.</p>
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
    {search&&<>
      <small>Consulta: {search.query} · mecanismo: {search.tier} · itens: {search.total}</small>
      {search.items.length===0?<p>Nenhum bloco encontrado nesta consulta.</p>:
        <ul className="studio-catalog-results">{search.items.map(item=>
          <li key={item.name}>
            <strong>{item.title||item.name}</strong>
            <small>{item.type==='block'?'Bloco':'Componente'} · {item.name}</small>
            {item.description&&<p>{item.description}</p>}
            {item.tags.length>0&&<small>{item.tags.join(' · ')}</small>}
          </li>)}</ul>}
      <small>{search.notice}</small>
    </>}
  </details>;
}
