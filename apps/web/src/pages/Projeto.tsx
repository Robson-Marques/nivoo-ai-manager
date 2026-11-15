import { ClipboardEvent, createContext, FormEvent, KeyboardEvent, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, fileToBase64, lerArquivo, nomeUsuario, urlDoArquivo, copiarTexto } from '../api';
import { useProjetos } from '../Layout';
import { Ajustes } from './Ajustes';
import { GitDoProjeto } from './Git';
import { Icone } from './Contas';
import { PedidosSsh } from './Ssh';
import { BotaoDiagnostico } from './Diagnostico';
import { SeletorModelo } from '../Pecas';

/**
 * Projeto: conversa com a IA escolhida, presa ao "fine-tune do projeto" (regras do modelo + regras do
 * projeto + conhecimento + memória). Pedido de trabalho vira plano; com "Fazer", é executado, conferido
 * por uma IA separada contra as regras e só então entra na pasta do projeto.
 */

export const NOME_IA: Record<string, string> = {
  'claude-code-cli': 'Claude (conta)',
  'claude-api': 'Claude (API)',
  'codex-cli': 'ChatGPT (conta)',
  'codex-api': 'ChatGPT (API)',
  'gemini-api': 'Gemini (API)',
};

/**
 * Grupos da memória, cada item em UM grupo só (a primeira regra que bater). Na tela, o que o usuário combinou
 * vem primeiro; as anotações de trabalho da IA ficam por último e recolhidas.
 */
type GrupoMemoria = { chave: string; titulo: string; filtro: (m: any) => boolean; recolhido?: boolean };
const MEMORIA_GRUPOS: GrupoMemoria[] = [
  { chave: 'decisoes', titulo: 'Decisões', filtro: (m) => m.category === 'DECISAO_APROVADA' },
  { chave: 'combinados', titulo: 'Combinados e próximos passos', filtro: (m) => m.category === 'PENDENCIA' },
  { chave: 'preferencias', titulo: 'Preferências e regras', filtro: (m) => m.category === 'ARQUITETURA_RESTRICOES' },
  { chave: 'sobre', titulo: 'Sobre o projeto', filtro: (m) => m.category === 'ESPECIFICACAO' },
  { chave: 'concluidos', titulo: 'Trabalhos concluídos', filtro: (m) => m.category === 'EVIDENCIA' },
  { chave: 'licoes', titulo: 'Lições', filtro: () => false },
  { chave: 'anotacoes', titulo: 'Anotações de trabalho da IA', filtro: () => false, recolhido: true },
];

/** Em qual grupo o item entra (origem vem antes da categoria: nota da IA nunca aparece como "resultado"). */
function grupoDaMemoria(m: any): string {
  if (m.references?.origem === 'notas-do-agente') return 'anotacoes';
  if (m.references?.origem === 'licao-automatica') return 'licoes';
  return MEMORIA_GRUPOS.find((g) => g.filtro(m))?.chave ?? 'sobre';
}

/** Texto do item: resultado conferido pelo sistema mostra a data; o resto, o conteúdo. */
function textoDaMemoria(m: any): string {
  if (grupoDaMemoria(m) === 'concluidos' && m.references?.gitCommit) {
    return `Concluído e conferido em ${new Date(m.createdAt).toLocaleDateString('pt-BR')}.`;
  }
  return m.content;
}

const MOTIVO: Record<string, string> = {
  CRITERIOS_NAO_ATENDIDOS: 'o resultado não passou na conferência',
  SEM_CRITERIOS: 'faltou definir como conferir o resultado',
  VERIFICACAO_IMPOSSIVEL: 'a conferência automática usa um programa que não existe no servidor (o trabalho feito está salvo)',
  REPETICAO_IMPRODUTIVA: 'a IA ficou repetindo sem avançar',
  LIMITE_TENTATIVAS: 'esgotou as tentativas',
  LIMITE_SESSOES: 'esgotou as tentativas',
  LIMITE_TEMPO: 'atingiu o limite de tempo',
  LIMITE_ORCAMENTO: 'atingiu a trava de gasto deste trabalho',
  LIMITE_ORCAMENTO_PROJETO: 'o projeto atingiu o limite de gasto',
  CONFLITO_INCORPORACAO: 'outro trabalho mexeu nos mesmos arquivos',
  INTERROMPIDO: 'foi interrompido',
  POLITICA: 'foi bloqueado por segurança',
  APROVACAO_REJEITADA: 'a confirmação foi recusada',
  FALHA_INFRAESTRUTURA: 'o servidor teve um problema',
};

/** IAs conectadas e a troca da IA do projeto (ex.: acabou o crédito de uma → continua com outra). */
interface IaCtx {
  contas: any[];
  atual: string;
  trocar: (id: string) => Promise<void>;
}
const IaContexto = createContext<IaCtx>({ contas: [], atual: '', trocar: async () => undefined });

/** Botões "Continuar com …" para as outras IAs conectadas. */
function TrocarIa({ depois }: { depois?: () => Promise<unknown> }) {
  const { contas, atual, trocar } = useContext(IaContexto);
  const outras = contas.filter((c) => c.conectado && c.id !== atual);
  if (!outras.length) return <div className="small"><Link to="/contas">Conectar outra IA em Conexões</Link></div>;
  return (
    <div className="row troca-ia">
      <span className="small">Continuar com:</span>
      {outras.map((c) => (
        <button key={c.id} className="secondary" onClick={async () => { await trocar(c.id); await depois?.(); }}>{c.nome}</button>
      ))}
    </div>
  );
}

/** A conferência das regras REPROVOU o trabalho (e não: parou por limite, IA indisponível etc.). */
function conferenciaFalhou(job: any): boolean {
  if (job.blockedReason && job.blockedReason !== 'CRITERIOS_NAO_ATENDIDOS') return false;
  const etapa = job.steps.find((s: any) => s.key === 'conferencia-regras');
  const outras = job.steps.filter((s: any) => s.key !== 'conferencia-regras').every((s: any) => s.status === 'CONCLUIDO');
  if (!etapa || !outras) return false;
  // A revisão terminou e disse "não conforme" (critério final reprovado) — ou a etapa dela não chegou ao fim.
  return etapa.status !== 'CONCLUIDO' || (job.criteria ?? []).some((c: any) => c.key === 'conferencia-regras' && c.status === 'REPROVADO');
}

/**
 * A revisão independente disse "não conforme": mostra o que ela apontou e as perguntas que só o usuário responde,
 * com a caixa de resposta (a IA aplica e a revisão confere de novo) e "Aceitar assim mesmo" (fica registrado quem
 * aceitou) — o trabalho nunca fica preso numa dúvida.
 */
function RevisaoParada({ projetoId, jobId, onMudou }: { projetoId: string; jobId: string; onMudou: () => void }) {
  const [r, setR] = useState<any | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [resposta, setResposta] = useState('');
  useEffect(() => {
    api(`/projects/${projetoId}/jobs/${jobId}/revisao`).then(setR).catch(() => setR(null));
  }, [projetoId, jobId]);
  if (!r) return null;
  return (
    <div className="revisao-parada small">
      {r.violacoes?.length > 0 && (
        <>
          <b>O que a revisão apontou</b>
          <ul>{r.violacoes.map((v: string, i: number) => <li key={i}>{v}</li>)}</ul>
        </>
      )}
      {r.perguntas?.length > 0 && (
        <>
          <b>Perguntas para você</b>
          <ol>
            {r.perguntas.map((q: any, i: number) => (
              <li key={i}>
                <span style={{ whiteSpace: 'pre-wrap' }}>{q.pergunta}</span>
                {q.opcoes?.length > 0 && (
                  <div className="opcoes-resposta">
                    {q.opcoes.map((o: string, k: number) => (
                      <button
                        key={k}
                        type="button"
                        className="secondary"
                        title="Usar esta resposta"
                        onClick={() => setResposta((atual) => `${atual ? `${atual.trimEnd()}\n` : ''}${r.perguntas.length > 1 ? `${i + 1}. ` : ''}${o}`)}
                      >
                        {o}
                      </button>
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ol>
          <span className="muted">Clique numa resposta sugerida (ou escreva a sua) e em "Responder e continuar".</span>
        </>
      )}
      {!r.violacoes?.length && !r.perguntas?.length && r.observacoes && <p>{r.observacoes}</p>}
      <label className="resposta-revisao">
        <b>Sua resposta</b>
        <textarea
          value={resposta}
          onChange={(e) => setResposta(e.target.value)}
          rows={4}
          placeholder="Responda aqui (pode responder só uma parte). A IA aplica a sua resposta no trabalho e a revisão confere de novo."
        />
      </label>
      <div className="row">
        <button
          disabled={ocupado || !resposta.trim()}
          onClick={async () => {
            setOcupado(true);
            setErro(null);
            try {
              await api(`/projects/${projetoId}/jobs/${jobId}/responder-revisao`, 'POST', { resposta, por: nomeUsuario() });
              setResposta('');
              onMudou();
            } catch (e: any) {
              setErro(e.message);
            } finally {
              setOcupado(false);
            }
          }}
        >
          Responder e continuar
        </button>
        <button
          className="secondary"
          disabled={ocupado}
          onClick={async () => {
            if (!window.confirm('Aceitar o trabalho como está, mesmo com a revisão dizendo "não conforme"? Fica registrado que foi você.')) return;
            setOcupado(true);
            setErro(null);
            try {
              await api(`/projects/${projetoId}/jobs/${jobId}/aceitar-revisao`, 'POST', { por: nomeUsuario() });
              onMudou();
            } catch (e: any) {
              setErro(e.message);
            } finally {
              setOcupado(false);
            }
          }}
        >
          Aceitar assim mesmo
        </button>
      </div>
      {erro && <div className="error">{erro}</div>}
    </div>
  );
}

export function Projeto() {
  const { pid, cid } = useParams();
  const nav = useNavigate();
  const { recarregar, recarregarConversas } = useProjetos();
  const [projeto, setProjeto] = useState<any>(null);
  const [painel, setPainel] = useState(true);
  const carregar = useCallback(async () => setProjeto(await api(`/projects/${pid}`)), [pid]);
  useEffect(() => {
    setProjeto(null);
    carregar().catch(() => undefined);
  }, [carregar]);
  // Sem conversa na rota: abre a mais recente ou começa uma nova.
  useEffect(() => {
    if (cid || !pid) return;
    (async () => {
      const lista = await api<any[]>(`/projects/${pid}/conversations`);
      const c = lista[0] ?? (await api(`/projects/${pid}/conversations`, 'POST', {}));
      if (!lista[0]) await recarregarConversas();
      nav(`/p/${pid}/c/${c.id}`, { replace: true });
    })().catch(() => undefined);
  }, [pid, cid, nav, recarregarConversas]);
  const mudou = useCallback(() => {
    carregar().catch(() => undefined);
    recarregar().catch(() => undefined);
  }, [carregar, recarregar]);
  if (!projeto || !cid) return null;
  return <Conversa key={cid} projeto={projeto} conversaId={cid} painel={painel} onPainel={() => setPainel(!painel)} onProjetoMudou={mudou} />;
}

function Conversa({ projeto, conversaId, painel, onPainel, onProjetoMudou }: { projeto: any; conversaId: string; painel: boolean; onPainel: () => void; onProjetoMudou: () => void }) {
  const { recarregarConversas } = useProjetos();
  const [conv, setConv] = useState<any>(null);
  const [texto, setTexto] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [versaoPainel, setVersaoPainel] = useState(0);
  const fim = useRef<HTMLDivElement>(null);
  const [contas, setContas] = useState<any[]>([]);
  useEffect(() => {
    api<any[]>('/accounts').then(setContas).catch(() => undefined);
  }, []);
  // Trocar a IA do projeto: o trabalho não terminado passa para a nova IA e continua (o servidor cuida).
  const trocar = useCallback(
    async (id: string) => {
      await api(`/projects/${projeto.id}`, 'PATCH', { provider: id });
      onProjetoMudou();
    },
    [projeto.id, onProjetoMudou],
  );

  const carregar = useCallback(async () => setConv(await api(`/projects/${projeto.id}/conversations/${conversaId}`)), [projeto.id, conversaId]);

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

  // Anexos da próxima mensagem: botão do clipe, colar (Ctrl+V) e arrastar para a conversa.
  const [anexos, setAnexos] = useState<File[]>([]);
  const [arrastando, setArrastando] = useState(false);
  const seletor = useRef<HTMLInputElement>(null);
  const anexar = (lista: File[]) => {
    setErro(null);
    const grandes = lista.filter((f) => f.size > 10 * 1024 * 1024);
    if (grandes.length) setErro(`Passa de 10 MB: ${grandes.map((f) => f.name).join(', ')}`);
    setAnexos((atuais) => [...atuais, ...lista.filter((f) => f.size <= 10 * 1024 * 1024)].slice(0, 10));
  };
  const colar = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const imagens = Array.from(e.clipboardData.items)
      .filter((i) => i.kind === 'file')
      .map((i, n) => {
        const f = i.getAsFile();
        if (!f) return null;
        const ext = (f.type.split('/')[1] || 'png').replace('jpeg', 'jpg');
        return f.name && f.name !== 'image.png' ? f : new File([f], `colado-${Date.now().toString(36)}-${n + 1}.${ext}`, { type: f.type });
      })
      .filter((f): f is File => !!f);
    if (imagens.length) {
      e.preventDefault();
      anexar(imagens);
    }
  };
  const enviando = useRef(false);
  const enviar = async (e?: FormEvent) => {
    e?.preventDefault();
    // Enter duas vezes (ou Enter + clique) enquanto envia: só um envio.
    if ((!texto.trim() && !anexos.length) || !conv || enviando.current || pensando) return;
    enviando.current = true;
    setOcupado(true);
    setErro(null);
    try {
      const lista = await Promise.all(anexos.map(async (f) => ({ nome: f.name, contentBase64: await fileToBase64(f) })));
      setConv(await api(`/projects/${projeto.id}/conversations/${conv.id}/messages`, 'POST', { content: texto, ...(lista.length ? { anexos: lista } : {}) }));
      setTexto('');
      setAnexos([]);
      recarregarConversas().catch(() => undefined); // título e ordem da lista
    } catch (err: any) {
      setErro(err.message);
    } finally {
      enviando.current = false;
      setOcupado(false);
    }
  };
  // Depois de trocar de IA: manda de novo a última pergunta, agora para a nova IA.
  const reenviar = async () => {
    const ultima = [...(conv?.messages ?? [])].reverse().find((m: any) => m.role === 'USUARIO');
    if (ultima) setConv(await api(`/projects/${projeto.id}/conversations/${conv.id}/messages`, 'POST', { content: ultima.content || 'Veja os anexos da minha mensagem anterior e responda.' }));
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

  // Avisos do sistema (ex.: "continuei com outra IA") aparecem; o registro técnico da aprovação, não.
  const mensagens: any[] = (conv?.messages ?? []).filter((m: any) => m.kind !== 'sistema' || !m.content.startsWith('Plano aprovado'));
  const ultimaIa = [...mensagens].reverse().find((m) => m.role === 'ASSISTENTE' && m.kind !== 'sistema');

  return (
    <IaContexto.Provider value={{ contas, atual: projeto.provider, trocar }}>
    <div className={painel ? 'conversa com-painel' : 'conversa'}>
      <div className="conversa-col">
        <header className="conversa-topo">
          <div>
            <h1>{projeto.name}</h1>
            <span className="tag">{projeto.area?.name}</span>{' '}
            <select className="seletor-ia" value={projeto.provider} onChange={(e) => trocar(e.target.value)} title="IA que trabalha neste projeto (pode trocar a qualquer momento)">
              {(contas.length ? contas : [{ id: projeto.provider, nome: NOME_IA[projeto.provider] ?? projeto.provider, conectado: true }]).map((c) => (
                <option key={c.id} value={c.id}>
                  IA: {c.nome}{c.conectado ? '' : ' (não conectada)'}
                </option>
              ))}
            </select>{' '}
            <SeletorModelo projeto={projeto} onMudou={onProjetoMudou} className="seletor-ia" />
            {projeto.archivedAt && <span className="tag">projeto arquivado</span>}
            {conv && <div className="muted small titulo-conversa">{conv.title}</div>}
          </div>
          <button className="secondary" onClick={onPainel}>{painel ? 'Ocultar painel' : 'Memória, arquivos e ajustes'}</button>
        </header>

        <div className="mensagens">
          {mensagens.length === 0 && (
            <div className="dica">
              <p>Nova conversa. A IA já conhece as regras, o conhecimento, os arquivos e a memória deste projeto.</p>
              <p>Conte o que você quer. Exemplos:</p>
              {['Crie a estrutura inicial do projeto seguindo o modelo', 'O que você sabe sobre este projeto?', 'Quais regras você segue aqui?'].map((s) => (
                <button key={s} className="chip" onClick={() => setTexto(s)}>{s}</button>
              ))}
            </div>
          )}
          {mensagens.map((m) => (
            <Mensagem key={m.id} m={m} projetoId={projeto.id} podeFazer={m === ultimaIa} onFazer={() => fazer(m)} onMudou={trabalhoMudou} onReenviar={m === ultimaIa ? reenviar : undefined} />
          ))}
          <div ref={fim} />
        </div>

        {conv?.archivedAt ? (
          <div className="entrada arquivada-aviso">
            <span>Conversa arquivada. Para continuar nela, desarquive.</span>
            <button
              onClick={async () => {
                await api(`/projects/${projeto.id}/conversations/${conv.id}`, 'PATCH', { archived: false });
                await carregar();
                recarregarConversas().catch(() => undefined);
              }}
            >
              Desarquivar
            </button>
          </div>
        ) : (
        <>
        <PedidosSsh projetoId={projeto.id} />
        <form
          className={arrastando ? 'entrada arrastando' : 'entrada'}
          onSubmit={enviar}
          onDragOver={(e) => {
            e.preventDefault();
            setArrastando(true);
          }}
          onDragLeave={() => setArrastando(false)}
          onDrop={(e) => {
            e.preventDefault();
            setArrastando(false);
            anexar(Array.from(e.dataTransfer.files));
          }}
        >
          {erro && <div className="error">{erro}</div>}
          {anexos.length > 0 && (
            <div className="anexos-pendentes">
              {anexos.map((f, i) => (
                <span key={`${f.name}-${i}`} className="anexo-chip">
                  {f.type.startsWith('image/') ? <MiniaturaLocal arquivo={f} /> : <span className="anexo-tipo">{(f.name.split('.').pop() ?? '').toUpperCase().slice(0, 4)}</span>}
                  <span className="anexo-nome">{f.name}</span>
                  <button type="button" className="link" aria-label={`Tirar ${f.name}`} onClick={() => setAnexos(anexos.filter((_, j) => j !== i))}>×</button>
                </span>
              ))}
            </div>
          )}
          <button type="button" className="clipe" title="Anexar imagem ou arquivo (também dá para colar ou arrastar)" aria-label="Anexar imagem ou arquivo" disabled={pensando || anexos.length >= 10} onClick={() => seletor.current?.click()}>
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m21 11-8.5 8.5a5 5 0 0 1-7-7L14 4a3.5 3.5 0 0 1 5 5l-8.5 8.5a2 2 0 0 1-3-3L15 7" /></svg>
          </button>
          <input
            ref={seletor}
            type="file"
            multiple
            hidden
            accept="image/png,image/jpeg,image/gif,image/webp,.mp3,.wav,.m4a,.aac,.ogg,.pdf,.docx,.xlsx,.pptx,.odt,.ods,.odp,.txt,.md,.csv,.json,.html,.xml,.yml,.yaml,.sql,.py,.ts,.tsx,.js,.jsx,.css,.sh"
            onChange={(e) => {
              anexar(Array.from(e.target.files ?? []));
              e.target.value = '';
            }}
          />
          <textarea
            rows={2}
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            onKeyDown={tecla}
            onPaste={colar}
            placeholder={pensando ? 'A IA está respondendo…' : 'Escreva sua mensagem (Enter envia, Shift+Enter quebra linha). Imagens: cole ou arraste aqui.'}
            disabled={pensando}
          />
          <button disabled={ocupado || pensando || (!texto.trim() && !anexos.length)}>{ocupado && anexos.length ? 'Enviando…' : 'Enviar'}</button>
        </form>
        </>
        )}
      </div>
      {painel && <Painel projeto={projeto} versao={versaoPainel} onProjetoMudou={onProjetoMudou} />}
    </div>
    </IaContexto.Provider>
  );
}

function Mensagem({ m, projetoId, podeFazer, onFazer, onMudou, onReenviar }: { m: any; projetoId: string; podeFazer: boolean; onFazer: () => Promise<void>; onMudou: () => void; onReenviar?: () => Promise<void> }) {
  const [indo, setIndo] = useState(false);
  if (m.kind === 'sistema') return <div className="aviso-sistema">{m.content}</div>;
  if (m.role === 'USUARIO') {
    return (
      <div className="msg eu">
        {m.attachments?.length > 0 && (
          <div className="anexos-msg">
            {m.attachments.map((a: any) => (
              <AnexoDaMensagem key={a.nome} a={a} url={`/projects/${projetoId}/conversations/${m.conversationId}/messages/${m.id}/anexos/${encodeURIComponent(a.nome)}`} />
            ))}
          </div>
        )}
        {m.content}
      </div>
    );
  }
  if (m.status === 'PENDENTE') return <Pensando desde={m.createdAt} andamento={m.andamento} projetoId={projetoId} conversaId={m.conversationId} onMudou={onMudou} />;
  if (m.status === 'ERRO') {
    return (
      <div className="msg ia erro">
        {m.content}
        {/conectada|indisponível|limite|Conexões/.test(m.content) && <TrocarIa depois={onReenviar} />}
      </div>
    );
  }
  return (
    <div className={m.kind === 'entrega' ? 'msg ia entrega' : 'msg ia'}>
      {m.kind === 'entrega' && <div className="selo-entrega">Entrega do trabalho</div>}
      <div className="texto">{m.content}</div>
      {m.kind === 'entrega' && m.jobId && <ArquivosDoTrabalho projetoId={projetoId} jobId={m.jobId} />}
      {m.kind === 'plano' && m.plan && (
        <div className="plano">
          <b>Posso fazer isto:</b>
          <ol>{(m.plan.steps ?? []).map((s: any, i: number) => <li key={i}>{s.title || s.key}</li>)}</ol>
          <p className="muted small">No fim, uma IA separada confere se tudo seguiu as regras do modelo e do projeto. Só então fica pronto.</p>
          {m.jobId ? (
            <Progresso projetoId={projetoId} jobId={m.jobId} onMudou={onMudou} />
          ) : podeFazer ? (
            <div className="row">
              <button disabled={indo} onClick={() => { setIndo(true); onFazer().finally(() => setIndo(false)); }}>{indo ? 'Começando…' : 'Fazer'}</button>
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

/**
 * Enquanto a IA responde: fases (preparando → lendo o projeto → escrevendo a resposta), barra animada, tempo e
 * a última atividade dela. Não há porcentagem real numa resposta; as fases mostram onde ela está.
 */
function Pensando({ desde, andamento, projetoId, conversaId, onMudou }: { desde: string; andamento?: string | null; projetoId: string; conversaId: string; onMudou: () => void }) {
  const [, setAgora] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setAgora(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const a = andamento ?? '';
  const fase = !a || /^(claude|codex|gemini) /.test(a) ? 0 : /^\[(agente|agent_message)\]/.test(a) ? 2 : 1;
  const fases = ['Preparando', 'Lendo o projeto', 'Escrevendo a resposta'];
  const seg = Math.max(0, Math.round((Date.now() - new Date(desde).getTime()) / 1000));
  return (
    <div className="msg ia pensando">
      <div className="andamento">
        <div className="andamento-topo">
          <span className="pulso" aria-hidden="true" />
          <b>Pensando</b>
          <span className="small">há {duracao(desde)}</span>
          <button className="link parar" onClick={async () => { await api(`/projects/${projetoId}/conversations/${conversaId}/cancel`, 'POST'); onMudou(); }}>parar</button>
        </div>
        <ol className="fases">
          {fases.map((f, i) => (
            <li key={f} className={i < fase ? 'feita' : i === fase ? 'agora' : ''}>{f}</li>
          ))}
        </ol>
        <div className="barra"><div className="atual" style={{ width: '100%' }} /></div>
        {a && fase > 0 && <div className="atividade small" title={a}>Agora: {atividadeLegivel(a)}</div>}
        {seg > 120 && <div className="muted small">Ler o projeto pode levar alguns minutos. Se passar de 15 minutos, ela avisa o que aconteceu.</div>}
      </div>
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
      {job.status === 'CONCLUIDO' && <ArquivosDoTrabalho projetoId={projetoId} jobId={jobId} />}
      {job.status === 'CONCLUIDO' && <VideosDoTrabalho projetoId={projetoId} steps={job.steps} />}
      {['EXECUTANDO', 'PENDENTE'].includes(job.status) && <Andamento job={job} feitas={feitas} atual={atual} />}
      {job.status === 'AGUARDANDO_RECURSO' && (
        <span>
          A IA ficou indisponível. Continua sozinho quando ela voltar, ou troque agora:
          <TrocarIa depois={carregar} />
          {job.statusDetail && <span className="muted small" style={{ display: 'block' }}>Motivo: {String(job.statusDetail).replace(/^etapa [^:]+:\s*/, '').slice(0, 400)}</span>}
        </span>
      )}
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
          Parei: {conferenciaFalhou(job) ? 'a revisão final precisa de você (veja abaixo)' : MOTIVO[job.blockedReason] ?? 'algo deu errado'}.{' '}
          <button className="secondary" onClick={() => acao(() => api(`/projects/${projetoId}/jobs/${jobId}/resume`, 'POST', { by: nomeUsuario() }))}>Tentar de novo</button>
          <TrocarIa depois={async () => { await api(`/projects/${projetoId}/jobs/${jobId}/resume`, 'POST', { by: nomeUsuario() }); await carregar(); }} />
          {conferenciaFalhou(job) && job.status === 'BLOQUEADO' && <RevisaoParada projetoId={projetoId} jobId={jobId} onMudou={carregar} />}
          <DetalhesDaParada job={job} />
        </span>
      )}
      {['EXECUTANDO', 'PENDENTE', 'AGUARDANDO_RECURSO'].includes(job.status) && (
        <button className="link" onClick={() => acao(() => api(`/projects/${projetoId}/jobs/${jobId}/interrupt`, 'POST', { by: nomeUsuario() }))}>parar</button>
      )}
      {erro && <div className="error">{erro}</div>}
    </div>
  );
}

function Painel({ projeto, versao, onProjetoMudou }: { projeto: any; versao: number; onProjetoMudou: () => void }) {
  const projetoId = projeto.id;
  const [aba, setAba] = useState<'memoria' | 'arquivos' | 'git' | 'ajustes'>('memoria');
  const [memoria, setMemoria] = useState<any[] | null>(null);
  const [abertos, setAbertos] = useState<string[]>([]); // grupos recolhidos que o usuário abriu
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
  // Vídeo abre no player; o resto como texto.
  const abrir = async (path: string) =>
    setAberto({ path, conteudo: /\.(mp4|webm|mov)$/i.test(path) ? '' : await lerArquivo(`/projects/${projetoId}/files/content?path=${encodeURIComponent(path)}`) });
  return (
    <aside className="painel">
      <div className="abas">
        <button className={aba === 'memoria' ? 'tab active' : 'tab'} onClick={() => setAba('memoria')}>Memória</button>
        <button className={aba === 'arquivos' ? 'tab active' : 'tab'} onClick={() => setAba('arquivos')}>Arquivos</button>
        <button className={aba === 'git' ? 'tab active' : 'tab'} onClick={() => setAba('git')}>Git</button>
        <button className={aba === 'ajustes' ? 'tab active' : 'tab'} onClick={() => setAba('ajustes')}>Ajustes</button>
      </div>
      {aba === 'git' && <GitDoProjeto projeto={projeto} onMudou={onProjetoMudou} />}
      {aba === 'ajustes' && <Ajustes projeto={projeto} onMudou={onProjetoMudou} />}
      {aba === 'memoria' && (
        <div className="lista">
          {memoria && memoria.length === 0 && <p className="muted small">Ainda nada. Conforme vocês conversam, decisões e informações importantes aparecem aqui.</p>}
          {memoria &&
            MEMORIA_GRUPOS.map((g) => {
              const itens = memoria.filter((m) => grupoDaMemoria(m) === g.chave).sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
              if (!itens.length) return null;
              const fechado = g.recolhido && !abertos.includes(g.chave);
              return (
                <div key={g.chave} className="mem-grupo">
                  <button className="mem-cabeca" onClick={() => setAbertos(abertos.includes(g.chave) ? abertos.filter((x) => x !== g.chave) : [...abertos, g.chave])} disabled={!g.recolhido}>
                    <h3>{g.titulo}</h3>
                    <span className="mem-conta">{itens.length}</span>
                    {g.recolhido && <Icone nome={fechado ? 'abaixo' : 'acima'} />}
                  </button>
                  {fechado ? (
                    <p className="muted small mem-dica">Progresso que a IA anota enquanto trabalha (para continuar de onde parou). Clique para ver.</p>
                  ) : (
                    itens.map((m) => <ItemDaMemoria key={m.id} m={m} texto={textoDaMemoria(m)} onEsquecer={() => esquecer(m)} />)
                  )}
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
            {/\.(mp4|webm|mov)$/i.test(aberto.path) ? <VideoDoProjeto projetoId={projetoId} caminho={aberto.path} /> : <pre className="texto-arquivo">{aberto.conteudo}</pre>}
          </div>
        </div>
      )}
    </aside>
  );
}

/** Miniatura de uma imagem ainda não enviada. */
function MiniaturaLocal({ arquivo }: { arquivo: File }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    const u = URL.createObjectURL(arquivo);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [arquivo]);
  return url ? <img src={url} alt="" className="anexo-mini" /> : null;
}

/** Anexo já enviado: imagem com miniatura; documento (guardado como texto) em etiqueta. Clique abre. */
function AnexoDaMensagem({ a, url }: { a: any; url: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    if (a.tipo !== 'imagem') return;
    let u: string | null = null;
    let saiu = false;
    urlDoArquivo(url).then((x) => {
      if (saiu) {
        if (x) URL.revokeObjectURL(x); // a tela já fechou: não guarda o arquivo na memória
        return;
      }
      u = x;
      setSrc(x);
    });
    return () => {
      saiu = true;
      if (u) URL.revokeObjectURL(u);
    };
  }, [a.tipo, url]);
  const abrir = async () => {
    if (src) return void window.open(src, '_blank', 'noopener');
    const u = await urlDoArquivo(url);
    if (!u) return;
    window.open(u, '_blank', 'noopener');
    setTimeout(() => URL.revokeObjectURL(u), 60_000);
  };
  if (a.tipo === 'imagem') {
    return (
      <button type="button" className="anexo-imagem" title={a.nome} onClick={abrir}>
        {src ? <img src={src} alt={a.nome} /> : <span className="anexo-nome">{a.nome}</span>}
      </button>
    );
  }
  return (
    <button type="button" className="anexo-chip claro" title={a.de ? `${a.de} (guardado como texto)` : a.nome} onClick={abrir}>
      <span className="anexo-tipo">{((a.de ?? a.nome).split('.').pop() ?? '').toUpperCase().slice(0, 4)}</span>
      <span className="anexo-nome">{a.de ?? a.nome}</span>
    </button>
  );
}

/** "Ver o que aconteceu": motivo registrado e as últimas tentativas (com o erro de cada uma), copiável. */
function DetalhesDaParada({ job }: { job: any }) {
  const [aberto, setAberto] = useState(false);
  const [copiado, setCopiado] = useState(false);
  const tentativas = [...(job.attempts ?? [])].sort((a: any, b: any) => b.number - a.number).slice(0, 4);
  const etapa = (id: string) => job.steps.find((x: any) => x.id === id);
  const linhas = [
    job.statusDetail ? `Motivo: ${job.statusDetail}` : null,
    ...tentativas.map((a: any) => {
      const e = etapa(a.stepId);
      const fim = a.stopReason ? `, término: ${a.stopReason}` : '';
      const msg = (a.error || a.output || '').trim().slice(-600);
      return `Tentativa ${a.number} — etapa "${e?.title || e?.key || ''}" com ${a.provider} (${a.status}${fim})${msg ? `:\n${msg}` : ''}`;
    }),
  ].filter(Boolean) as string[];
  if (!linhas.length) return null;
  return (
    <div className="detalhes-parada">
      <button className="link" onClick={() => setAberto(!aberto)}>{aberto ? 'ocultar detalhes' : 'ver o que aconteceu'}</button>
      {aberto && (
        <>
          <pre>{linhas.join('\n\n')}</pre>
          <button
            className="link"
            onClick={async () => {
              await copiarTexto(linhas.join('\n\n'));
              setCopiado(true);
              setTimeout(() => setCopiado(false), 2000);
            }}
          >
            {copiado ? 'copiado' : 'copiar'}
          </button>
        </>
      )}
      <div className="row small" style={{ marginTop: 4 }}>
        <BotaoDiagnostico url={`/projects/${job.projectId}/jobs/${job.id}/diagnostico`} nomeArquivo={`diagnostico-trabalho-${String(job.id).slice(0, 8)}.md`} />
        <span className="muted">para o suporte: todas as tentativas, conferências, log e IAs, sem senhas</span>
      </div>
    </div>
  );
}

/** Item da memória: abre para ler inteiro (texto selecionável), copia e esquece. */
function ItemDaMemoria({ m, texto, onEsquecer }: { m: any; texto: string; onEsquecer: () => void }) {
  const [aberto, setAberto] = useState(false);
  const [copiado, setCopiado] = useState(false);
  return (
    <div className={aberto ? 'mem-item aberto' : 'mem-item'}>
      <button className="mem-corpo" onClick={() => setAberto(!aberto)} title={aberto ? 'Recolher' : 'Ler inteiro'}>
        <b>{m.title}</b>
        <span className="small">{texto}</span>
      </button>
      <div className="mem-acoes">
        <button
          className="icone-botao"
          title={copiado ? 'Copiado' : 'Copiar'}
          aria-label="Copiar"
          onClick={async () => {
            await copiarTexto(`${m.title}\n${texto}`);
            setCopiado(true);
            setTimeout(() => setCopiado(false), 2000);
          }}
        >
          <Icone nome={copiado ? 'ok' : 'copiar'} />
        </button>
        <button className="icone-botao perigo" title="Esquecer (a IA deixa de considerar)" aria-label="Esquecer" onClick={onEsquecer}>
          <Icone nome="lixeira" />
        </button>
      </div>
    </div>
  );
}

/** Há quanto tempo, em português curto: "40 s", "12 min", "1 h 05 min". */
function duracao(desde: string | Date): string {
  const s = Math.max(0, Math.round((Date.now() - new Date(desde).getTime()) / 1000));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`;
}

/** Linha do log em português simples (o que a IA está fazendo agora). */
function atividadeLegivel(msg: string): string {
  return msg
    .replace(/\S*\/worktrees\/[^/\s]+\//g, '') // caminho completo da pasta do trabalho → só o do projeto
    .replace(/\S*\/conversa-[^/\s]+\//g, '')
    .replace(/^.*executar_no_servidor.*$/s, 'esperando a SUA permissão para rodar um comando no servidor (veja o pedido acima da caixa de mensagem)')
    .replace(/^\[ferramenta\] (Read|read_file|ReadFile)\b/i, 'lendo')
    .replace(/^\[ferramenta\] (Grep|Glob|search_file_content|glob)\b/i, 'procurando')
    .replace(/^\[ferramenta\] (Edit|Write|MultiEdit|write_file|replace)\b/i, 'escrevendo')
    .replace(/^\[ferramenta\] /, 'usando ')
    .replace(/^\[comando\] /, 'rodando: ')
    .replace(/^\[arquivos\] /, 'arquivos: ')
    .replace(/^\[agente\] |^\[agent_message\] |^\[reasoning\] /, '')
    .replace(/^Tentativa #(\d+).*/, 'sessão $1 começou')
    .replace(/^(claude|codex|gemini) .*/s, 'a IA começou a trabalhar (lendo o projeto)…')
    .replace(/^\[sessão [^\]]*\] término=.*/, 'sessão encerrada; conferindo o resultado…');
}

/** Motivo do fim de uma sessão, curto e legível. */
function motivoLegivel(erro: string): string {
  return erro
    .replace(/^verificação da etapa falhou \(exit \d+\):\s*/, 'a conferência da etapa ainda não passou — ')
    .replace(/^sessão encerrada \(([^)]*)\) sem concluir a etapa/, 'a sessão acabou ($1); continua na próxima')
    .slice(0, 220);
}

/** Trabalho rodando: barra pelas etapas (a etapa atual animada), tempo, sessão e a última atividade da IA. */
function Andamento({ job, feitas, atual }: { job: any; feitas: number; atual: any }) {
  const total = job.steps.length || 1;
  const pct = Math.round((feitas / total) * 100);
  // Só a rodada atual da etapa: uma etapa que já concluiu antes e voltou a rodar (ex.: a revisão depois de uma
  // correção) não herda o tempo nem os erros das rodadas passadas — antes aparecia um erro de horas atrás.
  const todas = atual ? [...job.attempts.filter((a: any) => a.stepId === atual.id)].sort((a: any, b: any) => a.number - b.number) : [];
  const ultimoSucesso = todas.map((a: any) => a.status).lastIndexOf('SUCESSO');
  const tentativas = todas.slice(ultimoSucesso + 1);
  const inicio = tentativas[0]?.startedAt;
  const ult = job.ultimaAtividade;
  // Por que a sessão IMEDIATAMENTE anterior desta rodada terminou (ex.: a conferência cobrou um arquivo que não existe).
  const previa = tentativas.length > 1 ? tentativas[tentativas.length - 2] : null;
  const anterior = previa?.endedAt && previa.error ? previa : null;
  const parado = ult && Date.now() - new Date(ult.em).getTime() > 10 * 60_000;
  return (
    <div className="andamento">
      <div className="andamento-topo">
        <span className="pulso" aria-hidden="true" />
        <b>{pct}%</b>
        <span>
          Etapa {Math.min(feitas + 1, total)} de {total}
          {atual ? `: ${atual.title || atual.key}` : ''}
        </span>
      </div>
      <div className="barra" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        <div className="feito" style={{ width: `${pct}%` }} />
        {feitas < total && <div className="atual" style={{ width: `${100 / total}%` }} />}
      </div>
      <div className="muted small">
        {job.status === 'PENDENTE' || !inicio ? 'Na fila para começar…' : `Rodando há ${duracao(inicio)}${tentativas.length > 1 ? ` · sessão ${tentativas.length} (continua de onde parou)` : ''}`}
      </div>
      {anterior?.error && (
        <div className="muted small" title={anterior.error}>
          A sessão anterior terminou sem concluir: {motivoLegivel(anterior.error)}
        </div>
      )}
      {ult && (
        <div className={parado ? 'atividade parada small' : 'atividade small'} title={ult.mensagem}>
          {parado ? `Sem novidade há ${duracao(ult.em)} (leituras longas podem demorar). Última: ` : `Agora (há ${duracao(ult.em)}): `}
          {atividadeLegivel(ult.mensagem)}
        </div>
      )}
    </div>
  );
}

/** Vídeos do trabalho: o vídeo completo (cenas juntadas) primeiro; as cenas soltas ficam recolhidas. */
function VideosDoTrabalho({ projetoId, steps }: { projetoId: string; steps: any[] }) {
  const [abertas, setAbertas] = useState(false); // cenas só baixam se abrir
  const completos = steps.filter((x) => x.provider === 'juntar-videos' && x.status === 'CONCLUIDO' && x.providerOptions?.arquivo);
  const cenas = steps.filter((x) => x.provider === 'gemini-video' && x.providerOptions?.arquivo);
  if (!completos.length) return <>{cenas.map((x) => <VideoDoProjeto key={x.id} projetoId={projetoId} caminho={x.providerOptions.arquivo} />)}</>;
  return (
    <>
      {completos.map((x) => <VideoDoProjeto key={x.id} projetoId={projetoId} caminho={x.providerOptions.arquivo} />)}
      {cenas.length > 0 && (
        <details className="cenas-soltas" onToggle={(e) => setAbertas((e.target as HTMLDetailsElement).open)}>
          <summary className="small">Ver as {cenas.length} cenas separadas</summary>
          {abertas && cenas.map((x) => <VideoDoProjeto key={x.id} projetoId={projetoId} caminho={x.providerOptions.arquivo} />)}
        </details>
      )}
    </>
  );
}

/** Vídeo da pasta do projeto, com player (o arquivo vem pela API com o token, se houver). */
export function VideoDoProjeto({ projetoId, caminho }: { projetoId: string; caminho: string }) {
  const [src, setSrc] = useState<string | null>(null);
  const [falhou, setFalhou] = useState(false);
  useEffect(() => {
    let u: string | null = null;
    let saiu = false;
    urlDoArquivo(`/projects/${projetoId}/files/content?path=${encodeURIComponent(caminho)}`, 'video/mp4').then((x) => {
      if (saiu) {
        if (x) URL.revokeObjectURL(x);
        return;
      }
      u = x;
      if (x) setSrc(x);
      else setFalhou(true);
    });
    return () => {
      saiu = true;
      if (u) URL.revokeObjectURL(u);
    };
  }, [projetoId, caminho]);
  return (
    <div className="video-pronto">
      {src ? <video src={src} controls playsInline preload="metadata" /> : <span className="muted small">{falhou ? `Não foi possível abrir ${caminho}.` : 'Carregando o vídeo…'}</span>}
      {src && (
        <a className="small" href={src} download={caminho.split('/').pop()}>
          baixar {caminho}
        </a>
      )}
    </div>
  );
}

/** Arquivos que o trabalho criou/alterou/apagou: clique abre para ler (texto) ou assistir (vídeo). */
function ArquivosDoTrabalho({ projetoId, jobId }: { projetoId: string; jobId: string }) {
  const [lista, setLista] = useState<any[] | null>(null);
  const [resultados, setResultados] = useState<any[]>([]);
  const [aberto, setAberto] = useState<string | null>(null);
  const [resultadoAberto, setResultadoAberto] = useState<any | null>(null);
  useEffect(() => {
    api<any[]>(`/projects/${projetoId}/jobs/${jobId}/arquivos`).then(setLista).catch(() => setLista([]));
    api<any[]>(`/projects/${projetoId}/jobs/${jobId}/resultados`)
      .then((r) => setResultados(r.filter((x) => !/^conferencia-regras\.json$|^respostas-do-usuario\.md$/.test(x.nome))))
      .catch(() => setResultados([]));
  }, [projetoId, jobId]);
  if (!lista?.length && !resultados.length) return null;
  const nome: Record<string, string> = { A: 'novo', M: 'alterado', D: 'apagado', R: 'movido' };
  const visiveis = (lista ?? []).slice(0, 40);
  const tamanho = (b: number) => (b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : b >= 1024 ? `${Math.round(b / 1024)} KB` : `${b} B`);
  return (
    <div className="arquivos-trabalho">
      {resultados.length > 0 && (
        <>
          <span className="small"><b>Resultados do trabalho ({resultados.length})</b> — relatórios e documentos que a IA entregou:</span>
          <div className="arquivos-chips">
            {resultados.map((r) => (
              <button key={r.id} className="arquivo-chip resultado" onClick={() => setResultadoAberto(r)} title={`${tamanho(r.bytes)} · sha256 ${String(r.sha256).slice(0, 12)}`}>
                {r.nome} <span className="muted">· {tamanho(r.bytes)}</span>
              </button>
            ))}
          </div>
        </>
      )}
      {resultadoAberto && <ResultadoAberto projetoId={projetoId} r={resultadoAberto} onFechar={() => setResultadoAberto(null)} />}
      {!lista?.length ? null : <>
      <span className="small">Arquivos deste trabalho ({lista.length}):</span>
      <div className="arquivos-chips">
        {visiveis.map((f) =>
          f.status === 'D' ? (
            <span key={f.path} className="arquivo-chip apagado" title="apagado (continua no histórico do git)">{f.path}</span>
          ) : (
            <button key={f.path} className="arquivo-chip" onClick={() => setAberto(f.path)} title={f.de ? `movido de ${f.de}` : nome[f.status]}>
              {f.path} <span className="muted">· {nome[f.status] ?? f.status}</span>
            </button>
          ),
        )}
        {lista.length > visiveis.length && <span className="muted small">… e mais {lista.length - visiveis.length} (veja na aba Arquivos)</span>}
      </div>
      </>}
      {aberto && <ArquivoAberto projetoId={projetoId} caminho={aberto} onFechar={() => setAberto(null)} />}
    </div>
  );
}

/** Um resultado do trabalho (relatório, inventário…): ler, copiar e baixar. */
function ResultadoAberto({ projetoId, r, onFechar }: { projetoId: string; r: any; onFechar: () => void }) {
  const [texto, setTexto] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);
  const url = `/projects/${projetoId}/artifacts/${r.id}`;
  useEffect(() => {
    lerArquivo(url).then(setTexto);
  }, [url]);
  return (
    <div className="modal-fundo" onClick={onFechar}>
      <div className="modal largo" onClick={(e) => e.stopPropagation()}>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2>{r.nome}</h2>
          <span className="row">
            {texto !== null && (
              <button className="secondary" onClick={async () => { await copiarTexto(texto); setCopiado(true); setTimeout(() => setCopiado(false), 2000); }}>
                {copiado ? 'Copiado' : 'Copiar'}
              </button>
            )}
            <button
              className="secondary"
              onClick={async () => {
                const u = await urlDoArquivo(url);
                if (!u) return;
                const a = document.createElement('a');
                a.href = u;
                a.download = String(r.nome).split('/').pop() ?? 'resultado';
                a.click();
                setTimeout(() => URL.revokeObjectURL(u), 10_000);
              }}
            >
              Baixar
            </button>
            <button className="secondary" onClick={onFechar}>Fechar</button>
          </span>
        </div>
        <pre className="texto-arquivo">{texto ?? 'Carregando…'}</pre>
      </div>
    </div>
  );
}

/** Janela para ler um arquivo da pasta do projeto (ou assistir, se for vídeo). */
export function ArquivoAberto({ projetoId, caminho, onFechar }: { projetoId: string; caminho: string; onFechar: () => void }) {
  const [texto, setTexto] = useState<string | null>(null);
  const video = /\.(mp4|webm|mov)$/i.test(caminho);
  const [copiado, setCopiado] = useState(false);
  useEffect(() => {
    if (!video) lerArquivo(`/projects/${projetoId}/files/content?path=${encodeURIComponent(caminho)}`).then(setTexto);
  }, [projetoId, caminho, video]);
  return (
    <div className="modal-fundo" onClick={onFechar}>
      <div className="modal largo" onClick={(e) => e.stopPropagation()}>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2>{caminho}</h2>
          <span className="row">
            {!video && texto !== null && (
              <button className="secondary" onClick={async () => { await copiarTexto(texto); setCopiado(true); setTimeout(() => setCopiado(false), 2000); }}>
                {copiado ? 'Copiado' : 'Copiar'}
              </button>
            )}
            <button className="secondary" onClick={onFechar}>Fechar</button>
          </span>
        </div>
        {video ? <VideoDoProjeto projetoId={projetoId} caminho={caminho} /> : <pre className="texto-arquivo">{texto ?? 'Carregando…'}</pre>}
      </div>
    </div>
  );
}
