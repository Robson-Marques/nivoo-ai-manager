import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
type Project={id:string;name:string;gitUrl?:string|null;gitBranch?:string|null};
type Scope={count:number;examples:string[]};
type Analysis={project:{id:string;name:string;url:string|null;branch:string|null};commit:string;analyzedAt:string;trackedFiles:number;technologies:{name:string;evidence:string[]}[];frontend:Scope;pages:Scope;components:Scope;styles:Scope;configs:Scope;locks:Scope;manifestCoverage:{total:number;read:number;omitted:number;unreadable:string[]};limitations:string[]};
export function DesignTarget({projects,projectId,onChange,onImport,disabled}:{projects:Project[]|null;projectId:string|null;onChange:(id:string|null)=>void;onImport:()=>void;disabled:boolean}){
  const [analysis,setAnalysis]=useState<Analysis|null>(null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const ticket=useRef(0);
  useEffect(()=>{ticket.current++;setAnalysis(null);setError('');setBusy(false);return()=>{ticket.current++}},[projectId]);
  const p=projects?.find(x=>x.id===projectId);
  const run=async()=>{if(!projectId)return;const request=++ticket.current;setBusy(true);setAnalysis(null);setError('');try{const data=await api<Analysis>('/design-studio/projects/'+projectId+'/analysis');if(request===ticket.current)setAnalysis(data);}catch(e){if(request===ticket.current)setError(e instanceof Error?e.message:String(e));}finally{if(request===ticket.current)setBusy(false);}};
  return <section className="design-target">
    <h3>Software de destino</h3>
    <label>Projeto do Nivoo<select disabled={disabled||projects===null} value={projectId??''} onChange={e=>onChange(e.target.value||null)}>
      <option value="">{projects===null?'Carregando projetos…':'Selecione um projeto'}</option>
      {projectId&&!p&&<option value={projectId}>Projeto não disponível na lista</option>}
      {projects?.map(x=><option key={x.id} value={x.id}>{x.name}{x.gitBranch?' · '+x.gitBranch:''}</option>)}
    </select></label>
    <button type="button" className="secondary" onClick={onImport} disabled={disabled}>Importar com o Novo projeto existente</button>
    {p&&<><p>{p.gitUrl??'Projeto local, sem repositório remoto'}{p.gitBranch?' · branch remota '+p.gitBranch:''}</p><Link to={'/p/'+p.id}>Abrir projeto e configurações Git</Link>
    <button type="button" className="secondary" disabled={disabled||busy} onClick={()=>void run()}>{busy?'Analisando commit local…':'Analisar frontend existente'}</button></>}
    {error&&<p role="alert" className="error">{error}</p>}
    {analysis&&analysis.project.id===projectId&&<div className="design-analysis">
      <h4>Inventário do frontend</h4><p>Commit local: <code>{analysis.commit.slice(0,12)}</code> · {analysis.trackedFiles} arquivos analisáveis</p>
      <p>Manifestos lidos: {analysis.manifestCoverage.read}/{analysis.manifestCoverage.total}{analysis.manifestCoverage.omitted?' · '+analysis.manifestCoverage.omitted+' omitidos por limite':''}</p>
      {analysis.manifestCoverage.unreadable.length>0&&<p>Manifestos não lidos: {analysis.manifestCoverage.unreadable.join(', ')}</p>}
      <details open><summary>Tecnologias detectadas ({analysis.technologies.length})</summary>{analysis.technologies.length?analysis.technologies.map(t=><div key={t.name}><strong>{t.name}</strong><small>{t.evidence.join(' · ')}</small></div>):<p>Nenhum framework identificado.</p>}</details>
      {([['Arquivos de interface',analysis.frontend],['Páginas candidatas',analysis.pages],['Componentes',analysis.components],['Estilos',analysis.styles],['Configurações',analysis.configs],['Lockfiles',analysis.locks]] as [string,Scope][]).map(([title,s])=><details key={title}><summary>{title} ({s.count})</summary>{s.examples.map(x=><small key={x}>{x}</small>)}{s.count>s.examples.length&&<small>Exibindo {s.examples.length} de {s.count}.</small>}</details>)}
      {analysis.limitations.map(x=><small key={x}>{x}</small>)}
    </div>}
  </section>;
}
