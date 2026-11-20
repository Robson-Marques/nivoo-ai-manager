import { Marca } from './Marca';
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useMatch, useNavigate } from 'react-router-dom';
import { api } from './api';
import { NovoProjeto } from './pages/NovoProjeto';
import { IconeArquivo, IconeMais } from './Icones';

interface Ctx {
  projetos: any[] | null;
  recarregar: () => Promise<void>;
  novoProjeto: () => void;
  /** Conversas do projeto aberto (ativas). */
  conversas: any[] | null;
  recarregarConversas: () => Promise<void>;
}

const ProjetosCtx = createContext<Ctx>({
  projetos: null,
  recarregar: async () => undefined,
  novoProjeto: () => undefined,
  conversas: null,
  recarregarConversas: async () => undefined,
});
export const useProjetos = () => useContext(ProjetosCtx);

/**
 * Estrutura de todas as telas: projetos na lateral (agrupados por agente); no projeto aberto, as suas
 * conversas (como no ChatGPT), com "+" na linha do projeto para uma conversa nova. O que foi arquivado (projetos e
 * conversas) fica num lugar só: o botão "Arquivados" no rodapé do menu.
 */
export function Layout() {
  const rota = useMatch('/p/:pid/*');
  const rotaConversa = useMatch('/p/:pid/c/:cid');
  const pid = rota?.params.pid;
  const cid = rotaConversa?.params.cid;
  const nav = useNavigate();
  const [projetos, setProjetos] = useState<any[] | null>(null);
  const [conversas, setConversas] = useState<any[] | null>(null);
  const [novo, setNovo] = useState(false);
  const [verArquivados, setVerArquivados] = useState(false);
  const [mover, setMover] = useState<any | null>(null);
  const [destino, setDestino] = useState('');
  const [movendo, setMovendo] = useState(false);
  const [erroMover, setErroMover] = useState('');
  const [dragDestino, setDragDestino] = useState<string | null>(null);
  // Projeto arquivado aberto (pelo "Arquivados"): aparece no menu enquanto estiver aberto, com as conversas dele.
  const [abertoArquivado, setAbertoArquivado] = useState<any | null>(null);
  // Lista de projetos recolhida para a esquerda (lembrado neste navegador).
  const [recolhido, setRecolhidoBruto] = useState(() => {
    try {
      return localStorage.getItem('nivoo_lado') === 'recolhido';
    } catch {
      return false;
    }
  });
  const setRecolhido = (v: boolean) => {
    setRecolhidoBruto(v);
    try {
      localStorage.setItem('nivoo_lado', v ? 'recolhido' : 'aberto');
    } catch {
      /* só nesta tela */
    }
  };

  const recarregar = useCallback(async () => setProjetos(await api<any[]>('/projects')), []);
  const recarregarConversas = useCallback(async () => {
    if (!pid) return setConversas(null);
    setConversas(await api<any[]>(`/projects/${pid}/conversations`));
  }, [pid]);
  useEffect(() => {
    recarregar().catch(() => setProjetos([]));
  }, [recarregar]);
  // Sem worker ligado nada anda (respostas e trabalhos ficam parados): avisa em vez de deixar "Pensando…".
  const [semWorker, setSemWorker] = useState(false);
  useEffect(() => {
    const ver = () =>
      api<any[]>('/system/workers')
        .then((w) => setSemWorker(!w.some((x) => x.online)))
        .catch(() => undefined);
    ver();
    const t = setInterval(ver, 30_000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    recarregarConversas().catch(() => setConversas([]));
  }, [recarregarConversas]);
  useEffect(() => {
    if (!pid || !projetos || projetos.some((p) => p.id === pid)) return setAbertoArquivado(null);
    api<any>(`/projects/${pid}`)
      .then((p) => setAbertoArquivado(p?.archivedAt ? p : null))
      .catch(() => setAbertoArquivado(null));
  }, [pid, projetos]);

  const grupos = new Map<string, any[]>();
  for (const p of projetos ?? []) {
    const g = p.area?.name ?? 'Projetos';
    grupos.set(g, [...(grupos.get(g) ?? []), p]);
  }

  /** "+" na linha do projeto: abre uma conversa nova (ou a nova que ainda está vazia, sem acumular conversas em branco). */
  const novaConversa = async (projetoId: string) => {
    const c = await api(`/projects/${projetoId}/conversations`, 'POST', { reaproveitarVazia: true });
    if (projetoId === pid) await recarregarConversas();
    nav(`/p/${projetoId}/c/${c.id}`);
  };

  /** Ações de uma conversa do menu: renomear, arquivar, excluir (desarquivar fica em "Arquivados"). */
  const acaoConversa = async (c: any, acao: 'renomear' | 'arquivar' | 'excluir') => {
    if (acao === 'renomear') {
      const t = window.prompt('Novo nome da conversa:', c.title);
      if (!t?.trim()) return;
      await api(`/projects/${pid}/conversations/${c.id}`, 'PATCH', { title: t.trim() });
    } else if (acao === 'excluir') {
      if (!window.confirm(`Excluir a conversa "${c.title}"? As mensagens somem; o que o projeto aprendeu (memória, arquivos) continua.`)) return;
      await api(`/projects/${pid}/conversations/${c.id}`, 'DELETE');
      if (c.id === cid) nav(`/p/${pid}`);
    } else {
      await api(`/projects/${pid}/conversations/${c.id}`, 'PATCH', { archived: true });
      if (c.id === cid) nav(`/p/${pid}`);
    }
    await recarregarConversas();
  };

  const moverConversa = async (c: any, targetId: string) => {
    if (!pid || !targetId || pid === targetId) return;
    setMovendo(true); setErroMover('');
    try {
      await api(`/projects/${pid}/conversations/${c.id}/move`, 'POST', { targetProjectId: targetId });
      setMover(null);
      await recarregarConversas();
      if (c.id === cid) nav(`/p/${targetId}/c/${c.id}`);
      else nav(`/p/${targetId}`);
    } catch (e: any) {
      setErroMover(e?.message ?? 'Não foi possível mover a conversa');
      setMover(c); setDestino(targetId);
    } finally {
      setMovendo(false); setDragDestino(null);
    }
  };

  const iniciarMover = (c: any) => {
    setMover(c);
    setDestino((projetos ?? []).find(p => p.id !== pid)?.id ?? '');
    setErroMover('');
  };
  const listaConversas = (projetoId: string) =>
    conversas && conversas.length > 0 ? (
      <div className="conversas">
        {conversas.map((c) => (
          <ItemConversa key={c.id} c={c} pid={projetoId} ativa={c.id === cid} onAcao={acaoConversa} onMover={iniciarMover} />
        ))}
      </div>
    ) : null;

  const linhaProjeto = (p: any) => (
    <div key={p.id}>
      <div className={`proj-linha${p.id === pid ? ' on' : ''}${p.archivedAt ? ' arquivado' : ''}${dragDestino===p.id?' proj-drop-target':''}`}
        onDragOver={e=>{if(p.id!==pid&&!p.archivedAt&&e.dataTransfer.types.includes('application/x-nivoo-conversation')){e.preventDefault();e.dataTransfer.dropEffect='move';setDragDestino(p.id)}}}
        onDragLeave={e=>{if(!e.currentTarget.contains(e.relatedTarget as Node))setDragDestino(null)}}
        onDrop={e=>{e.preventDefault();setDragDestino(null);if(p.id===pid||p.archivedAt)return;try{const data=JSON.parse(e.dataTransfer.getData('application/x-nivoo-conversation'));if(data.projectId===pid&&data.id){const c=conversas?.find(x=>x.id===data.id);if(c)void moverConversa(c,p.id)}}catch{setErroMover('Não foi possível ler a conversa arrastada')}}}>
        <Link to={`/p/${p.id}`} className="proj">{p.name}</Link>
        <Link to={`/p/${p.id}/studio`} title="Abrir Nivoo Studio — editor de vídeo" aria-label={`Abrir editor de vídeo do projeto ${p.name}`} className="proj-acao">🎬</Link>
        <button className="proj-acao" title="Nova conversa" aria-label={`Nova conversa em ${p.name}`} onClick={() => novaConversa(p.id)}>
          <IconeMais />
        </button>
      </div>
      {p.id === pid && listaConversas(p.id)}
    </div>
  );

  return (
    <ProjetosCtx.Provider value={{ projetos, recarregar, novoProjeto: () => setNovo(true), conversas, recarregarConversas }}>
      <div className={recolhido ? 'chat-app lado-recolhido' : 'chat-app'}>
        {recolhido ? (
          <aside className="chat-side recolhida">
            <button className="lado-botao" title="Mostrar os projetos" aria-label="Mostrar os projetos" onClick={() => setRecolhido(false)}>☰</button>
            <button className="lado-botao" title="Novo projeto" aria-label="Novo projeto" onClick={() => setNovo(true)}>+</button>
          </aside>
        ) : (
        <aside className="chat-side">
          <div className="lado-topo">
            <Link to="/" className="brand"><Marca tamanho={30} /></Link>
            <button className="lado-botao" title="Recolher para a esquerda" aria-label="Recolher a lista de projetos" onClick={() => setRecolhido(true)}>‹</button>
          </div>
          <button className="novo" onClick={() => setNovo(true)}>+ Novo projeto</button>
          <nav className="proj-list">
            {/* Projeto arquivado aberto (vindo de "Arquivados"): no topo enquanto estiver aberto. */}
            {abertoArquivado && (
              <div>
                <div className="grupo">Arquivado (aberto)</div>
                {linhaProjeto(abertoArquivado)}
              </div>
            )}
            {[...grupos.entries()].map(([g, ps]) => (
              <div key={g}>
                <div className="grupo">{g}</div>
                {ps.map(linhaProjeto)}
              </div>
            ))}
          </nav>
          <div className="side-foot">
            <button className="side-botao" onClick={() => setVerArquivados(true)}>
              <IconeArquivo /> Arquivados
            </button>
            <NavLink to="/studio">🎬 Nivoo Studio</NavLink>
            <NavLink to="/agentes">Agentes</NavLink>
            <NavLink to="/contas">Conexões</NavLink>
            <NavLink to="/diagnostico">Diagnóstico</NavLink>
          </div>
        </aside>
        )}
        <main className="chat-main">
          {semWorker && (
            <div className="aviso-worker">
              O processamento do servidor está parado: as respostas da IA e os trabalhos não andam. No servidor, rode <code>nivoo restart</code> (e, se continuar, <code>nivoo logs worker</code>).
            </div>
          )}
          <Outlet />
        </main>
        {verArquivados && (
          <Arquivados
            onFechar={() => setVerArquivados(false)}
            onMudou={async () => {
              await recarregar();
              await recarregarConversas();
            }}
          />
        )}
        {mover && (
          <div className="modal-fundo" onClick={()=>!movendo&&setMover(null)}>
            <div className="modal" role="dialog" aria-modal="true" aria-label="Mover conversa" onClick={e=>e.stopPropagation()}>
              <h2>Mover para projeto</h2>
              <p>Conversa: <strong>{mover.title}</strong></p>
              <label>Projeto de destino
                <select value={destino} disabled={movendo} onChange={e=>setDestino(e.target.value)}>
                  {(projetos??[]).filter(p=>p.id!==pid&&!p.archivedAt).map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </label>
              <p className="muted">O histórico e os anexos acompanham a conversa. Memórias e trabalhos já criados permanecem no projeto original.</p>
              {erroMover&&<div className="error" role="alert">{erroMover}</div>}
              <div className="mover-conversa-actions">
                <button className="secondary" disabled={movendo} onClick={()=>setMover(null)}>Cancelar</button>
                <button disabled={movendo||!destino} onClick={()=>void moverConversa(mover,destino)}>{movendo?'Movendo…':'Mover conversa'}</button>
              </div>
            </div>
          </div>
        )}
        {novo && (
          <NovoProjeto
            onFechar={() => setNovo(false)}
            onCriado={async (id) => {
              setNovo(false);
              await recarregar();
              nav(`/p/${id}`);
            }}
          />
        )}
      </div>
    </ProjetosCtx.Provider>
  );
}

function ItemConversa({ c, pid, ativa, onAcao, onMover }: { c: any; pid: string; ativa: boolean; onAcao: (c: any, a: 'renomear' | 'arquivar' | 'excluir') => void; onMover: (c: any) => void }) {
  const [menu, setMenu] = useState(false);
  return (
    <div className={`conversa-item${ativa ? ' on' : ''}`} draggable onDragStart={e=>{e.dataTransfer.setData('application/x-nivoo-conversation',JSON.stringify({id:c.id,projectId:pid}));e.dataTransfer.setData('text/plain',c.title);e.dataTransfer.effectAllowed='move'}} title="Arraste para outro projeto ou use ⋯ → Mover para projeto">
      <Link to={`/p/${pid}/c/${c.id}`} title={c.title}>{c.title}</Link>
      <button className="mais" aria-label={`Opções da conversa ${c.title}`} onClick={() => setMenu(!menu)}>⋯</button>
      {menu && (
        <div className="menu-conversa" onMouseLeave={() => setMenu(false)}>
          <button onClick={() => { setMenu(false); onAcao(c, 'renomear'); }}>Renomear</button>
          <button onClick={() => { setMenu(false); onMover(c); }}>Mover para projeto</button>
          <button onClick={() => { setMenu(false); onAcao(c, 'arquivar'); }}>Arquivar</button>
          <button className="perigo" onClick={() => { setMenu(false); onAcao(c, 'excluir'); }}>Excluir</button>
        </div>
      )}
    </div>
  );
}

const quando = (d: string) => new Date(d).toLocaleDateString('pt-BR');

/** Tudo o que foi arquivado, num lugar só: projetos e conversas, para abrir, desarquivar ou (conversa) excluir. */
function Arquivados({ onFechar, onMudou }: { onFechar: () => void; onMudou: () => Promise<void> }) {
  const nav = useNavigate();
  const [dados, setDados] = useState<{ projetos: any[]; conversas: any[] } | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const carregar = useCallback(async () => setDados(await api<{ projetos: any[]; conversas: any[] }>('/arquivados')), []);
  useEffect(() => {
    carregar().catch((e) => setErro(String(e?.message ?? e)));
  }, [carregar]);
  const fazer = async (f: () => Promise<unknown>) => {
    setErro(null);
    try {
      await f();
      await carregar();
      await onMudou();
    } catch (e: any) {
      setErro(String(e?.message ?? e));
    }
  };
  const abrir = (url: string) => {
    onFechar();
    nav(url);
  };
  const vazio = dados && !dados.projetos.length && !dados.conversas.length;
  return (
    <div className="modal-fundo" onClick={onFechar}>
      <div className="modal arquivados" role="dialog" aria-label="Arquivados" onClick={(e) => e.stopPropagation()}>
        <div className="arq-topo">
          <h2>Arquivados</h2>
          <button className="secondary" onClick={onFechar}>Fechar</button>
        </div>
        {!dados && !erro && <p className="muted">Carregando…</p>}
        {vazio && <p className="muted">Nada arquivado. Arquive uma conversa pelo ⋯ ao lado dela, ou um projeto em Ajustes do projeto.</p>}
        {dados && dados.projetos.length > 0 && (
          <section>
            <h3>Projetos</h3>
            {dados.projetos.map((p) => (
              <div className="arq-item" key={p.id}>
                <div className="arq-nome">
                  <b>{p.name}</b>
                  <span>{p.area?.name ?? 'Projeto'} · arquivado em {quando(p.archivedAt)}</span>
                </div>
                <button className="secondary" onClick={() => abrir(`/p/${p.id}`)}>Abrir</button>
                <button onClick={() => fazer(() => api(`/projects/${p.id}`, 'PATCH', { archived: false }))}>Desarquivar</button>
              </div>
            ))}
          </section>
        )}
        {dados && dados.conversas.length > 0 && (
          <section>
            <h3>Conversas</h3>
            {dados.conversas.map((c) => (
              <div className="arq-item" key={c.id}>
                <div className="arq-nome">
                  <b title={c.title}>{c.title}</b>
                  <span>{c.project.name} · arquivada em {quando(c.archivedAt)}</span>
                </div>
                <button className="secondary" onClick={() => abrir(`/p/${c.project.id}/c/${c.id}`)}>Abrir</button>
                <button onClick={() => fazer(() => api(`/projects/${c.project.id}/conversations/${c.id}`, 'PATCH', { archived: false }))}>Desarquivar</button>
                <button
                  className="link perigo"
                  aria-label={`Excluir a conversa ${c.title}`}
                  onClick={() => window.confirm(`Excluir a conversa "${c.title}"? As mensagens somem; o que o projeto aprendeu (memória, arquivos) continua.`) && fazer(() => api(`/projects/${c.project.id}/conversations/${c.id}`, 'DELETE'))}
                >
                  Excluir
                </button>
              </div>
            ))}
          </section>
        )}
        {erro && <div className="error">{erro}</div>}
      </div>
    </div>
  );
}
