import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useNavigate, useParams } from 'react-router-dom';
import { api } from './api';
import { NovoProjeto } from './pages/NovoProjeto';

interface Ctx {
  projetos: any[] | null;
  recarregar: () => Promise<void>;
  novoProjeto: () => void;
}

const ProjetosCtx = createContext<Ctx>({ projetos: null, recarregar: async () => undefined, novoProjeto: () => undefined });
export const useProjetos = () => useContext(ProjetosCtx);

/** Estrutura de todas as telas: projetos na lateral (agrupados por modelo) e o conteúdo ao lado. */
export function Layout() {
  const { pid } = useParams();
  const nav = useNavigate();
  const [projetos, setProjetos] = useState<any[] | null>(null);
  const [novo, setNovo] = useState(false);
  const recarregar = useCallback(async () => setProjetos(await api<any[]>('/projects')), []);
  useEffect(() => {
    recarregar().catch(() => setProjetos([]));
  }, [recarregar]);

  const grupos = new Map<string, any[]>();
  for (const p of projetos ?? []) {
    const g = p.area?.name ?? 'Projetos';
    grupos.set(g, [...(grupos.get(g) ?? []), p]);
  }

  return (
    <ProjetosCtx.Provider value={{ projetos, recarregar, novoProjeto: () => setNovo(true) }}>
      <div className="chat-app">
        <aside className="chat-side">
          <Link to="/" className="brand">Nivoo</Link>
          <button className="novo" onClick={() => setNovo(true)}>+ Novo projeto</button>
          <nav className="proj-list">
            {[...grupos.entries()].map(([g, ps]) => (
              <div key={g}>
                <div className="grupo">{g}</div>
                {ps.map((p) => (
                  <Link key={p.id} to={`/p/${p.id}`} className={p.id === pid ? 'proj on' : 'proj'}>{p.name}</Link>
                ))}
              </div>
            ))}
          </nav>
          <div className="side-foot">
            <NavLink to="/modelos">Modelos</NavLink>
            <NavLink to="/contas">Contas de IA</NavLink>
          </div>
        </aside>
        <main className="chat-main">
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
