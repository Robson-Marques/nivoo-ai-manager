import { useState } from 'react';
import { colorNames,contrast,keys,readableText } from './design-visual';
import type { ColorKey,Palette,Visual } from './design-visual';
export function VisualEditor({value,onChange,defaults,palettes}:{value:Visual;onChange:(v:Visual)=>void;defaults:Visual;palettes:Palette[]}){
  const [palette,setPalette]=useState('');
  const [scheme,setScheme]=useState<'colors'|'darkColors'>('colors');
  const [hex,setHex]=useState<Partial<Record<ColorKey,string>>>({});
  const [message,setMessage]=useState('');
  const colors=value[scheme];
  const set=<K extends keyof Visual>(k:K,v:Visual[K])=>onChange({...value,[k]:v});
  const changeColor=(k:ColorKey,v:string)=>{setHex(h=>({...h,[k]:v}));if(/^#[0-9a-f]{6}$/i.test(v)){set(scheme,{...colors,[k]:v.toUpperCase()});setPalette('');}};
  const clear=()=>setHex({});
  const usePalette=(name:string)=>{setPalette(name);clear();const p=palettes.find(p=>p.name===name);if(p)onChange({...value,colors:{...p.colors},darkColors:{...p.darkColors}});};
  const ratios=[['Texto / fundo',contrast(colors.text,colors.background)],['Texto / superfície',contrast(colors.text,colors.surface)],['Texto secundário / superfície',contrast(colors.muted,colors.surface)],['Botão primário',contrast(readableText(colors.primary),colors.primary)]] as const;
  const exportTokens=()=>{const blob=new Blob([JSON.stringify({schemaVersion:1,visual:value},null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='nivoo-design-tokens.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);setMessage('Configuração exportada.');};
  return <div className="design-visual-editor">
    <h3>Identidade visual</h3>
    <label>Paleta<select value={palette} onChange={e=>usePalette(e.target.value)}><option value="">Personalizada</option>{palettes.map(p=><option key={p.name}>{p.name}</option>)}</select></label>
    <label>Editar cores do tema<select value={scheme} onChange={e=>{setScheme(e.target.value as typeof scheme);clear()}}><option value="colors">Claro</option><option value="darkColors">Escuro</option></select></label>
    <div className="design-swatches">{keys.map(k=><div key={k}><label>{colorNames[k]}<div className="design-color-row"><input aria-label={'Seletor de '+colorNames[k]} type="color" value={colors[k]} onChange={e=>changeColor(k,e.target.value)}/><input aria-label={'HEX de '+colorNames[k]} value={hex[k]??colors[k]} maxLength={7} onChange={e=>changeColor(k,e.target.value)} onBlur={()=>setHex(h=>({...h,[k]:undefined}))}/></div></label></div>)}</div>
    <details><summary>Contraste de texto</summary>{ratios.map(([label,r])=><p key={label}>{label}: {r.toFixed(2)}:1 — {r>=4.5?'AA texto normal':'Abaixo de AA texto normal'}</p>)}<small>Estimativa para cores sólidas, não certifica gradientes ou refração.</small></details>
    <label className="design-check"><input type="checkbox" checked={value.gradient} onChange={e=>set('gradient',e.target.checked)}/> Gradiente primário/secundário</label>
    {value.gradient&&<label>Ângulo: {value.gradientAngle}°<input type="range" min={0} max={360} value={value.gradientAngle} onChange={e=>set('gradientAngle',Number(e.target.value))}/></label>}
    <div className="design-options">
      <label>Tipografia<select value={value.font} onChange={e=>set('font',e.target.value as Visual['font'])}><option value="system">Sistema sem serifa</option><option value="serif">Serifa</option><option value="mono">Monoespaçada</option></select></label>
      <label>Densidade<select value={value.density} onChange={e=>set('density',e.target.value as Visual['density'])}><option value="compact">Compacta</option><option value="normal">Normal</option><option value="comfortable">Confortável</option></select></label>
      <label>Layout<select value={value.layout} onChange={e=>set('layout',e.target.value as Visual['layout'])}><option value="sidebar">Menu lateral</option><option value="topbar">Menu superior</option><option value="bento">Bento grid</option></select></label>
      <label>Exemplo<select value={value.component} onChange={e=>set('component',e.target.value as Visual['component'])}><option value="dashboard">Dashboard</option><option value="form">Formulário</option><option value="table">Tabela</option><option value="controls">Controles</option></select></label>
      <label>Sombra<select value={value.shadow} onChange={e=>set('shadow',e.target.value as Visual['shadow'])}><option value="none">Nenhuma</option><option value="soft">Suave</option><option value="strong">Forte</option></select></label>
      <label>Raio: {value.radius}px<input type="range" min={0} max={32} value={value.radius} onChange={e=>set('radius',Number(e.target.value))}/></label>
    </div>
    <label className="design-check"><input type="checkbox" checked={value.motion} onChange={e=>set('motion',e.target.checked)}/> Animações da prévia</label>
    <div className="design-actions"><button type="button" className="secondary" onClick={()=>{clear();setPalette('');onChange(defaults)}}>Restaurar padrão</button><button type="button" className="secondary" onClick={exportTokens}>Exportar tokens</button></div>
    {message&&<p role="status">{message}</p>}
  </div>;
}
