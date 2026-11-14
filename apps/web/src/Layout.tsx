import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useMatch, useNavigate } from 'react-router-dom';
import { api } from './api';
import { NovoProjeto } from './pages/NovoProjeto';

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
 * Estrutura de todas as telas: projetos na lateral (agrupados por modelo); no projeto aberto, as suas
 * conversas (como no ChatGPT). Conversas e projetos podem ser arquivados para a lista não crescer sem fim.
 */
export function Layout() {
  const rota = useMatch('/p/:pid/*');
  const rotaConversa = useMatch('/p/:pid/c/:cid');
  const pid = rota?.params.pid;
  const cid = rotaConversa?.params.cid;
  const nav = useNavigate();
  const [projetos, setProjetos] = useState<any[] | null>(null);
  const [arquivados, setArquivados] = useState<any[] | null>(null);
  const [conversas, setConversas] = useState<any[] | null>(null);
  const [conversasArquivadas, setConversasArquivadas] = useState<any[] | null>(null);
  const [novo, setNovo] = useState(false);

  // Listas de arquivados são buscadas só quando abertas.
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
    setConversasArquivadas(null);
    recarregarConversas().catch(() => setConversas([]));
  }, [recarregarConversas]);

  const grupos = new Map<string, any[]>();
  for (const p of projetos ?? []) {
    const g = p.area?.name ?? 'Projetos';
    grupos.set(g, [...(grupos.get(g) ?? []), p]);
  }

  const novaConversa = async () => {
    if (!pid) return;
    const c = await api(`/projects/${pid}/conversations`, 'POST', {});
    await recarregarConversas();
    nav(`/p/${pid}/c/${c.id}`);
  };
  const verArquivadas = async () => setConversasArquivadas(conversasArquivadas ? null : await api<any[]>(`/projects/${pid}/conversations?arquivadas=1`));
  const verProjetosArquivados = async () => setArquivados(arquivados ? null : await api<any[]>('/projects?arquivados=1'));

  /** Ações de uma conversa: renomear, arquivar/desarquivar, excluir. */
  const acaoConversa = async (c: any, acao: 'renomear' | 'arquivar' | 'desarquivar' | 'excluir') => {
    if (acao === 'renomear') {
      const t = window.prompt('Novo nome da conversa:', c.title);
      if (!t?.trim()) return;
      await api(`/projects/${pid}/conversations/${c.id}`, 'PATCH', { title: t.trim() });
    } else if (acao === 'excluir') {
      if (!window.confirm(`Excluir a conversa "${c.title}"? As mensagens somem; o que o projeto aprendeu (memória, arquivos) continua.`)) return;
      await api(`/projects/${pid}/conversations/${c.id}`, 'DELETE');
      if (c.id === cid) nav(`/p/${pid}`);
    } else {
      await api(`/projects/${pid}/conversations/${c.id}`, 'PATCH', { archived: acao === 'arquivar' });
      if (acao === 'arquivar' && c.id === cid) nav(`/p/${pid}`);
    }
    await recarregarConversas();
    if (conversasArquivadas) setConversasArquivadas(await api<any[]>(`/projects/${pid}/conversations?arquivadas=1`));
  };

  const listaConversas = (projetoId: string) => (
    <div className="conversas">
      <button className="nova-conversa" onClick={novaConversa}>+ Nova conversa</button>
      {conversas?.map((c) => (
        <ItemConversa key={c.id} c={c} pid={projetoId} ativa={c.id === cid} onAcao={acaoConversa} />
      ))}
      <button className="link mini" onClick={verArquivadas}>{conversasArquivadas ? 'ocultar arquivadas' : 'conversas arquivadas'}</button>
      {conversasArquivadas?.length === 0 && <div className="mini muted-side">nenhuma</div>}
      {conversasArquivadas?.map((c) => (
        <ItemConversa key={c.id} c={c} pid={projetoId} ativa={c.id === cid} arquivada onAcao={acaoConversa} />
      ))}
    </div>
  );

  return (
    <ProjetosCtx.Provider value={{ projetos, recarregar, novoProjeto: () => setNovo(true), conversas, recarregarConversas }}>
      <div className="chat-app">
        <aside className="chat-side">
          <Link to="/" className="brand">Nivoo</Link>
          <button className="novo" onClick={() => setNovo(true)}>+ Novo projeto</button>
          <nav className="proj-list">
            {[...grupos.entries()].map(([g, ps]) => (
              <div key={g}>
                <div className="grupo">{g}</div>
                {ps.map((p) => (
                  <div key={p.id}>
                    <Link to={`/p/${p.id}`} className={p.id === pid ? 'proj on' : 'proj'}>{p.name}</Link>
                    {p.id === pid && listaConversas(p.id)}
                  </div>
                ))}
              </div>
            ))}
            <button className="link mini" onClick={verProjetosArquivados}>{arquivados ? 'ocultar projetos arquivados' : 'projetos arquivados'}</button>
            {arquivados?.length === 0 && <div className="mini muted-side">nenhum</div>}
            {arquivados?.map((p) => (
              <div key={p.id}>
                <Link to={`/p/${p.id}`} className={p.id === pid ? 'proj on arquivado' : 'proj arquivado'}>{p.name}</Link>
                {p.id === pid && listaConversas(p.id)}
              </div>
            ))}
          </nav>
          <div className="side-foot">
            <NavLink to="/modelos">Modelos</NavLink>
            <NavLink to="/contas">Contas (IA e Git)</NavLink>
          </div>
        </aside>
        <main className="chat-main">
          {semWorker && (
            <div className="aviso-worker">
              O processamento do servidor está parado: as respostas da IA e os trabalhos não andam. No servidor, rode <code>nivoo restart</code> (e, se continuar, <code>nivoo logs worker</code>).
            </div>
          )}
          <Outlet />
        </main>
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

function ItemConversa({ c, pid, ativa, arquivada, onAcao }: { c: any; pid: string; ativa: boolean; arquivada?: boolean; onAcao: (c: any, a: 'renomear' | 'arquivar' | 'desarquivar' | 'excluir') => void }) {
  const [menu, setMenu] = useState(false);
  return (
    <div className={`conversa-item${ativa ? ' on' : ''}${arquivada ? ' arquivada' : ''}`}>
      <Link to={`/p/${pid}/c/${c.id}`} title={c.title}>{c.title}</Link>
      <button className="mais" aria-label={`Opções da conversa ${c.title}`} onClick={() => setMenu(!menu)}>⋯</button>
      {menu && (
        <div className="menu-conversa" onMouseLeave={() => setMenu(false)}>
          <button onClick={() => { setMenu(false); onAcao(c, 'renomear'); }}>Renomear</button>
          <button onClick={() => { setMenu(false); onAcao(c, arquivada ? 'desarquivar' : 'arquivar'); }}>{arquivada ? 'Desarquivar' : 'Arquivar'}</button>
          <button className="perigo" onClick={() => { setMenu(false); onAcao(c, 'excluir'); }}>Excluir</button>
        </div>
      )}
    </div>
  );
}
