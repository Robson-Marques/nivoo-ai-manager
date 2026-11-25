import { useEffect, useState } from 'react';
import { useNavigate,Link } from 'react-router-dom';
import { api } from '../api';
import type { Analysis } from './DesignTarget';

export function RemodelRequest({profileId,revision,analysis,ready,dirty,mode}:{profileId:string|null;revision:number|null;analysis:Analysis|null;ready:boolean;dirty:boolean;mode:'new'|'remodel'}){
  const [kind,setKind]=useState<'all'|'selected'>('all');
  const [paths,setPaths]=useState<string[]>([]);
  const [notes,setNotes]=useState('');
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const nav=useNavigate();
  const creating=mode==='new';
  useEffect(()=>{setPaths([]);setError('')},[analysis?.commit,analysis?.project.id]);
  const available=analysis?[...new Set([...analysis.frontend.examples,...analysis.pages.examples,...analysis.components.examples,...analysis.styles.examples])].sort():[];
  const prepare=async()=>{
    if(!profileId||!analysis||!ready||dirty||busy)return;
    setBusy(true);setError('');
    try{
      const r=await api<{projectId:string;conversationId:string}>('/design-studio/profiles/'+profileId+'/design-plan','POST',{revision,commit:analysis.commit,scope:{kind:creating?'all':kind,paths:creating?[]:paths,notes}});
      nav('/p/'+r.projectId+'/c/'+r.conversationId);
    }catch(e){setError(e instanceof Error?e.message:String(e));}finally{setBusy(false);}
  };
  const can=!!profileId&&!!analysis&&ready&&!dirty&&!busy&&(creating?!!notes.trim():(kind==='all'||paths.length>0));
  return <section className="design-target">
    <h3>{creating?'Criar frontend':'Aplicar remodelagem'}</h3>
    {!creating&&<label>Escopo<select value={kind} disabled={busy} onChange={e=>setKind(e.target.value as typeof kind)}><option value="all">Frontend inteiro</option><option value="selected">Páginas e componentes selecionados</option></select></label>}
    {!creating&&kind==='selected'&&<label>Arquivos de interface<select multiple size={6} disabled={busy||!analysis} value={paths} onChange={e=>setPaths(Array.from(e.target.selectedOptions,o=>o.value))}>{available.map(p=><option key={p} value={p}>{p}</option>)}</select><small>{paths.length} selecionados · até 80 por trabalho</small></label>}
    <label>{creating?'Descreva o frontend e os fluxos necessários':'Detalhes opcionais'}<textarea rows={3} maxLength={2000} value={notes} disabled={busy} onChange={e=>setNotes(e.target.value)} placeholder={creating?'Ex.: portal de clientes com login, faturas e atendimento.':'Ex.: priorizar dashboard e menu; manter fluxo de cadastro.'}/></label>
    {!ready&&<p>Selecione um motor com prévia local disponível.</p>}
    {(!profileId||dirty)&&<p>Salve o perfil com o design escolhido antes de preparar o plano.</p>}
    {!analysis&&<p>Analise o frontend do projeto de destino antes de continuar.</p>}
    {analysis&&<p>Base analisada: <code>{analysis.commit.slice(0,12)}</code>. <Link to={'/p/'+analysis.project.id}>Abrir prévia e trabalho no projeto</Link></p>}
    {error&&<p role="alert" className="error">{error}</p>}
    <button type="button" disabled={!can||(!creating&&paths.length>80)} onClick={()=>void prepare()}>{busy?'Preparando…':creating?'Preparar criação do frontend':'Preparar trabalho de remodelagem'}</button>
    <small>O plano será aberto na conversa do projeto. O botão Fazer existente inicia a execução. A publicação segue as configurações Git já existentes.</small>
  </section>;
}
