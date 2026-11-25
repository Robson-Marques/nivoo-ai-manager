import { useEffect, useRef, useState } from 'react';
import type { Visual } from './design-visual';
export function DesignPreview({adapter,visual,theme}:{adapter:'liquid-glass'|'bootstrap';visual:Visual;theme:'light'|'dark'|'system'}){
  const ref=useRef<HTMLIFrameElement>(null);
  const [viewport,setViewport]=useState('desktop');
  const send=()=>ref.current?.contentWindow?.postMessage({type:'nivoo-design-preview',visual,theme},'*');
  useEffect(()=>{send()},[visual,theme,adapter]);
  const width=viewport==='mobile'?'375px':viewport==='tablet'?'768px':'100%';
  return <div><label>Viewport<select value={viewport} onChange={e=>setViewport(e.target.value)}><option value="desktop">Desktop</option><option value="tablet">Tablet — 768 px</option><option value="mobile">Celular — 375 px</option></select></label>
    <div className="design-preview-scroll"><iframe key={adapter} ref={ref} title="Prévia interativa do motor selecionado" sandbox="allow-scripts" src={'/design-preview/index.html?engine='+adapter} onLoad={send} style={{width,height:570,border:0,maxWidth:viewport==='desktop'?'100%':'none'}}/></div>
    <small>Componentes reais em ambiente isolado. A largura desktop acompanha o espaço disponível.</small></div>;
}
