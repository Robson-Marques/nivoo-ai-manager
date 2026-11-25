import { useEffect,useRef,useState,type CSSProperties,type ReactNode } from 'react';
import { api } from '../api';
import { buildVisualSelection,DELEGATE,delegatedChoices,emptyChoices,type Catalog,type Choices,type VisualProfile,type VisualQuestion,type Style,type Palette,type Font,type GlassVariant } from './visual-selection';
import './VisualSelector.css';
import { NivooGlassRoot,NivooGlassSurface,NivooGlassBackdrop } from '../vendor/liqui/nivoo';
import './VisualFonts.css';
import { LOCAL_FONTS,loadVisualFont,type FontStates } from './visual-fonts';

type Props={questions:VisualQuestion[];onConfirm:(profile:VisualProfile)=>Promise<void>;onFree?: (text:string)=>Promise<void>};

function fontPreview(font:Font|undefined,states:FontStates):{stack:string;label:string}{
  if(!font)return {stack:'system-ui, sans-serif',label:'Fonte do sistema'};
  if(font.availability==='system')return {stack:font.stack,label:font.name+' (sistema)'};
  const state=states[font.id]??'loading';
  return {stack:font.stack,label:font.name+(state==='ready'?' · original local':state==='failed'?' · falha ao carregar':' · carregando')};
}
type PreviewScreen='dashboard'|'clients'|'form';
type SelectOption={id:string;label:string;description?:string};
function ChoiceField({label,value,options,onChange,children}:{label:string;value:string;options:SelectOption[];onChange:(id:string)=>void;children?:ReactNode}){
  const selected=options.find(o=>o.id===value);
  return <div className="nv-vs-field"><label><strong>{label}</strong><select value={value} onChange={e=>onChange(e.target.value)}><option value="" disabled>Selecione…</option>{options.map(o=><option key={o.id} value={o.id}>{o.label}</option>)}</select></label>{selected?.description&&<small>{selected.description}</small>}{children}</div>;
}
const CLIENTS=[
  {id:'CLI-0024',name:'Mariana Costa',email:'mariana@example.test',status:'Ativo',date:'24/11/2026'},
  {id:'CLI-0023',name:'Rafael Lima',email:'rafael@example.test',status:'Ativo',date:'23/11/2026'},
  {id:'CLI-0022',name:'Beatriz Alves',email:'beatriz@example.test',status:'Pendente',date:'22/11/2026'},
  {id:'CLI-0021',name:'Lucas Ribeiro',email:'lucas@example.test',status:'Inativo',date:'20/11/2026'},
] as const;
const SCREENS:readonly {id:PreviewScreen;label:string}[]=[{id:'dashboard',label:'Visão geral'},{id:'clients',label:'Clientes'},{id:'form',label:'Formulário'}];
function SampleSurface({glass,kind,children}:{glass:boolean;kind:'nav'|'side'|'metric'|'chart'|'data'|'form'|'dock';children:ReactNode}){
  const content='nv-vs-surface-content nv-vs-demo-'+kind;
  if(!glass)return <div className="nv-vs-surface nv-vs-demo-plain"><div className={content}>{children}</div></div>;
  const small=kind==='nav'||kind==='dock'||kind==='metric';
  return <NivooGlassSurface className="nv-vs-surface" radius={small?20:18} refraction={small?75:110} bezel={small?15:21} blur={2} contentClassName={content}>{children}</NivooGlassSurface>;
}
function SampleStatus({status}:{status:string}){
  return <span className="nv-vs-sample-status" data-status={status}>{status}</span>;
}
function Preview({style,palette,dark,mobile,density,heading,body,mono,catalog,variant,fontStates,screen}:{style:Style;variant?:GlassVariant;fontStates:FontStates;palette:Palette;dark:boolean;mobile:boolean;density?:string;heading?:Font;body?:Font;mono?:Font;catalog:Catalog;screen:PreviewScreen}){
  const colors=dark?palette.dark:palette.light;
  const glass=style.id==='liquid-glass';
  const material=glass?(variant??catalog.glassVariants.find(v=>v.id==='frosted-glass')):undefined;
  const f=catalog.foundations.find(x=>x.styleId===style.id);
  const d=catalog.densities.find(x=>x.id===density);
  const vars={
    '--vs-bg':colors.background,'--vs-surface':colors.surface,'--vs-raised':colors.surfaceRaised,'--vs-text':colors.text,'--vs-muted':colors.muted,'--vs-border':colors.border,'--vs-accent':colors.accent,'--vs-on-accent':colors.onAccent,'--vs-success':colors.success,
    '--vs-radius':(f?.radius.panel??10)+'px','--vs-control-radius':(f?.radius.control??6)+'px','--vs-shadow':f?.shadow.panel??'none',
    '--vs-gap':Math.max(4,d?.spacing.sm??8)+'px','--vs-control-h':(d?.controlMinHeight??40)+'px','--vs-heading':fontPreview(heading,fontStates).stack,'--vs-body':fontPreview(body,fontStates).stack,'--vs-mono':fontPreview(mono,fontStates).stack,
    '--nv-liqui-solid':colors.surface,'--nv-liqui-text':colors.text,
  } as CSSProperties;
  const variantId=material?.id??'frosted-glass';
  const className='nv-vs-preview nv-vs-sample'+(glass?' nv-vs-optical':'')+(mobile?' nv-vs-mobile':' nv-vs-desktop');
  const navItems=[{id:'dashboard',label:'Resumo',glyph:'◈'},{id:'clients',label:'Clientes',glyph:'◎'},{id:'reports',label:'Relatórios',glyph:'▥'}];
  const navLinks=navItems.map(item=><span key={item.id} className={(screen===item.id||(screen==='form'&&item.id==='clients'))?'nv-vs-active':undefined}><span aria-hidden="true">{item.glyph}</span> {item.label}</span>);
  const title=screen==='dashboard'?'Visão geral':screen==='clients'?'Clientes':'Novo cliente';
  const sampleData=<div className="nv-vs-demo-data-inner"><div className="nv-vs-data-toolbar"><span className="nv-vs-faux-input">⌕ Buscar cliente</span><span className="nv-vs-faux-input">Todos os status ▾</span></div><div className="nv-vs-table-scroll"><table><thead><tr><th scope="col">Cliente</th><th scope="col">Status</th>{screen==='clients'&&<><th scope="col">Cadastro</th><th scope="col">Ações</th></>}</tr></thead><tbody>{CLIENTS.slice(0,screen==='dashboard'?3:4).map(client=><tr key={client.id}><td><strong>{client.name}</strong><small className="nv-vs-client-id">{client.id}</small>{screen==='clients'&&<small>{client.email}</small>}</td><td><SampleStatus status={client.status}/></td>{screen==='clients'&&<><td>{client.date}</td><td>Editar · ⋯</td></>}</tr>)}</tbody></table></div>{screen==='clients'&&<small>Mostrando 4 de 24 clientes · Página 1 de 6</small>}</div>;
  const children=<>
    <SampleSurface glass={glass} kind="nav"><span className="nv-vs-brand"><i>N</i><strong>Workspace</strong></span><span className="nv-vs-online"><span className="nv-vs-dot"/> Online</span><span className="nv-vs-avatar">JD</span></SampleSurface>
    <div className="nv-vs-app-layout">
      <div className="nv-vs-sample-sidebar"><SampleSurface glass={glass} kind="side">{navLinks}<span>⚙ Ajustes</span></SampleSurface></div>
      <div className="nv-vs-app-main">
        <div className="nv-vs-preview-title"><div><small>GESTÃO DE CLIENTES</small><strong>{title}</strong></div><span className="nv-vs-preview-action">{screen==='form'?'Salvar':'+ Novo'}</span></div>
        {screen==='dashboard'&&<>
          <div className="nv-vs-preview-stats nv-vs-demo-stats">{[{title:'Clientes',value:'24',detail:'+4 neste mês'},{title:'Ativos',value:'18',detail:'75% da base'},{title:'Pendentes',value:'4',detail:'Aguardando ação'},{title:'Inativos',value:'2',detail:'8% da base'}].map(stat=><SampleSurface key={stat.title} glass={glass} kind="metric"><span>{stat.title}</span><strong>{stat.value}</strong><small>{stat.detail}</small></SampleSurface>)}</div>
          <SampleSurface glass={glass} kind="chart"><div className="nv-vs-chart-head"><strong>Novos clientes</strong><small>Últimos 7 dias</small></div><div className="nv-vs-bars" aria-hidden="true">{[30,56,42,78,61,90,72].map((n,i)=><i key={i} style={{height:n+'%'}}/>)}</div><div className="nv-vs-chart-days" aria-hidden="true">{['Q','Q','S','S','D','S','T'].map((day,i)=><span key={i}>{day}</span>)}</div></SampleSurface>
        </>}
        {screen!=='form'&&<SampleSurface glass={glass} kind="data"><strong>{screen==='dashboard'?'Clientes recentes':'Lista de clientes'}</strong>{sampleData}</SampleSurface>}
        {screen==='form'&&<SampleSurface glass={glass} kind="form"><strong>Informações cadastrais</strong><div className="nv-vs-demo-data-inner nv-vs-sample-form"><div><small>Nome completo</small><span className="nv-vs-faux-input">Mariana Costa</span></div><div><small>E-mail</small><span className="nv-vs-faux-input">mariana@example.test</span></div><div><small>Telefone</small><span className="nv-vs-faux-input">(00) 90000-0000</span></div><div><small>Status</small><span className="nv-vs-faux-input">Ativo ▾</span></div><div><small>Observações</small><span className="nv-vs-faux-input">Preferência de contato: e-mail</span></div><div className="nv-vs-form-actions"><span className="nv-vs-faux-input">Cancelar</span><span className="nv-vs-preview-action">Salvar cliente</span></div></div></SampleSurface>}
      </div>
    </div>
    <div className="nv-vs-sample-dock"><SampleSurface glass={glass} kind="dock">{navLinks}</SampleSurface></div>
  </>;
  if(glass){
    // Only the original optical engine draws the lens. This background supplies
    // visible edges to refract and is not an imitation of an optical surface.
    const backdrop=<NivooGlassBackdrop dark={dark}/>;
    return <NivooGlassRoot variant={variantId} dark={dark} accent={colors.accent} textColor={colors.text} mutedColor={colors.muted} backdrop={backdrop} className={className} style={vars} aria-label="Demonstração visual com dados fictícios">{children}</NivooGlassRoot>;
  }
  return <div className={className} data-style={style.id} data-mode={dark?'dark':'light'} style={vars} aria-label="Demonstração visual com dados fictícios">{children}</div>;
}

export function VisualSelector({questions,onConfirm,onFree}:Props){
  const [catalog,setCatalog]=useState<Catalog|null>(null);
  const [fontStates,setFontStates]=useState<FontStates>({});
  useEffect(()=>{let live=true;for(const font of LOCAL_FONTS)void loadVisualFont(font).then(state=>{if(live)setFontStates(s=>({...s,[font.id]:state}));});return ()=>{live=false;};},[]);
  const [choices,setChoices]=useState<Choices>({...emptyChoices});
  const [dark,setDark]=useState(false);
  const [device,setDevice]=useState<'desktop'|'mobile'>(()=>typeof window!=='undefined'&&window.matchMedia('(max-width:600px)').matches?'mobile':'desktop');
  const [screen,setScreen]=useState<PreviewScreen>('dashboard');
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
      api<{version:number;styles:Catalog['styles'];glassVariants:Catalog['glassVariants']}>('/projects/visual-styles'),
      api<{version:number;fonts:Catalog['fonts'];pairings:Catalog['pairings']}>('/projects/visual-typography'),
      api<{version:number;palettes:Catalog['palettes'];densities:Catalog['densities'];foundations:Catalog['foundations']}>('/projects/visual-tokens'),
    ]).then(([s,f,t])=>{
      if(!live)return;
      if(s.version!==1||f.version!==1||t.version!==1||!s.styles.length||!Array.isArray(s.glassVariants)||!s.glassVariants.length||!t.palettes.length)throw Error('Catálogo visual incompatível. Atualize a página.');
      setCatalog({styles:s.styles,glassVariants:s.glassVariants,fonts:f.fonts,pairings:f.pairings,palettes:t.palettes,densities:t.densities,foundations:t.foundations});
    }).catch(e=>{if(live)setErro(e instanceof Error?e.message:'Não foi possível carregar o catálogo visual.');}).finally(()=>{if(live)setLoading(false);});
    return ()=>{live=false;};
  },[retry]);
  const choose=(key:keyof Choices,id:string)=>{setChoices(c=>({...c,[key]:id,...(key==='style'&&id!=='liquid-glass'?{glassVariant:DELEGATE}:{})}));if(key==='style')setDark(catalog?.styles.find(s=>s.id===id)?.preferredTheme==='dark');};
  const chooseGlass=(id:string)=>{setChoices(c=>({...c,style:'liquid-glass',glassVariant:id}));setDark(id==='dark-glass');};
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
  const missingFonts=profile?.fonts?Object.values(profile.fonts).filter(id=>id&&LOCAL_FONTS.some(f=>f.id===id)&&fontStates[id]!=='ready'):[];
  const style=catalog.styles.find(s=>s.id===choices.style)??catalog.styles.find(s=>s.id==='corporate')??catalog.styles[0];
  const palette=catalog.palettes.find(p=>p.id===choices.palette)??catalog.palettes.find(p=>p.id==='ocean-blue')??catalog.palettes[0];
  const variant=catalog.glassVariants.find(v=>v.id===choices.glassVariant);
  const pairing=catalog.pairings.find(p=>p.id===choices.typography);
  const heading=catalog.fonts.find(f=>f.id===pairing?.fonts.heading);
  const body=catalog.fonts.find(f=>f.id===pairing?.fonts.body);
  const mono=catalog.fonts.find(f=>f.id===pairing?.fonts.mono);
  const previewDark=choices.theme==='dark'||(choices.theme!=='light'&&dark);
  const previewMobile=choices.usage==='mobile'||(choices.usage!=='desktop'&&device==='mobile');
  return <section className="nv-visual-selector" aria-label="Identidade visual do software">
    <div className="nv-vs-header"><h3>Identidade visual</h3><p>Escolha as preferências e compare o resultado em uma única prévia. Nenhuma escolha será gravada antes da confirmação.</p><button type="button" className="secondary" disabled={saving} onClick={()=>setChoices({...delegatedChoices})}>Delegar tudo à IA</button></div>
    <fieldset className="nv-vs-config" disabled={saving} aria-label="Preferências visuais">
      {questions.map(q=><div key={q.id} className="nv-vs-question">
        <ChoiceField label={({style:'Estilo visual',usage:'Dispositivo',typography:'Tipografia',theme:'Tema'} as Record<string,string>)[q.id]??q.pergunta} value={choices[q.id as keyof Choices]} options={q.opcoes.map(o=>({id:o.id,label:o.rotulo,description:o.descricao}))} onChange={id=>choose(q.id as keyof Choices,id)}/>
        {q.id==='style'&&choices.style==='liquid-glass'&&<ChoiceField label="Material Liquid Glass" value={choices.glassVariant} options={[...catalog.glassVariants.map(v=>({id:v.id,label:v.name,description:v.description})),{id:DELEGATE,label:'IA escolhe'}]} onChange={chooseGlass}/>}
      </div>)}
      <ChoiceField label="Paleta de cores" value={choices.palette} options={[...catalog.palettes.map(p=>({id:p.id,label:p.name})),{id:DELEGATE,label:'IA escolhe'}]} onChange={id=>choose('palette',id)}><div className="nv-vs-swatches" aria-label="Cores da prévia">{[palette.light.accent,palette.dark.accent,palette.light.background,palette.dark.surface].map((color,i)=><span key={i} style={{background:color}}/>)}</div></ChoiceField>
      <ChoiceField label="Densidade" value={choices.density} options={[...catalog.densities.map(d=>({id:d.id,label:d.name,description:'Controles: '+d.controlMinHeight+'px'})),{id:DELEGATE,label:'IA escolhe'}]} onChange={id=>choose('density',id)}/>
    </fieldset>
    <div className="nv-vs-live"><div className="nv-vs-live-heading"><h4>Prévia da combinação</h4><small>{style.name}{style.id==='liquid-glass'?' · '+(variant?.name??'Frosted Glass (amostra)'):''}</small></div>
      <div className="nv-vs-toolbar">
        <label className="nv-vs-screen-select">Tela de exemplo<select value={screen} onChange={e=>setScreen(e.target.value as PreviewScreen)}>{SCREENS.map(s=><option key={s.id} value={s.id}>{s.label}</option>)}</select></label>
        <button type="button" className="secondary" aria-pressed={previewDark} disabled={choices.theme==='light'||choices.theme==='dark'} onClick={()=>setDark(v=>!v)}>{previewDark?'Escuro':'Claro'}</button>
        <button type="button" className="secondary" aria-pressed={previewMobile} disabled={choices.usage==='desktop'||choices.usage==='mobile'} onClick={()=>setDevice(v=>v==='desktop'?'mobile':'desktop')}>{previewMobile?'Celular':'Computador'}</button>
      </div>
      <Preview fontStates={fontStates} style={style} variant={variant} palette={palette} dark={previewDark} mobile={previewMobile} density={choices.density} heading={heading} body={body} mono={mono} catalog={catalog} screen={screen}/>
      {pairing&&<small>Tipografia: {[...new Set([fontPreview(heading,fontStates).label,fontPreview(body,fontStates).label,fontPreview(mono,fontStates).label])].join(' · ')}</small>}
      <small>Dados fictícios. Campos delegados usam amostras apenas para a prévia; não serão gravados.{style.id==='liquid-glass'?' Motor original Liqui Design; refração conforme suporte do navegador.':''}</small>
    </div>
    {erro&&<p role="alert" className="nv-vs-error">{erro}</p>}
    <button type="button" disabled={!profile||saving||missingFonts.length>0} onClick={()=>profile&&!missingFonts.length&&send(profile)}>{saving?'Confirmando…':'Confirmar identidade e continuar'}</button>
    {missingFonts.length>0&&<small role="status">As fontes originais escolhidas ainda não carregaram. Recarregue se necessário ou escolha outra combinação.</small>}
    {!profile&&<small>Escolha ou delegue as quatro preferências principais.</small>}
    {onFree&&<details><summary>Prefiro explicar com minhas palavras</summary><label>Briefing visual (não grava um perfil automaticamente)<textarea value={free} onChange={e=>setFree(e.target.value)} disabled={saving} rows={3}/></label><button type="button" className="secondary" disabled={!free.trim()||saving} onClick={sendFree}>Enviar briefing</button></details>}
  </section>;
}
