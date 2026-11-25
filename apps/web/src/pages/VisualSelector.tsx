import { useEffect,useRef,useState,type CSSProperties } from 'react';
import { api } from '../api';
import { buildVisualSelection,DELEGATE,delegatedChoices,emptyChoices,type Catalog,type Choices,type VisualProfile,type VisualQuestion,type Style,type Palette,type Font,type GlassVariant } from './visual-selection';
import './VisualSelector.css';
import { NivooGlassRoot,NivooGlassSurface } from '../vendor/liqui/nivoo';
import './VisualFonts.css';
import { LOCAL_FONTS,loadVisualFont,type FontStates } from './visual-fonts';

type Props={questions:VisualQuestion[];onConfirm:(profile:VisualProfile)=>Promise<void>;onFree?: (text:string)=>Promise<void>};

function fontPreview(font:Font|undefined,states:FontStates):{stack:string;label:string}{
  if(!font)return {stack:'system-ui, sans-serif',label:'Fonte do sistema'};
  if(font.availability==='system')return {stack:font.stack,label:font.name+' (sistema)'};
  const state=states[font.id]??'loading';
  return {stack:font.stack,label:font.name+(state==='ready'?' · original local':state==='failed'?' · falha ao carregar':' · carregando')};
}
function Preview({style,palette,dark,mobile,density,heading,body,catalog,variant,fontStates,mini=false}:{style:Style;variant?:GlassVariant;fontStates:FontStates;palette:Palette;dark:boolean;mobile?:boolean;density?:string;heading?:Font;body?:Font;catalog:Catalog;mini?:boolean}){
  const colors=dark?palette.dark:palette.light;
  const glass=style.id==='liquid-glass';
  const material=glass?(variant??catalog.glassVariants[0]):undefined;

  const f=catalog.foundations.find(x=>x.styleId===style.id);
  const d=catalog.densities.find(x=>x.id===density);
  const vars={
    '--vs-bg':colors.background,'--vs-surface':colors.surface,'--vs-raised':colors.surfaceRaised,'--vs-text':colors.text,'--vs-muted':colors.muted,'--vs-border':colors.border,'--vs-accent':colors.accent,'--vs-on-accent':colors.onAccent,'--vs-success':colors.success,
    '--vs-radius':(f?.radius.panel??10)+'px','--vs-control-radius':(f?.radius.control??6)+'px','--vs-shadow':f?.shadow.panel??'none',
    '--vs-gap':Math.max(4,d?.spacing.sm??8)+'px','--vs-heading':fontPreview(heading,fontStates).stack,'--vs-body':fontPreview(body,fontStates).stack,'--nv-liqui-solid':colors.surface,'--nv-liqui-text':colors.text,
  } as CSSProperties;
  if(glass){
    const variantId=material?.id??'frosted-glass';
    // Deliberately structured background: the upstream lens bends its edges.
    // No CSS approximation of the optical effect and no unlicensed photography.
    const backdrop=<div aria-hidden="true" className="nv-vs-optical-backdrop" style={{background:dark
      ?'linear-gradient(145deg,#070c19 0 34%,#2a4464 34% 55%,#132f45 55% 72%,#060e1e 72%)'
      :'linear-gradient(145deg,#f4f8fc 0 34%,#b9cce5 34% 55%,#d7e7ee 55% 72%,#eef1f8 72%)'}}/>;
    return <NivooGlassRoot variant={variantId} dark={dark} accent={colors.accent} textColor={colors.text} mutedColor={colors.muted} backdrop={backdrop}
      className={'nv-vs-preview nv-vs-optical'+(mobile?' nv-vs-mobile':'')+(mini?' nv-vs-mini':'')} style={vars} aria-hidden={mini?true:undefined}>
      <NivooGlassSurface radius={20} refraction={75} bezel={15} blur={2} contentClassName="nv-vs-optical-nav">
        <span className="nv-vs-brand"><i>N</i><strong>Workspace</strong></span><span className="nv-vs-online"><span className="nv-vs-dot"/> Online</span><span className="nv-vs-avatar">JD</span>
      </NivooGlassSurface>
      <div className="nv-vs-optical-content">
        <div className="nv-vs-preview-title"><div><small>GESTÃO DE CLIENTES</small><strong>Visão geral</strong></div><span className="nv-vs-preview-action">+ Novo</span></div>
        <div className="nv-vs-preview-stats nv-vs-optical-stats">
          <NivooGlassSurface radius={19} refraction={110} bezel={21} contentClassName="nv-vs-optical-stat"><span>Clientes</span><strong>24</strong><small>+4 neste mês</small></NivooGlassSurface>
          <NivooGlassSurface radius={19} refraction={110} bezel={21} contentClassName="nv-vs-optical-stat"><span>Ativos</span><strong>18</strong><small>75% da base</small></NivooGlassSurface>
        </div>
        {!mini&&<NivooGlassSurface radius={20} refraction={120} bezel={22} contentClassName="nv-vs-optical-chart"><div><strong>Novos clientes</strong><small>Últimos 7 dias</small></div><div className="nv-vs-bars" aria-hidden="true">{[30,56,42,78,61,90,72].map((n,i)=><i key={i} style={{height:n+'%'}}/>)}</div></NivooGlassSurface>}
        <NivooGlassSurface radius={20} refraction={100} bezel={20} contentClassName="nv-vs-optical-table"><strong>Clientes recentes</strong><div className="nv-vs-optical-data"><div><span>Cliente A</span><span className="nv-vs-preview-status">Ativo</span></div>{!mini&&<div><span>Cliente B</span><span className="nv-vs-preview-status">Ativo</span></div>}</div></NivooGlassSurface>
      </div>
      <NivooGlassSurface radius={24} refraction={95} bezel={17} contentClassName="nv-vs-optical-dock"><span className="nv-vs-active">◈ Resumo</span><span>◎ Clientes</span><span>▥ Relatórios</span></NivooGlassSurface>
    </NivooGlassRoot>;
  }
  return <div className={'nv-vs-preview'+''+(mobile?' nv-vs-mobile':'')+(mini?' nv-vs-mini':'')} data-style={style.id} data-glass-variant={material?.id} data-mode={dark?'dark':'light'} style={vars} aria-hidden={mini?true:undefined}>
    <div className="nv-vs-preview-nav"><span className="nv-vs-brand"><i>N</i><strong>Workspace</strong></span><span className="nv-vs-online"><span className="nv-vs-dot"/> Online</span><span className="nv-vs-avatar">JD</span></div>
    <div className="nv-vs-preview-content">
      <div className="nv-vs-preview-sidebar"><span className="nv-vs-active">◈ Resumo</span><span>◎ Clientes</span><span>▥ Relatórios</span><span>⚙ Ajustes</span></div>
      <div className="nv-vs-preview-main">
        <div className="nv-vs-preview-title"><div><small>GESTÃO DE CLIENTES</small><strong>Visão geral</strong></div><span className="nv-vs-preview-action">+ Novo</span></div>
        <div className="nv-vs-preview-stats"><div className="nv-glass-panel"><span>Clientes</span><strong>24</strong><small>+4 neste mês</small></div><div className="nv-glass-panel"><span>Ativos</span><strong>18</strong><small>75% da base</small></div></div>
        <div className="nv-vs-preview-chart"><div><strong>Novos clientes</strong><small>Últimos 7 dias</small></div><div className="nv-vs-bars" aria-hidden="true">{[30,56,42,78,61,90,72].map((n,i)=><i key={i} style={{height:n+'%'}}/>)}</div></div>
        <div className="nv-vs-preview-table"><strong>Clientes recentes</strong><div><span className="nv-glass-control nv-vs-search">⌕ Pesquisar</span></div><div><span>Cliente A</span><span className="nv-vs-preview-status">Ativo</span></div><div><span>Cliente B</span><span className="nv-vs-preview-status">Ativo</span></div></div>
      </div>
    </div>
    <div className="nv-vs-preview-dock"><span className="nv-vs-active">◈ Resumo</span><span>◎ Clientes</span><span>▥ Relatórios</span></div>
  </div>;
}

export function VisualSelector({questions,onConfirm,onFree}:Props){
  const [catalog,setCatalog]=useState<Catalog|null>(null);
  const [fontStates,setFontStates]=useState<FontStates>({});
  useEffect(()=>{let live=true;for(const font of LOCAL_FONTS)void loadVisualFont(font).then(state=>{if(live)setFontStates(s=>({...s,[font.id]:state}));});return ()=>{live=false;};},[]);
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
  const choose=(key:keyof Choices,id:string)=>setChoices(c=>({...c,[key]:id,...(key==='style'&&id!=='liquid-glass'?{glassVariant:DELEGATE}:{})}));
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
  const previewDark=choices.theme==='dark'||(choices.theme!=='light'&&dark);
  const previewMobile=choices.usage==='mobile'||(choices.usage!=='desktop'&&device==='mobile');
  return <section className="nv-visual-selector" aria-label="Identidade visual do software">
    <div className="nv-vs-header"><h3>Defina o visual do seu software</h3><p>Escolha as preferências ou delegue à IA. A prévia é ilustrativa, não é o software final.</p><button type="button" className="secondary" disabled={saving} onClick={()=>setChoices({...delegatedChoices})}>Delegar todas as escolhas</button></div>
    {questions.map(q=><fieldset key={q.id} disabled={saving}><legend>{q.pergunta}</legend><div className={'nv-vs-options'+(q.id==='style'?' nv-vs-styles':'')}>
      {q.opcoes.map(o=>{
        const s=q.id==='style'?catalog.styles.find(x=>x.id===o.id):undefined;
        const pair=q.id==='typography'?catalog.pairings.find(x=>x.id===o.id):undefined;
        const sample=fontPreview(catalog.fonts.find(x=>x.id===pair?.fonts.heading),fontStates);
        const bodySample=fontPreview(catalog.fonts.find(x=>x.id===pair?.fonts.body),fontStates);
        const monoSample=fontPreview(catalog.fonts.find(x=>x.id===pair?.fonts.mono),fontStates);
        return <label key={o.id} className={'nv-vs-option'+(choices[q.id as keyof Choices]===o.id?' nv-vs-selected':'')}>
          <input type="radio" name={'visual-'+q.id} checked={choices[q.id as keyof Choices]===o.id} onChange={()=>choose(q.id as keyof Choices,o.id)}/>
          {s&&<Preview mini fontStates={fontStates} style={s} palette={palette} dark={choices.theme==='dark'||(choices.theme!=='light'&&s.preferredTheme==='dark')} catalog={catalog}/>}
          {pair&&<div className="nv-vs-type-sample"><strong style={{fontFamily:sample.stack}}>Aa · Visão geral</strong><span style={{fontFamily:bodySample.stack}}>Gerencie seus clientes com precisão.</span><code style={{fontFamily:monoSample.stack}}>CLI-0024 · 18 ativos</code></div>}
          <strong>{o.rotulo}</strong><small>{o.descricao}</small>{pair&&<small>{[...new Set([sample.label,bodySample.label,monoSample.label])].join(" · ")}</small>}
        </label>;
      })}
    </div>{q.id==='style'&&<fieldset className="nv-vs-variants" disabled={saving}><legend>Variações Liquid Glass</legend><p>Escolha diretamente o material de vidro. Motor original Liqui Design (Canvas/SVG); a qualidade óptica depende do navegador.</p><div className="nv-vs-options nv-vs-styles">{catalog.glassVariants.map(v=><label key={v.id} className={'nv-vs-option'+(choices.style==='liquid-glass'&&choices.glassVariant===v.id?' nv-vs-selected':'')}><input type="radio" name="visual-glass-variant" checked={choices.style==='liquid-glass'&&choices.glassVariant===v.id} onChange={()=>chooseGlass(v.id)}/><Preview mini fontStates={fontStates} style={catalog.styles.find(s=>s.id==='liquid-glass')!} variant={v} palette={palette} dark={v.preferredTheme==='dark'||(v.preferredTheme==='system'&&choices.theme==='dark')} catalog={catalog}/><strong>{v.name}</strong><small>{v.description}</small></label>)}<label className="nv-vs-option"><input type="radio" name="visual-glass-variant" checked={choices.style==='liquid-glass'&&choices.glassVariant===DELEGATE} onChange={()=>chooseGlass(DELEGATE)}/>Liquid Glass — IA escolhe o material</label></div></fieldset>}</fieldset>)}
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
    </div><Preview fontStates={fontStates} style={style} variant={variant} palette={palette} dark={previewDark} mobile={previewMobile} density={choices.density} heading={heading} body={body} catalog={catalog}/>
    <small>{fontPreview(heading,fontStates).label}. {fontPreview(body,fontStates).label}. Dados fictícios. Valores de amostra para escolhas ainda não definidas não serão gravados.</small></div>
    {erro&&<p role="alert" className="nv-vs-error">{erro}</p>}
    <button type="button" disabled={!profile||saving||missingFonts.length>0} onClick={()=>profile&&!missingFonts.length&&send(profile)}>{saving?'Confirmando…':'Confirmar identidade e continuar'}</button>
    {missingFonts.length>0&&<small role="status">As fontes originais escolhidas ainda não carregaram. Recarregue se necessário ou escolha outra combinação.</small>}
    {!profile&&<small>Escolha ou delegue as quatro preferências principais.</small>}
    {onFree&&<details><summary>Prefiro explicar com minhas palavras</summary><label>Briefing visual (não grava um perfil automaticamente)<textarea value={free} onChange={e=>setFree(e.target.value)} disabled={saving} rows={3}/></label><button type="button" className="secondary" disabled={!free.trim()||saving} onClick={sendFree}>Enviar briefing</button></details>}
  </section>;
}
