import { useEffect,useRef,useState,type CSSProperties } from 'react';
import { api } from '../api';
import { buildVisualSelection,DELEGATE,delegatedChoices,emptyChoices,type Catalog,type Choices,type VisualProfile,type VisualQuestion,type Style,type Palette,type Font } from './visual-selection';
import './VisualSelector.css';

type Props={questions:VisualQuestion[];onConfirm:(profile:VisualProfile)=>Promise<void>;onFree?: (text:string)=>Promise<void>};

function fontPreview(font?:Font):{stack:string;label:string}{
  if(!font)return {stack:'system-ui, sans-serif',label:'Fonte de sistema (amostra)'};
  if(font.availability==='system')return {stack:font.stack,label:font.name+' (fonte do sistema)'};
  // No font download and no claim that a local installation exists.
  const fallback=font.stack.split(',').slice(1).join(',').trim()||'system-ui, sans-serif';
  return {stack:fallback,label:font.name+' — amostra em fallback; fonte original não incorporada'};
}
function Preview({style,palette,dark,mobile,density,heading,body,catalog,mini=false}:{style:Style;palette:Palette;dark:boolean;mobile?:boolean;density?:string;heading?:Font;body?:Font;catalog:Catalog;mini?:boolean}){
  const colors=dark?palette.dark:palette.light;
  const f=catalog.foundations.find(x=>x.styleId===style.id);
  const d=catalog.densities.find(x=>x.id===density);
  const vars={
    '--vs-bg':colors.background,'--vs-surface':colors.surface,'--vs-raised':colors.surfaceRaised,'--vs-text':colors.text,'--vs-muted':colors.muted,'--vs-border':colors.border,'--vs-accent':colors.accent,'--vs-on-accent':colors.onAccent,'--vs-success':colors.success,
    '--vs-radius':(f?.radius.panel??10)+'px','--vs-control-radius':(f?.radius.control??6)+'px','--vs-shadow':f?.shadow.panel??'none',
    '--vs-gap':Math.max(4,d?.spacing.sm??8)+'px','--vs-heading':fontPreview(heading).stack,'--vs-body':fontPreview(body).stack,
  } as CSSProperties;
  return <div className={'nv-vs-preview'+(mobile?' nv-vs-mobile':'')+(mini?' nv-vs-mini':'')} data-style={style.id} data-mode={dark?'dark':'light'} style={vars} aria-hidden={mini?true:undefined}>
    <div className="nv-vs-preview-nav"><strong>Workspace</strong><span>Visão geral</span><span className="nv-vs-dot"/></div>
    <div className="nv-vs-preview-content">
      <div className="nv-vs-preview-sidebar"><span>Resumo</span><span>Clientes</span><span>Relatórios</span></div>
      <div className="nv-vs-preview-main">
        <div className="nv-vs-preview-title"><strong>Visão geral</strong><span className="nv-vs-preview-action">+ Novo</span></div>
        <div className="nv-vs-preview-stats"><div><span>Clientes</span><strong>24</strong></div><div><span>Ativos</span><strong>18</strong></div></div>
        <div className="nv-vs-preview-table"><strong>Clientes recentes</strong><div><span>Cliente A</span><span className="nv-vs-preview-status">Ativo</span></div><div><span>Cliente B</span><span className="nv-vs-preview-status">Ativo</span></div></div>
      </div>
    </div>
  </div>;
}

export function VisualSelector({questions,onConfirm,onFree}:Props){
  const [catalog,setCatalog]=useState<Catalog|null>(null);
  const [choices,setChoices]=useState<Choices>({...emptyChoices});
  const [dark,setDark]=useState(false);
  const [device,setDevice]=useState<'desktop'|'mobile'>('desktop');
  const [erro,setErro]=useState('');
  const [loading,setLoading]=useState(true);
  const [retry,setRetry]=useState(0);
  const [saving,setSaving]=useState(false);
  const [free,setFree]=useState('');
  const sending=useRef(false);
  useEffect(()=>{
    let live=true;
    setLoading(true);setErro('');
    Promise.all([
      api<{version:number;styles:Catalog['styles']}>('/projects/visual-styles'),
      api<{version:number;fonts:Catalog['fonts'];pairings:Catalog['pairings']}>('/projects/visual-typography'),
      api<{version:number;palettes:Catalog['palettes'];densities:Catalog['densities'];foundations:Catalog['foundations']}>('/projects/visual-tokens'),
    ]).then(([s,f,t])=>{
      if(!live)return;
      if(s.version!==1||f.version!==1||t.version!==1||!s.styles.length||!t.palettes.length)throw Error('Catálogo visual incompatível. Atualize a página.');
      setCatalog({styles:s.styles,fonts:f.fonts,pairings:f.pairings,palettes:t.palettes,densities:t.densities,foundations:t.foundations});
    }).catch(e=>{if(live)setErro(e instanceof Error?e.message:'Não foi possível carregar o catálogo visual.');}).finally(()=>{if(live)setLoading(false);});
    return ()=>{live=false;};
  },[retry]);
  const choose=(key:keyof Choices,id:string)=>setChoices(c=>({...c,[key]:id}));
  const send=async(profile:VisualProfile)=>{
    if(sending.current)return;
    sending.current=true;setSaving(true);setErro('');
    try{await onConfirm(profile);}catch(e){setErro(e instanceof Error?e.message:'Não foi possível confirmar.');}
    finally{sending.current=false;setSaving(false);}
  };
  const sendFree=async()=>{
    if(!onFree||!free.trim()||sending.current)return;
    sending.current=true;setSaving(true);setErro('');
    try{await onFree(free.trim());}catch(e){setErro(e instanceof Error?e.message:'Não foi possível enviar.');}
    finally{sending.current=false;setSaving(false);}
  };
  if(!catalog)return <section className="nv-visual-selector" aria-label="Identidade visual"><p role="status">{loading?'Carregando catálogo visual…':erro}</p>{!loading&&<button type="button" className="secondary" onClick={()=>setRetry(v=>v+1)}>Tentar novamente</button>}<button type="button" disabled={saving} onClick={()=>send({schemaVersion:1,mode:'delegated'})}>Delegar tudo à IA</button></section>;
  const profile=buildVisualSelection(choices,questions,catalog);
  const style=catalog.styles.find(s=>s.id===choices.style)??catalog.styles.find(s=>s.id==='corporate')??catalog.styles[0];
  const palette=catalog.palettes.find(p=>p.id===choices.palette)??catalog.palettes.find(p=>p.id==='ocean-blue')??catalog.palettes[0];
  const pairing=catalog.pairings.find(p=>p.id===choices.typography);
  const heading=catalog.fonts.find(f=>f.id===pairing?.fonts.heading);
  const body=catalog.fonts.find(f=>f.id===pairing?.fonts.body);
  const previewDark=choices.theme==='dark'||(choices.theme!=='light'&&dark);
  const previewMobile=choices.usage==='mobile'||(choices.usage!=='desktop'&&device==='mobile');
  return <section className="nv-visual-selector" aria-label="Identidade visual do software">
    <div className="nv-vs-header"><h3>Defina o visual do seu software</h3><p>Escolha as preferências ou delegue à IA. A prévia é ilustrativa, não é o software final.</p><button type="button" className="secondary" disabled={saving} onClick={()=>setChoices({...delegatedChoices})}>Delegar todas as escolhas</button></div>
    {questions.map(q=><fieldset key={q.id} disabled={saving}><legend>{q.pergunta}</legend><div className={'nv-vs-options'+(q.id==='style'?' nv-vs-styles':'')}>
      {q.opcoes.map(o=>{
        const s=q.id==='style'?catalog.styles.find(x=>x.id===o.id):undefined;
        const pair=q.id==='typography'?catalog.pairings.find(x=>x.id===o.id):undefined;
        const sample=fontPreview(catalog.fonts.find(x=>x.id===pair?.fonts.heading));
        return <label key={o.id} className={'nv-vs-option'+(choices[q.id as keyof Choices]===o.id?' nv-vs-selected':'')}>
          <input type="radio" name={'visual-'+q.id} checked={choices[q.id as keyof Choices]===o.id} onChange={()=>choose(q.id as keyof Choices,o.id)}/>
          {s&&<Preview mini style={s} palette={palette} dark={choices.theme==='dark'||(choices.theme!=='light'&&s.preferredTheme==='dark')} catalog={catalog}/>}
          {pair&&<div className="nv-vs-type-sample" style={{fontFamily:sample.stack}}>Aa · Visão geral</div>}
          <strong>{o.rotulo}</strong><small>{o.descricao}</small>{pair&&<small>{sample.label}</small>}
        </label>;
      })}
    </div></fieldset>)}
    <fieldset disabled={saving}><legend>Paleta de cores</legend><div className="nv-vs-options">
      {catalog.palettes.map(p=><label key={p.id} className={'nv-vs-option'+(choices.palette===p.id?' nv-vs-selected':'')}><input type="radio" name="visual-palette" checked={choices.palette===p.id} onChange={()=>choose('palette',p.id)}/><div className="nv-vs-swatches" aria-hidden="true">{[p.light.accent,p.dark.accent,p.light.background,p.dark.surface].map((c,i)=><span key={i} style={{background:c}}/>)}</div><strong>{p.name}</strong></label>)}
      <label className="nv-vs-option"><input type="radio" name="visual-palette" checked={choices.palette===DELEGATE} onChange={()=>choose('palette',DELEGATE)}/>IA escolhe</label>
    </div></fieldset>
    <fieldset disabled={saving}><legend>Densidade das informações</legend><div className="nv-vs-options">
      {catalog.densities.map(d=><label key={d.id} className={'nv-vs-option'+(choices.density===d.id?' nv-vs-selected':'')}><input type="radio" name="visual-density" checked={choices.density===d.id} onChange={()=>choose('density',d.id)}/><strong>{d.name}</strong><small>Controle de referência: {d.controlMinHeight}px</small></label>)}
      <label className="nv-vs-option"><input type="radio" name="visual-density" checked={choices.density===DELEGATE} onChange={()=>choose('density',DELEGATE)}/>IA escolhe</label>
    </div></fieldset>
    <div className="nv-vs-live"><h4>Prévia da combinação</h4><div className="nv-vs-toolbar">
      <button type="button" className="secondary" aria-pressed={previewDark} disabled={choices.theme==='light'||choices.theme==='dark'} onClick={()=>setDark(v=>!v)}>{previewDark?'Escuro':'Claro'}</button>
      <button type="button" className="secondary" aria-pressed={previewMobile} disabled={choices.usage==='desktop'||choices.usage==='mobile'} onClick={()=>setDevice(v=>v==='desktop'?'mobile':'desktop')}>{previewMobile?'Celular':'Computador'}</button>
    </div><Preview style={style} palette={palette} dark={previewDark} mobile={previewMobile} density={choices.density} heading={heading} body={body} catalog={catalog}/>
    <small>{fontPreview(heading).label}. {fontPreview(body).label}. Dados fictícios. Valores de amostra para escolhas ainda não definidas não serão gravados.</small></div>
    {erro&&<p role="alert" className="nv-vs-error">{erro}</p>}
    <button type="button" disabled={!profile||saving} onClick={()=>profile&&send(profile)}>{saving?'Confirmando…':'Confirmar identidade e continuar'}</button>
    {!profile&&<small>Escolha ou delegue as quatro preferências principais.</small>}
    {onFree&&<details><summary>Prefiro explicar com minhas palavras</summary><label>Briefing visual (não grava um perfil automaticamente)<textarea value={free} onChange={e=>setFree(e.target.value)} disabled={saving} rows={3}/></label><button type="button" className="secondary" disabled={!free.trim()||saving} onClick={sendFree}>Enviar briefing</button></details>}
  </section>;
}
