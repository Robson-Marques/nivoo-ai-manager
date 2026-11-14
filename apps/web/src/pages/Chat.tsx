import { FormEvent, KeyboardEvent, useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, getToken } from '../api';
import { Modelos } from './Modelos';

/**
 * Tela principal: um chat por projeto. Por baixo, cada pedido de trabalho vira um job verificado,
 * e o que é dito na conversa vira memória do projeto. Nada de jargão técnico aqui.
 */

const TIPOS: Array<{ key: string; nome: string; desc: string }> = [
  { key: 'generica', nome: 'Geral', desc: 'Qualquer assunto' },
  { key: 'web', nome: 'Web', desc: 'Sites e páginas' },
  { key: 'imagem', nome: 'Imagem', desc: 'Artes e identidade visual' },
  { key: 'video', nome: 'Vídeo', desc: 'Roteiros e vídeos' },
  { key: 'mercado', nome: 'Mercado', desc: 'Pesquisa de trading (WIN/WDO)' },
];

const MEMORIA_GRUPOS: Array<{ titulo: string; filtro: (m: any) => boolean }> = [
  { titulo: 'Decisões', filtro: (m) => m.category === 'DECISAO_APROVADA' },
  { titulo: 'Preferências e regras', filtro: (m) => m.category === 'ARQUITETURA_RESTRICOES' },
  { titulo: 'Informações do projeto', filtro: (m) => m.category === 'ESPECIFICACAO' },
  { titulo: 'Combinados e próximos passos', filtro: (m) => m.category === 'PENDENCIA' && !['licao-automatica', 'notas-do-agente'].includes(m.references?.origem) },
  { titulo: 'Lições aprendidas', filtro: (m) => m.references?.origem === 'licao-automatica' },
  { titulo: 'Resultados', filtro: (m) => ['EVIDENCIA', 'RESULTADO_VALIDADO'].includes(m.category) },
  { titulo: 'Anotações da IA', filtro: (m) => m.references?.origem === 'notas-do-agente' },
];

const MOTIVO: Record<string, string> = {
  CRITERIOS_NAO_ATENDIDOS: 'o resultado não passou na conferência',
  SEM_CRITERIOS: 'faltou definir como conferir o resultado',
  REPETICAO_IMPRODUTIVA: 'a IA ficou repetindo sem avançar',
  LIMITE_TENTATIVAS: 'esgotou as tentativas',
  LIMITE_SESSOES: 'esgotou as tentativas',
  LIMITE_TEMPO: 'atingiu o limite de tempo',
  LIMITE_ORCAMENTO: 'atingiu o limite de custo',
  LIMITE_ORCAMENTO_PROJETO: 'o projeto atingiu o limite de custo',
  CONFLITO_INCORPORACAO: 'outro trabalho mexeu nos mesmos arquivos',
  INTERROMPIDO: 'foi interrompido',
  POLITICA: 'foi bloqueado por segurança',
  APROVACAO_REJEITADA: 'a aprovação foi recusada',
  FALHA_INFRAESTRUTURA: 'o servidor teve um problema',
};

function nomeUsuario(): string {
  try {
    return localStorage.getItem('nivoo_nome') || 'usuário';
  } catch {
    return 'usuário';
  }
}

export function Chat({ tela }: { tela?: 'modelos' }) {
  const { pid } = useParams();
  const nav = useNavigate();
  const [projetos, setProjetos] = useState<any[] | null>(null);
  const [novo, setNovo] = useState(false);
  const [painel, setPainel] = useState(true);

  const carregar = useCallback(async () => setProjetos(await api<any[]>('/projects')), []);
  useEffect(() => {
    carregar().catch(() => setProjetos([]));
  }, [carregar]);
  useEffect(() => {
    if (!tela && !pid && projetos && projetos.length) nav(`/p/${projetos[0].id}`, { replace: true });
  }, [tela, pid, projetos, nav]);

  const grupos = new Map<string, any[]>();
  for (const p of projetos ?? []) {
    const g = p.area?.name ?? 'Projetos';
    grupos.set(g, [...(grupos.get(g) ?? []), p]);
  }
  const atual = projetos?.find((p) => p.id === pid);

  return (
    <div className="chat-app">
      <aside className="chat-side">
        <div className="brand">Nivoo</div>
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
          <Link to="/modelos">Modelos (padrões e regras)</Link>
          <Link to="/conectores">Contas de IA</Link>
          <Link to="/avancado">Modo avançado</Link>
        </div>
      </aside>

      <main className="chat-main">
        {tela === 'modelos' ? (
          <Modelos />
        ) : atual ? (
          <Conversa key={atual.id} projeto={atual} painel={painel} onPainel={() => setPainel(!painel)} />
        ) : (
          <div className="chat-vazio">
            <h1>Bem-vindo ao Nivoo</h1>
            <p>Crie um projeto e converse. Tudo o que for decidido fica guardado na memória do projeto.</p>
            <button onClick={() => setNovo(true)}>Criar meu primeiro projeto</button>
          </div>
        )}
      </main>

      {novo && (
        <NovoProjeto
          onFechar={() => setNovo(false)}
          onCriado={async (id) => {
            setNovo(false);
            await carregar();
            nav(`/p/${id}`);
          }}
        />
      )}
    </div>
  );
}

function NovoProjeto({ onFechar, onCriado }: { onFechar: () => void; onCriado: (id: string) => void }) {
  const [nome, setNome] = useState('');
  const [sobre, setSobre] = useState('');
  const [tipo, setTipo] = useState('generica');
  const [opcoes, setOpcoes] = useState(TIPOS);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  useEffect(() => {
    // Modelos já criados (inclusive os seus, com pasta de padrões) + modelos prontos ainda não usados.
    api<any[]>('/areas')
      .then((areas) => {
        const usados = new Set(areas.map((a) => a.slug));
        const meus = areas.map((a) => ({ key: a.slug, nome: a.name, desc: TIPOS.find((t) => t.key === a.slug)?.desc ?? a.description?.slice(0, 60) ?? '' }));
        setOpcoes([...meus, ...TIPOS.filter((t) => !usados.has(t.key))]);
      })
      .catch(() => undefined);
  }, []);
  const criar = async (e: FormEvent) => {
    e.preventDefault();
    setOcupado(true);
    setErro(null);
    try {
      const existe = opcoes.find((o) => o.key === tipo && !TIPOS.some((t) => t.key === o.key));
      const p = await api('/projects', 'POST', existe ? { name: nome, description: sobre, area: tipo } : { name: nome, description: sobre, tipo });
      onCriado(p.id);
    } catch (err: any) {
      setErro(err.message);
    } finally {
      setOcupado(false);
    }
  };
  return (
    <div className="modal-fundo" onClick={onFechar}>
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={criar}>
        <h2>Novo projeto</h2>
        <label>Nome do projeto<input autoFocus value={nome} onChange={(e) => setNome(e.target.value)} required placeholder="Ex.: Cardápio da Pizzaria do Zé" /></label>
        <label>Sobre o que é este projeto?<textarea rows={3} value={sobre} onChange={(e) => setSobre(e.target.value)} placeholder="Conte em poucas palavras o objetivo. Isso vira a primeira memória do projeto." /></label>
        <div className="tipos">
          {opcoes.map((t) => (
            <button type="button" key={t.key} className={tipo === t.key ? 'tipo on' : 'tipo'} onClick={() => setTipo(t.key)}>
              <b>{t.nome}</b>
              <span>{t.desc}</span>
            </button>
          ))}
        </div>
        {erro && <div className="error">{erro}</div>}
        <div className="row fim">
          <button type="button" className="secondary" onClick={onFechar}>Cancelar</button>
          <button disabled={ocupado || !nome.trim()}>Criar projeto</button>
        </div>
      </form>
    </div>
  );
}

function Conversa({ projeto, painel, onPainel }: { projeto: any; painel: boolean; onPainel: () => void }) {
  const [conv, setConv] = useState<any>(null);
  const [texto, setTexto] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [versaoPainel, setVersaoPainel] = useState(0);
  const fim = useRef<HTMLDivElement>(null);

  const carregar = useCallback(async () => {
    let lista = await api<any[]>(`/projects/${projeto.id}/conversations`);
    if (!lista.length) lista = [await api(`/projects/${projeto.id}/conversations`, 'POST', { title: 'Conversa' })];
    setConv(await api(`/projects/${projeto.id}/conversations/${lista[0].id}`));
  }, [projeto.id]);

  useEffect(() => {
    carregar().catch((e) => setErro(e.message));
  }, [carregar]);

  // Quando um trabalho termina: recarrega a conversa e o painel (arquivos novos, memória nova).
  const trabalhoMudou = useCallback(() => {
    carregar().catch(() => undefined);
    setVersaoPainel((v) => v + 1);
  }, [carregar]);

  const pensando = conv?.messages?.some((m: any) => m.status === 'PENDENTE');
  useEffect(() => {
    const t = setInterval(() => carregar().catch(() => undefined), pensando ? 2000 : 8000);
    return () => clearInterval(t);
  }, [carregar, pensando]);
  const qtd = conv?.messages?.length ?? 0;
  useEffect(() => {
    fim.current?.scrollIntoView({ behavior: 'smooth' });
    setVersaoPainel((v) => v + 1);
  }, [qtd, pensando]);

  const enviar = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!texto.trim() || !conv) return;
    setOcupado(true);
    setErro(null);
    try {
      setConv(await api(`/projects/${projeto.id}/conversations/${conv.id}/messages`, 'POST', { content: texto }));
      setTexto('');
    } catch (err: any) {
      setErro(err.message);
    } finally {
      setOcupado(false);
    }
  };
  const tecla = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      enviar();
    }
  };
  const fazer = async (m: any) => {
    setErro(null);
    try {
      setConv(await api(`/projects/${projeto.id}/conversations/${conv.id}/messages/${m.id}/approve`, 'POST', { decidedBy: nomeUsuario() }));
    } catch (err: any) {
      setErro(err.message);
    }
  };

  const mensagens: any[] = (conv?.messages ?? []).filter((m: any) => m.kind !== 'sistema');
  const ultimaIa = [...mensagens].reverse().find((m) => m.role === 'ASSISTENTE');

  return (
    <div className={painel ? 'conversa com-painel' : 'conversa'}>
      <div className="conversa-col">
        <header className="conversa-topo">
          <div>
            <h1>{projeto.name}</h1>
            <span className="tag">{projeto.area?.name}</span>
          </div>
          <button className="secondary" onClick={onPainel}>{painel ? 'Ocultar arquivos e memória' : 'Arquivos e memória'}</button>
        </header>

        <div className="mensagens">
          {mensagens.length === 0 && (
            <div className="dica">
              <p>Conte o que você quer neste projeto. Exemplos:</p>
              {['Crie a estrutura de pastas e um guia do projeto', 'Quero 3 ideias de post para o Instagram da pizzaria', 'Resuma o que já temos guardado'].map((s) => (
                <button key={s} className="chip" onClick={() => setTexto(s)}>{s}</button>
              ))}
            </div>
          )}
          {mensagens.map((m) => (
            <Mensagem key={m.id} m={m} projetoId={projeto.id} podeFazer={m === ultimaIa} onFazer={() => fazer(m)} onMudou={trabalhoMudou} />
          ))}
          <div ref={fim} />
        </div>

        <form className="entrada" onSubmit={enviar}>
          {erro && <div className="error">{erro}</div>}
          <textarea
            rows={2}
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            onKeyDown={tecla}
            placeholder={pensando ? 'A IA está respondendo…' : 'Escreva sua mensagem (Enter envia, Shift+Enter quebra linha)'}
            disabled={pensando}
          />
          <button disabled={ocupado || pensando || !texto.trim()}>Enviar</button>
        </form>
      </div>
      {painel && <Painel projetoId={projeto.id} versao={versaoPainel} />}
    </div>
  );
}

function Mensagem({ m, projetoId, podeFazer, onFazer, onMudou }: { m: any; projetoId: string; podeFazer: boolean; onFazer: () => void; onMudou: () => void }) {
  if (m.role === 'USUARIO') return <div className="msg eu">{m.content}</div>;
  if (m.status === 'PENDENTE') return <div className="msg ia pensando">Pensando<span className="dots">…</span></div>;
  if (m.status === 'ERRO') {
    return (
      <div className="msg ia erro">
        {m.content}
        {/indisponível/.test(m.content) && <div><Link to="/conectores">Conectar uma conta de IA</Link></div>}
      </div>
    );
  }
  return (
    <div className="msg ia">
      <div className="texto">{m.content}</div>
      {m.kind === 'plano' && m.plan && (
        <div className="plano">
          <b>Posso fazer isto:</b>
          <ol>{(m.plan.steps ?? []).map((s: any, i: number) => <li key={i}>{s.title || s.key}</li>)}</ol>
          {m.jobId ? (
            <Progresso projetoId={projetoId} jobId={m.jobId} onMudou={onMudou} />
          ) : podeFazer ? (
            <div className="row">
              <button onClick={onFazer}>Fazer</button>
              <span className="muted small">ou responda abaixo para ajustar o plano</span>
            </div>
          ) : (
            <span className="muted small">Proposta anterior (não executada).</span>
          )}
        </div>
      )}
    </div>
  );
}

function Progresso({ projetoId, jobId, onMudou }: { projetoId: string; jobId: string; onMudou: () => void }) {
  const [job, setJob] = useState<any>(null);
  const [erro, setErro] = useState<string | null>(null);
  const carregar = useCallback(async () => setJob(await api(`/projects/${projetoId}/jobs/${jobId}`)), [projetoId, jobId]);
  const terminal = job && ['CONCLUIDO', 'BLOQUEADO', 'FALHOU'].includes(job.status);
  useEffect(() => {
    carregar().catch(() => undefined);
    if (terminal) return;
    const t = setInterval(() => carregar().catch(() => undefined), 3000);
    return () => clearInterval(t);
  }, [carregar, terminal]);
  useEffect(() => {
    if (terminal) onMudou();
  }, [terminal, onMudou]);
  if (!job) return <div className="progresso">…</div>;
  const feitas = job.steps.filter((s: any) => s.status === 'CONCLUIDO').length;
  const atual = job.steps.find((s: any) => s.status !== 'CONCLUIDO');
  const acao = async (fn: () => Promise<any>) => {
    setErro(null);
    try {
      await fn();
      await carregar();
    } catch (e: any) {
      setErro(e.message);
    }
  };
  const aprovacao = job.approvals?.find((a: any) => a.status === 'PENDENTE');
  return (
    <div className={`progresso p-${job.status}`}>
      {job.status === 'CONCLUIDO' && <span>Pronto. O resultado já está na pasta do projeto.</span>}
      {['EXECUTANDO', 'PENDENTE'].includes(job.status) && (
        <span>Trabalhando… {feitas} de {job.steps.length} feito(s){atual ? ` — agora: ${atual.title || atual.key}` : ''}</span>
      )}
      {job.status === 'AGUARDANDO_RECURSO' && <span>Esperando a IA ficar disponível (limite de uso ou conta desconectada). Continua sozinho.</span>}
      {job.status === 'AGUARDANDO_APROVACAO' && (
        <span>
          Preciso da sua confirmação{aprovacao ? `: ${aprovacao.description}` : ''}.{' '}
          {aprovacao && (
            <>
              <button onClick={() => acao(() => api(`/approvals/${aprovacao.id}/decide`, 'POST', { decision: 'APROVADO', decidedBy: nomeUsuario() }))}>Pode seguir</button>{' '}
              <button className="danger" onClick={() => acao(() => api(`/approvals/${aprovacao.id}/decide`, 'POST', { decision: 'REJEITADO', decidedBy: nomeUsuario() }))}>Não</button>
            </>
          )}
        </span>
      )}
      {['BLOQUEADO', 'FALHOU'].includes(job.status) && (
        <span>
          Parei: {MOTIVO[job.blockedReason] ?? 'algo deu errado'}.{' '}
          <button className="secondary" onClick={() => acao(() => api(`/projects/${projetoId}/jobs/${jobId}/resume`, 'POST', { by: nomeUsuario() }))}>Tentar de novo</button>
        </span>
      )}
      {['EXECUTANDO', 'PENDENTE', 'AGUARDANDO_RECURSO'].includes(job.status) && (
        <button className="link" onClick={() => acao(() => api(`/projects/${projetoId}/jobs/${jobId}/interrupt`, 'POST', { by: nomeUsuario() }))}>parar</button>
      )}
      <Link className="small detalhes" to={`/execucao/${projetoId}/${jobId}`}>detalhes técnicos</Link>
      {erro && <div className="error">{erro}</div>}
    </div>
  );
}

function Painel({ projetoId, versao }: { projetoId: string; versao: number }) {
  const [aba, setAba] = useState<'memoria' | 'arquivos'>('memoria');
  const [memoria, setMemoria] = useState<any[] | null>(null);
  const [arquivos, setArquivos] = useState<any[] | null>(null);
  const [aberto, setAberto] = useState<{ path: string; conteudo: string } | null>(null);
  const carregar = useCallback(async () => {
    const [m, a] = await Promise.all([api<any[]>(`/projects/${projetoId}/memory`), api<any>(`/projects/${projetoId}/files`)]);
    setMemoria(m);
    setArquivos(a.arquivos.filter((f: any) => !f.path.startsWith('.')));
  }, [projetoId]);
  useEffect(() => {
    carregar().catch(() => undefined);
  }, [carregar, versao]);
  const esquecer = async (m: any) => {
    if (!window.confirm(`Esquecer "${m.title}"? A IA deixará de considerar isso.`)) return;
    await api(`/projects/${projetoId}/memory/${m.id}?by=${encodeURIComponent(nomeUsuario())}`, 'DELETE');
    carregar();
  };
  const abrir = async (path: string) => {
    const token = getToken();
    const res = await fetch(`/api/projects/${projetoId}/files/content?path=${encodeURIComponent(path)}`, { headers: token ? { authorization: `Bearer ${token}` } : {} });
    setAberto({ path, conteudo: res.ok ? await res.text() : 'Não foi possível abrir este arquivo.' });
  };
  return (
    <aside className="painel">
      <div className="abas">
        <button className={aba === 'memoria' ? 'tab active' : 'tab'} onClick={() => setAba('memoria')}>O que o projeto lembra</button>
        <button className={aba === 'arquivos' ? 'tab active' : 'tab'} onClick={() => setAba('arquivos')}>Arquivos</button>
      </div>
      {aba === 'memoria' && (
        <div className="lista">
          {memoria && memoria.length === 0 && <p className="muted small">Ainda nada. Conforme vocês conversam, decisões e informações importantes aparecem aqui.</p>}
          {memoria &&
            MEMORIA_GRUPOS.map((g) => {
              const itens = memoria.filter(g.filtro);
              if (!itens.length) return null;
              return (
                <div key={g.titulo} className="mem-grupo">
                  <h3>{g.titulo}</h3>
                  {itens.map((m) => (
                    <div key={m.id} className="mem-item">
                      <div>
                        <b>{m.title}</b>
                        <div className="small">{m.content}</div>
                      </div>
                      <button className="link" title="Esquecer" onClick={() => esquecer(m)}>esquecer</button>
                    </div>
                  ))}
                </div>
              );
            })}
        </div>
      )}
      {aba === 'arquivos' && (
        <div className="lista">
          {arquivos && arquivos.length === 0 && <p className="muted small">A pasta do projeto ainda está vazia. Peça na conversa para a IA criar algo.</p>}
          {arquivos?.map((f) => (
            <button key={f.path} className="arquivo" onClick={() => abrir(f.path)}>{f.path}</button>
          ))}
        </div>
      )}
      {aberto && (
        <div className="modal-fundo" onClick={() => setAberto(null)}>
          <div className="modal largo" onClick={(e) => e.stopPropagation()}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <h2>{aberto.path}</h2>
              <button className="secondary" onClick={() => setAberto(null)}>Fechar</button>
            </div>
            <pre className="json" style={{ maxHeight: '70vh' }}>{aberto.conteudo}</pre>
          </div>
        </div>
      )}
    </aside>
  );
}
