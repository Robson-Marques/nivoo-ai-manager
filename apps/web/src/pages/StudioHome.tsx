import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api';
import './VideoStudio.css';

type Production={id:string;title:string;createdAt:string;updatedAt:string};
export function StudioHome(){
  const nav=useNavigate();
  const [items,setItems]=useState<Production[]>([]);
  const [error,setError]=useState('');
  const [creating,setCreating]=useState(false);
  useEffect(()=>{api<Production[]>('/studio/productions').then(setItems).catch(e=>setError(e.message))},[]);
  const create=async()=>{
    const title=window.prompt('Nome do novo projeto de vídeo','Meu vídeo');
    if(!title?.trim())return;
    setCreating(true);setError('');
    try{
      const p=await api<Production>('/studio/productions','POST',{title:title.trim()});
      await api('/studio/projects/'+p.id+'/edits','POST',{title:'Edição principal'});
      nav('/studio/'+p.id);
    }catch(e:any){setError(e.message)}
    finally{setCreating(false)}
  };
  return <section className="studio studio-home">
    <header className="studio-head"><div><h2>🎬 Nivoo Studio</h2><span>Produção audiovisual independente dos projetos de conversa</span></div>
      <button disabled={creating} onClick={create}>+ Novo projeto de vídeo</button></header>
    {error&&<p className="studio-error">{error}</p>}
    <div className="studio-home-grid">
      {items.map(p=><Link key={p.id} to={'/studio/'+p.id} className="studio-home-item">
        <strong>🎞 {p.title}</strong><small>Atualizado em {new Date(p.updatedAt).toLocaleDateString('pt-BR')}</small>
        <span>Abrir editor →</span></Link>)}
      {!items.length&&<div className="studio-home-empty">Crie seu primeiro projeto. Cada produção terá vídeos, áudio, roteiros e edições próprios.</div>}
    </div>
  </section>;
}
