import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, apiBlob } from '../api';

type Tamanho = 'computador' | 'celular';
type Acao = Record<string, string | number>;
const teclas = new Set(['Enter','Tab','Backspace','Delete','Escape','ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End','PageUp','PageDown']);
const novoId = () => globalThis.crypto?.randomUUID?.() ?? (Date.now().toString(36)+'-'+Math.random().toString(36).slice(2)+'-'+Math.random().toString(36).slice(2));

export function PreviaRemota({ projetoId, tamanho, geracao, recarga }: { projetoId: string; tamanho: Tamanho; geracao: string; recarga: number }) {
  const caminho = '/projects/'+projetoId+'/previa/visualizador';
  const [imagem,setImagem] = useState('');
  const [erro,setErro] = useState('');
  const [texto,setTexto] = useState('');
  const [tentativa,setTentativa] = useState(0);
  const atual = useRef<{id:string; ativa:boolean; pronta:boolean; url:string; fila:Promise<unknown>; pendentes:number} | null>(null);
  const img = useRef<HTMLImageElement>(null);
  const foco = useRef<HTMLDivElement>(null);
  const toque = useRef<{x:number;y:number;px:number;py:number} | null>(null);
  const scroll = useRef({x:0,y:0,dx:0,dy:0,timer:0});
  const ultimaRecarga = useRef(recarga);

  useEffect(() => {
    const sessao = { id:novoId(), ativa:true, pronta:false, url:'', fila:Promise.resolve() as Promise<unknown>, pendentes:0 };
    atual.current = sessao;
    setImagem(''); setErro('');
    let timer:number|undefined;
    const proximo = async () => {
      if (!sessao.ativa) return;
      if (document.visibilityState === 'hidden' || sessao.pendentes) { timer=window.setTimeout(proximo,500); return; }
      try {
        const blob = await apiBlob(caminho+'/quadro','POST',{id:sessao.id,tamanho});
        if (!sessao.ativa) return;
        const url = URL.createObjectURL(blob);
        if (sessao.url) URL.revokeObjectURL(sessao.url);
        sessao.url=url; sessao.pronta=true;
        setImagem(url);
        timer=window.setTimeout(proximo,500);
      } catch (e) {
        if (sessao.ativa) { sessao.pronta=false; setErro(e instanceof Error?e.message:String(e)); }
      }
    };
    void proximo();
    return () => {
      sessao.ativa=false;
      if(timer!==undefined)window.clearTimeout(timer);
      if(scroll.current.timer)window.clearTimeout(scroll.current.timer);
      scroll.current={x:0,y:0,dx:0,dy:0,timer:0};
      if(sessao.url)URL.revokeObjectURL(sessao.url);
      // On cleanup the project stays running; only this browser context is released.
      void api(caminho+'/fechar','POST',{id:sessao.id}).catch(()=>undefined);
      if(atual.current===sessao)atual.current=null;
    };
  }, [caminho,tamanho,geracao,tentativa]);

  function enviar(comando:Acao) {
    const s=atual.current;
    if(!s?.ativa||!s.pronta||s.pendentes>=8)return;
    s.pendentes++;
    s.fila=s.fila.then(async()=>{
      if(s.ativa)await api(caminho+'/acao','POST',{id:s.id,comando});
    }).catch(e=>{if(s.ativa)setErro(e instanceof Error?e.message:String(e));}).finally(()=>{s.pendentes--;});
  }
  useEffect(()=>{
    if(ultimaRecarga.current!==recarga){ultimaRecarga.current=recarga;enviar({tipo:'recarregar'});}
  },[recarga]);
  function posicao(x:number,y:number) {
    const r=img.current?.getBoundingClientRect();
    if(!r||!r.width||!r.height)return null;
    return {x:Math.max(0,Math.min(1,(x-r.left)/r.width)),y:Math.max(0,Math.min(1,(y-r.top)/r.height))};
  }
  function down(e:PointerEvent<HTMLImageElement>) {
    if(e.button!==0)return;
    e.preventDefault(); foco.current?.focus();
    const p=posicao(e.clientX,e.clientY);
    if(p){toque.current={...p,px:e.clientX,py:e.clientY};e.currentTarget.setPointerCapture(e.pointerId);}
  }
  function up(e:PointerEvent<HTMLImageElement>) {
    const inicio=toque.current;toque.current=null;
    if(!inicio)return;
    const p=posicao(e.clientX,e.clientY);if(!p)return;
    const dx=inicio.px-e.clientX,dy=inicio.py-e.clientY;
    if(Math.hypot(dx,dy)>8) {
      const r=img.current?.getBoundingClientRect();
      const escala=r?.width?(tamanho==='celular'?390:1366)/r.width:1;
      enviar({tipo:'rolar',x:inicio.x,y:inicio.y,dx:Math.max(-2000,Math.min(2000,dx*escala)),dy:Math.max(-2000,Math.min(2000,dy*escala))});
    }else enviar({tipo:'clique',...p});
  }
  useEffect(()=>{
    const el=img.current;if(!el)return;
    const wheel=(e:WheelEvent)=>{
      e.preventDefault();
      const p=posicao(e.clientX,e.clientY);if(!p)return;
      const s=scroll.current;s.x=p.x;s.y=p.y;
      const mult=e.deltaMode===1?20:e.deltaMode===2?400:1;
      s.dx+=e.deltaX*mult;s.dy+=e.deltaY*mult;
      if(!s.timer)s.timer=window.setTimeout(()=>{
        enviar({tipo:'rolar',x:s.x,y:s.y,dx:Math.max(-2000,Math.min(2000,s.dx)),dy:Math.max(-2000,Math.min(2000,s.dy))});
        s.dx=s.dy=s.timer=0;
      },80);
    };
    el.addEventListener('wheel',wheel,{passive:false});
    return ()=>el.removeEventListener('wheel',wheel);
  },[!!imagem,caminho]);
  function tecla(e:KeyboardEvent<HTMLDivElement>) {
    if(e.nativeEvent.isComposing)return;
    if(e.key.length===1&&!e.ctrlKey&&!e.metaKey&&!e.altKey){
      e.preventDefault();enviar({tipo:'texto',texto:e.key});return;
    }
    const mods=[e.ctrlKey?'Control':'',e.metaKey?'Meta':'',e.altKey?'Alt':'',e.shiftKey?'Shift':''].filter(Boolean);
    if(teclas.has(e.key)||(mods.length>0&&/^[a-zA-Z0-9]$/.test(e.key))){
      e.preventDefault();enviar({tipo:'tecla',tecla:[...mods,e.key].join('+')});
    }
  }
  return <div className={'previa-remota t-'+tamanho}>
    <div className="previa-remota-barra">
      <span className="small muted">{imagem?'Navegador conectado':'Conectando navegador…'}</span>
      <button type="button" className="secondary" disabled={!imagem} onClick={()=>enviar({tipo:'voltar'})}>Voltar</button>
      <input aria-label="Texto para o campo selecionado no software" placeholder="Digite no campo selecionado" value={texto} onChange={e=>setTexto(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&texto){enviar({tipo:'texto',texto});setTexto('');}}} />
      <button type="button" className="secondary" disabled={!imagem||!texto} onClick={()=>{enviar({tipo:'texto',texto});setTexto('');}}>Digitar</button>
      <button type="button" className="secondary" disabled={!imagem} onClick={()=>enviar({tipo:'tecla',tecla:'Enter'})}>Enter</button>
    </div>
    {erro&&<div className="error small previa-remota-erro">{erro} <button type="button" className="secondary" onClick={()=>setTentativa(x=>x+1)}>Reconectar</button></div>}
    <div ref={foco} className="previa-remota-tela" tabIndex={0} aria-label="Tela interativa do software" onKeyDown={tecla} onPaste={e=>{e.preventDefault();enviar({tipo:'texto',texto:e.clipboardData.getData('text').slice(0,4000)});}}>
      {imagem?<img ref={img} draggable={false} alt="Tela do software em execução" src={imagem} onPointerDown={down} onPointerUp={up} onPointerCancel={()=>{toque.current=null;}}/>:<div className="previa-info">{erro?'A conexão falhou.':'Abrindo o software no Chromium do servidor…'}</div>}
    </div>
  </div>;
}

export function PreviaEmNovaAba() {
  const {pid=''}=useParams();
  const [estado,setEstado]=useState<any>(null);
  const [erro,setErro]=useState('');
  const [tamanho,setTamanho]=useState<Tamanho>('computador');
  const [recarga,setRecarga]=useState(0);
  useEffect(()=>{
    let viva=true;
    const carregar=()=>api('/projects/'+pid+'/previa').then(e=>{if(viva){setEstado(e);setErro('');}}).catch(e=>{if(viva)setErro(e.message);});
    void carregar();const timer=window.setInterval(carregar,3000);
    return ()=>{viva=false;window.clearInterval(timer);};
  },[pid]);
  return <main className="previa-pagina">
    <div className="previa-barra">
      <Link to={'/p/'+pid}>Voltar ao projeto</Link>
      <button className="secondary" onClick={()=>setTamanho('computador')}>Computador</button>
      <button className="secondary" onClick={()=>setTamanho('celular')}>Celular</button>
      <button className="secondary" onClick={()=>setRecarga(x=>x+1)}>Recarregar</button>
      {estado?.estado==='parada'&&<button onClick={()=>void api('/projects/'+pid+'/previa/ligar','POST').then(setEstado).catch(e=>setErro(e.message))}>Ligar prévia</button>}
    </div>
    {estado?.sourceJobId&&<div className="aviso-sistema">Cópia selecionada para avaliação · {String(estado.sourceCommit??'').slice(0,8)}. A prévia não aprova o trabalho.</div>}
    {erro&&<div className="error">{erro}</div>}
    {estado?.estado==='no-ar'&&estado.visualizador?<PreviaRemota projetoId={pid} tamanho={tamanho} geracao={String(estado.ligadaEm)} recarga={recarga}/>:<p className="previa-info">{estado?.mensagem||'Aguardando a prévia do projeto.'}</p>}
  </main>;
}
