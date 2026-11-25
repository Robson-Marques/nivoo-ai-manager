import { useEffect, useState } from 'react';
import { api } from '../api';
import './DesignStudio.css';

type Source={id:string;name:string;style:string;kind:'library'|'registry'|'reference';url:string;docs:string;install?:string;requirements:string[];status:'reference'|'adapter-pending';related?:string[]};
type Fields={title:string;mode:'new'|'remodel';sourceId:string;theme:'light'|'dark'|'system'};
type Profile=Fields & {id:string;revision:number;updatedAt:string;schemaVersion:1};
const empty:Fields={title:'',mode:'new',sourceId:'liqui',theme:'system'};
export function DesignStudio(){
  const [sources,setSources]=useState<Source[]>([]);
  const [profiles,setProfiles]=useState<Profile[]>([]);
  const [draft,setDraft]=useState<Fields>(empty);
  const [current,setCurrent]=useState<Profile|null>(null);
  const [loading,setLoading]=useState(true);
  const [saving,setSaving]=useState(false);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const load=async()=>{
    setLoading(true);setError('');
    try {
      const [catalog,items]=await Promise.all([api<{sources:Source[]}>('/design-studio/catalog'),api<Profile[]>('/design-studio/profiles')]);
      setSources(catalog.sources);setProfiles(items);
    } catch(e) {setError(e instanceof Error?e.message:String(e));}
    finally {setLoading(false);}
  };
  useEffect(()=>{void load()},[]);
  const selectProfile=(id:string)=>{
    const p=profiles.find(x=>x.id===id)??null;
    setCurrent(p);setDraft(p?{title:p.title,mode:p.mode,sourceId:p.sourceId,theme:p.theme}:empty);
    setError('');setNotice('');
  };
  const save=async()=>{
    setSaving(true);setError('');setNotice('');
    try {
      const p= current
        ? await api<Profile>('/design-studio/profiles/'+current.id,'PUT',{...draft,revision:current.revision})
        : await api<Profile>('/design-studio/profiles','POST',draft);
      setCurrent(p);setDraft({title:p.title,mode:p.mode,sourceId:p.sourceId,theme:p.theme});
      setProfiles(old=>[p,...old.filter(x=>x.id!==p.id)]);setNotice('Perfil salvo no servidor.');
    } catch(e) {setError(e instanceof Error?e.message:String(e));}
    finally {setSaving(false);}
  };
  const source=sources.find(s=>s.id===draft.sourceId);
  const related=sources.filter(s=>source?.related?.includes(s.id));
  return <section className="design-studio">
    <header className="design-studio-header"><div><h2>Studio de Design</h2><p>Identidades visuais para novos frontends e remodelagens.</p></div><button className="secondary" disabled={saving} onClick={()=>selectProfile('')}>Novo perfil</button></header>
    {error&&<p role="alert" className="error">{error} <button className="secondary" disabled={loading||saving} onClick={()=>void load()}>Recarregar catálogo e perfis</button></p>}
    {loading?<p role="status">Carregando catálogo e perfis…</p>:<div className="design-studio-grid">
      <form className="design-studio-panel" onSubmit={e=>{e.preventDefault();void save()}}>
        <h3>Configuração</h3>
        <fieldset disabled={saving}>
          <label>Perfil salvo<select value={current?.id??''} onChange={e=>selectProfile(e.target.value)}><option value="">Novo perfil</option>{profiles.map(p=><option key={p.id} value={p.id}>{p.title}</option>)}</select></label>
          <label>Nome<input required maxLength={120} value={draft.title} onChange={e=>setDraft(d=>({...d,title:e.target.value}))}/></label>
          <label>Modo<select value={draft.mode} onChange={e=>setDraft(d=>({...d,mode:e.target.value as Fields['mode']}))}><option value="new">Criar frontend</option><option value="remodel">Remodelar frontend existente</option></select></label>
          <label>Estilo / motor visual<select value={draft.sourceId} onChange={e=>setDraft(d=>({...d,sourceId:e.target.value}))}>{sources.filter(s=>s.kind!=='reference').map(s=><option key={s.id} value={s.id}>{s.style} — {s.name}</option>)}</select></label>
          <label>Tema<select value={draft.theme} onChange={e=>setDraft(d=>({...d,theme:e.target.value as Fields['theme']}))}><option value="system">Automático</option><option value="light">Claro</option><option value="dark">Escuro</option></select></label>
          <button type="submit" disabled={!source||!draft.title.trim()||saving}>{saving?'Salvando…':'Salvar perfil'}</button>
        </fieldset>
        {notice&&<p role="status">{notice}</p>}
      </form>
      <section className="design-studio-panel" aria-label="Fonte oficial">
        <h3>Fonte e implementação</h3>
        {source?<><h4>{source.name}</h4><p>{source.style}</p><p>Adaptador de renderização ainda não instalado. Não há prévia local deste motor nesta etapa.</p>
          <p><a href={source.url} target="_blank" rel="noreferrer">Abrir exemplos oficiais</a> · <a href={source.docs} target="_blank" rel="noreferrer">Documentação</a></p>
          <h4>Requisitos</h4><p>{source.requirements.join(' · ')}</p>
          {source.install&&<><h4>Comando oficial de instalação</h4><code className="design-studio-command">{source.install}</code></>}
          {related.length>0&&<><h4>Fontes complementares</h4>{related.map(s=><p key={s.id}><a href={s.url} target="_blank" rel="noreferrer">{s.name}</a> — {s.kind==='reference'?'referência visual':'biblioteca complementar'}</p>)}</>}
          {draft.mode==='remodel'&&<p>A conexão ao repositório e o diagnóstico de compatibilidade serão habilitados na integração Git.</p>}
        </>:<p>Catálogo indisponível.</p>}
      </section>
    </div>}
  </section>;
}
