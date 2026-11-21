import { ClipboardEvent, createContext, FormEvent, KeyboardEvent, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { BotaoDitado } from '../Ditado';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, enviarVideo, enviarZipDeVideos, fileToBase64, lerArquivo, nomeUsuario, urlDoArquivo, urlAutenticada, copiarTexto } from '../api';
import { useProjetos } from '../Layout';
import { Ajustes } from './Ajustes';
import { GitDoProjeto } from './Git';
import { Icone } from './Contas';
import { PedidosSsh } from './Ssh';
import { BotaoDiagnostico } from './Diagnostico';
import { SeletorModelo } from '../Pecas';

/**
 * Projeto: conversa com a IA escolhida, presa ao "fine-tune do projeto" (regras do agente + regras do
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

const MAX_TEXTO_MENSAGEM = 20_000;

function arquivoDeTextoLongo(conteudo: string, existentes: File[]): File {
  const instante = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, '');
  const usados = new Set(existentes.map((f) => f.name.toLowerCase()));
  let nome = `mensagem-longa-${instante}.txt`;
  let n = 2;
  while (usados.has(nome.toLowerCase())) nome = `mensagem-longa-${instante}-${n++}.txt`;
  return new File([conteudo], nome, { type: 'text/plain;charset=utf-8' });
}

const avisoDeTextoLongo = (nome: string) => `O texto completo desta mensagem está no anexo "${nome}". Leia o arquivo integralmente antes de responder.`;

/**
 * Memória do projeto (o que o usuário combinou), em grupos. A memória interna do processo (notas das sessões da IA,
 * lições de falhas, registro de trabalhos) não se mistura: fica num bloco recolhido no fim.
 */
type GrupoMemoria = { chave: string; titulo: string; categorias: string[] };
const MEMORIA_GRUPOS: GrupoMemoria[] = [
  { chave: 'decisoes', titulo: 'Decisões', categorias: ['DECISAO_APROVADA'] },
  { chave: 'preferencias', titulo: 'Preferências e regras', categorias: ['ARQUITETURA_RESTRICOES'] },
  { chave: 'sobre', titulo: 'Sobre o projeto', categorias: ['ESPECIFICACAO'] },
  { chave: 'pendencias', titulo: 'Pendências', categorias: ['PENDENCIA'] },
  { chave: 'evidencias', titulo: 'Evidências', categorias: ['EVIDENCIA'] },
];

function tipoInterno(m: any): string {
  if (m.references?.origem === 'licao-automatica') return 'Lição de falha';
  if (m.references?.origem === 'notas-do-agente') return 'Nota da IA';
  if (m.category === 'EVIDENCIA') return 'Trabalho concluído';
  return 'Processo';
}

/** Memória interna do processo: só leitura, recolhida, carregada ao abrir. */
function MemoriaInterna({ projetoId, versao }: { projetoId: string; versao: number }) {
  const [aberta, setAberta] = useState(false);
  const [itens, setItens] = useState<any[] | null>(null);
  useEffect(() => {
    if (aberta) api<any[]>(`/projects/${projetoId}/memory?camada=INTERNA`).then(setItens).catch(() => setItens([]));
  }, [aberta, projetoId, versao]);
  return (
    <div className="mem-grupo mem-interna">
      <button className="mem-cabeca" onClick={() => setAberta(!aberta)}>
        <h3>Memória interna do processo</h3>
        <Icone nome={aberta ? 'acima' : 'abaixo'} />
      </button>
      {!aberta ? (
        <p className="muted small mem-dica">Notas das sessões da IA, lições de falhas e registro de trabalhos. A IA usa; não faz parte do que foi combinado.</p>
      ) : (
        <>
          {itens === null && <p className="muted small">Carregando…</p>}
          {itens?.length === 0 && <p className="muted small">Vazia.</p>}
          {itens?.slice(0, 200).map((m) => (
            <div key={m.id} className="mem-item interna">
              <div className="mem-corpo">
                <b>{m.title}</b>
                <span className="small muted">{tipoInterno(m)} · {new Date(m.createdAt).toLocaleString('pt-BR')}</span>
                <span className="small">{String(m.content).slice(0, 400)}</span>
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
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
  INTERROMPIDO: 'foi interrompido pelo sistema',
  FALHA_INTERNA: 'deu um erro interno no Nivoo (o diagnóstico abaixo mostra qual)',
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
                {String(q.pergunta).length > 450 ? (
                  <details>
                    <summary>{String(q.pergunta).split('\n').find((linha: string) => linha.trim())?.slice(0, 180) ?? 'Detalhes da pergunta'}</summary>
                    <div style={{ whiteSpace: 'pre-wrap', marginTop: 8 }}>{q.pergunta}</div>
                  </details>
                ) : <span style={{ whiteSpace: 'pre-wrap' }}>{q.pergunta}</span>}
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
  const { recarregar, recarregarConversas, projetos } = useProjetos();
  const [projeto, setProjeto] = useState<any>(null);
  // Painel da direita (Memória, Arquivos, Git, Ajustes): aberto/fechado e a aba ficam lembrados neste navegador.
  const [painel, setPainelBruto] = useState(() => lerPreferencia('nivoo_painel', '1') === '1');
  const [aba, setAbaBruta] = useState<AbaPainel>(() => (lerPreferencia('nivoo_aba', 'memoria') as AbaPainel));
  const setPainel = (v: boolean) => {
    setPainelBruto(v);
    gravarPreferencia('nivoo_painel', v ? '1' : '0');
  };
  const abrirAba = (a: AbaPainel) => {
    setAbaBruta(a);
    gravarPreferencia('nivoo_aba', a);
    setPainel(true);
  };
  const carregar = useCallback(async () => setProjeto(await api(`/projects/${pid}`)), [pid]);
  useEffect(() => {
    setProjeto(null);
    carregar().catch(() => undefined);
  }, [carregar]);
  // A lista do menu mudou (ex.: projeto desarquivado pela janela "Arquivados"): a tela do projeto acompanha.
  useEffect(() => {
    if (projetos) carregar().catch(() => undefined);
  }, [projetos, carregar]);
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
  return <Conversa key={cid} projeto={projeto} conversaId={cid} painel={painel} onPainel={() => setPainel(!painel)} aba={aba} onAba={abrirAba} onProjetoMudou={mudou} />;
}

function Conversa({ projeto, conversaId, painel, onPainel, aba, onAba, onProjetoMudou }: { projeto: any; conversaId: string; painel: boolean; onPainel: () => void; aba: AbaPainel; onAba: (a: AbaPainel) => void; onProjetoMudou: () => void }) {
  const { recarregarConversas } = useProjetos();
  const [conv, setConv] = useState<any>(null);
  const [texto, setTexto] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [versaoPainel, setVersaoPainel] = useState(0);
  // Prévia do projeto ao lado da conversa (tela dividida); lembrado neste navegador.
  const [previa, setPreviaBruta] = useState(() => lerPreferencia('nivoo_previa', '0') === '1');
  const setPrevia = (v: boolean) => {
    setPreviaBruta(v);
    gravarPreferencia('nivoo_previa', v ? '1' : '0');
    if (v && painel) onPainel(); // tela dividida: o painel recolhe para a barra de cima
  };
  const [contas, setContas] = useState<any[]>([]);
  const [areasDisponiveis, setAreasDisponiveis] = useState<Array<{ id: string; slug: string; name: string }>>([]);
  const [trocandoArea, setTrocandoArea] = useState(false);
  useEffect(() => {
    api<any[]>('/accounts').then(setContas).catch(() => undefined);
    api<Array<{ id: string; slug: string; name: string }>>('/areas')
      .then(setAreasDisponiveis).catch(() => undefined);
  }, []);
  const trocarArea = useCallback(async (slug: string) => {
    if (!slug || slug === projeto.area?.slug || trocandoArea) return;
    setTrocandoArea(true);
    setErro(null);
    try {
      await api(`/projects/${projeto.id}`, 'PATCH', { base: slug });
      onProjetoMudou();
    } catch (e: any) {
      setErro(e?.message ?? 'Não foi possível alterar a área do projeto.');
    } finally {
      setTrocandoArea(false);
    }
  }, [projeto.id, projeto.area?.slug, trocandoArea, onProjetoMudou]);
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
  // Conversa "grudada no fim": ao abrir e enquanto as partes que carregam depois (progresso, arquivos, resultados,
  // imagens, cartões) crescem, a lista fica no fim — a não ser que a pessoa tenha rolado para cima para ler.
  const lista = useRef<HTMLDivElement>(null);
  const noFim = useRef(true);
  // No recarregamento, o navegador tenta restaurar a posição antiga do <div> DEPOIS que o React já o levou ao
  // fim. Enquanto a tela inicial está assentando, ignoramos essa restauração automática. Só um gesto real da pessoa
  // (roda do mouse, toque ou arraste) solta a fixação antes; depois disso, rolar para cima continua funcionando.
  const fixandoAbertura = useRef(true);
  const timerFixacao = useRef<number | null>(null);
  const irProFim = () => {
    const el = lista.current;
    if (el) el.scrollTop = el.scrollHeight;
  };
  const agendarFimDaFixacao = () => {
    if (timerFixacao.current !== null) window.clearTimeout(timerFixacao.current);
    timerFixacao.current = window.setTimeout(() => {
      fixandoAbertura.current = false;
      timerFixacao.current = null;
    }, 1200);
  };
  const manterNoFim = () => {
    noFim.current = true;
    // Duas pinturas: cobre tanto a renderização do React quanto a restauração de scroll feita pelo navegador.
    window.requestAnimationFrame(() => {
      irProFim();
      window.requestAnimationFrame(irProFim);
    });
    if (fixandoAbertura.current) agendarFimDaFixacao();
  };
  const usuarioQuerRolar = () => {
    fixandoAbertura.current = false;
    if (timerFixacao.current !== null) window.clearTimeout(timerFixacao.current);
    timerFixacao.current = null;
  };
  const aoRolar = () => {
    const el = lista.current;
    if (fixandoAbertura.current) {
      manterNoFim();
      return;
    }
    if (el) noFim.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  };
  const temConversa = !!conv;
  useEffect(() => {
    const el = lista.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    fixandoAbertura.current = true;
    noFim.current = true;
    const ro = new ResizeObserver(() => {
      if (fixandoAbertura.current || noFim.current) manterNoFim();
    });
    const observarFilhos = () => {
      for (const c of Array.from(el.children)) ro.observe(c);
    };
    observarFilhos();
    const mo = new MutationObserver(observarFilhos);
    mo.observe(el, { childList: true });
    manterNoFim();
    return () => {
      ro.disconnect();
      mo.disconnect();
      if (timerFixacao.current !== null) window.clearTimeout(timerFixacao.current);
      timerFixacao.current = null;
    };
  }, [temConversa]);
  useEffect(() => {
    // Mensagem nova: vai para o fim se a pessoa já estava lá ou se foi ela que escreveu.
    const ultima = conv?.messages?.[qtd - 1];
    if (noFim.current || ultima?.role === 'USUARIO') {
      noFim.current = true;
      manterNoFim();
    }
    setVersaoPainel((v) => v + 1);
  }, [qtd, pensando]);

  // Anexos da próxima mensagem: botão do clipe, colar (Ctrl+V) e arrastar para a conversa.
  const [anexos, setAnexos] = useState<File[]>([]);
  // Mídia (vídeo/áudio) anexada À MENSAGEM: sobe por streaming para a mídia do projeto (arquivo grande, sem o limite
  // de 10 MB do anexo) e vai JUNTO com a mensagem — aparece no balão, como a imagem. Sem bandeja separada na tela.
  const EH_MIDIA = /\.(mp4|mov|webm|mkv|m4v|wav|mp3|m4a|aac|ogg|flac)$/i;
  const EH_AUDIO = /\.(wav|mp3|m4a|aac|ogg|flac)$/i;
  const ehMidia = (f: File) => EH_MIDIA.test(f.name) || f.type.startsWith('video/') || f.type.startsWith('audio/');
  type MidiaComposer = { id: string; nome: string; pct: number; caminho?: string; audio?: boolean; erro?: string };
  const [midiaAnexada, setMidiaAnexada] = useState<MidiaComposer[]>([]);
  const midiaSubindo = midiaAnexada.some((m) => !m.caminho && !m.erro);
  const temMidiaEnviada = midiaAnexada.some((m) => !!m.caminho && !m.erro);
  const novoIdDeMidia = () => ((crypto as any)?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`);
  const tirarMidia = (m: MidiaComposer) => setMidiaAnexada((a) => a.filter((x) => x.id !== m.id));
  const anexarMidia = async (lista: File[]) => {
    for (const f of lista) {
      if (midiaAnexada.some((x) => x.nome === f.name && !x.erro)) {
        setErro(`"${f.name}" já está anexado nesta mensagem.`);
        continue;
      }
      // O id permanece estável enquanto o objeto no estado é substituído a cada atualização. Comparar pela
      // identidade do objeto fazia somente o PRIMEIRO evento de progresso funcionar; os seguintes procuravam a
      // referência antiga e a tela ficava eternamente em 1%, 3%, 19% etc., mesmo com o upload avançando.
      const item: MidiaComposer = { id: novoIdDeMidia(), nome: f.name, pct: 0, audio: EH_AUDIO.test(f.name) || f.type.startsWith('audio/') };
      setMidiaAnexada((a) => [...a, item]);
      try {
        const r = await enviarVideo(projeto.id, f, (pct) => setMidiaAnexada((a) => a.map((x) => (x.id === item.id ? { ...x, pct: Math.max(x.pct, pct) } : x))));
        setMidiaAnexada((a) => a.map((x) => (x.id === item.id ? { ...x, pct: 100, caminho: r.caminho, nome: r.nome } : x)));
      } catch (err: any) {
        setMidiaAnexada((a) => a.map((x) => (x.id === item.id ? { ...x, erro: err.message } : x)));
      }
    }
  };
  const anexarZip = async (lista: File[]) => {
    for (const f of lista) {
      const item: MidiaComposer = { id: novoIdDeMidia(), nome: f.name, pct: 0 };
      setMidiaAnexada((a) => [...a, item]);
      try {
        const r = await enviarZipDeVideos(projeto.id, f, (pct) => setMidiaAnexada((a) => a.map((x) => (x.id === item.id ? { ...x, pct: Math.max(x.pct, pct) } : x))));
        const novos: MidiaComposer[] = (r.adicionados ?? []).map((v: any) => ({ id: novoIdDeMidia(), nome: v.nome, pct: 100, caminho: v.caminho, audio: EH_AUDIO.test(v.nome) }));
        setMidiaAnexada((a) => [...a.filter((x) => x.id !== item.id), ...novos]);
        if (!novos.length) setErro(`Nenhum vídeo no .zip "${f.name}".`);
      } catch (err: any) {
        setMidiaAnexada((a) => a.map((x) => (x.id === item.id ? { ...x, erro: err.message } : x)));
      }
    }
  };
  const [arrastando, setArrastando] = useState(false);
  const seletor = useRef<HTMLInputElement>(null);
  const anexar = (lista: File[]) => {
    setErro(null);
    // .zip com vários vídeos: sobe por streaming e o servidor extrai todos de uma vez (viram anexos da mensagem).
    const zips = lista.filter((f) => /\.zip$/i.test(f.name) || f.type === 'application/zip' || f.type === 'application/x-zip-compressed');
    if (zips.length) anexarZip(zips);
    // Vídeo E áudio (trilha/narração) sobem para a mídia do projeto e ficam anexados À MENSAGEM (vão junto no envio);
    // o resto segue como anexo normal (até 10 MB).
    const midias = lista.filter((f) => !zips.includes(f) && ehMidia(f));
    if (midias.length) anexarMidia(midias);
    const outros = lista.filter((f) => !zips.includes(f) && !ehMidia(f));
    const grandes = outros.filter((f) => f.size > 10 * 1024 * 1024);
    if (grandes.length) setErro(`Passa de 10 MB: ${grandes.map((f) => f.name).join(', ')}`);
    setAnexos((atuais) => [...atuais, ...outros.filter((f) => f.size <= 10 * 1024 * 1024)].slice(0, 10));
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
      return;
    }
    const colado = e.clipboardData.getData('text/plain');
    if (colado) {
      const inicio = e.currentTarget.selectionStart ?? texto.length;
      const fim = e.currentTarget.selectionEnd ?? inicio;
      const completo = `${texto.slice(0, inicio)}${colado}${texto.slice(fim)}`;
      if (completo.length > MAX_TEXTO_MENSAGEM) {
        e.preventDefault();
        if (anexos.length >= 10) {
          setErro('O texto passa de 20.000 caracteres e precisa virar anexo, mas esta mensagem já tem 10 anexos. Tire um deles e cole novamente.');
          return;
        }
        const arquivo = arquivoDeTextoLongo(completo, anexos);
        setAnexos((atuais) => [...atuais, arquivo]);
        setTexto(avisoDeTextoLongo(arquivo.name));
        setErro(null);
      }
    }
  };
  const enviando = useRef(false);
  const pararDitado = useRef<(() => void) | null>(null);
  const enviar = async (e?: FormEvent) => {
    e?.preventDefault();
    pararDitado.current?.(); // se estava ditando, para antes de enviar (senão o texto volta preso na caixa)
    // Enter duas vezes (ou Enter + clique) enquanto envia: só um envio.
    if ((!texto.trim() && !anexos.length && !midiaAnexada.length) || !conv || enviando.current || pensando) return;
    // Espera a mídia terminar de subir antes de mandar (senão a mensagem vai sem o vídeo/áudio).
    if (midiaAnexada.some((m) => !m.caminho && !m.erro)) {
      setErro('Espere o vídeo/áudio terminar de anexar para enviar.');
      return;
    }
    enviando.current = true;
    setOcupado(true);
    setErro(null);
    try {
      let textoEnviar = texto;
      let anexosEnviar = anexos;
      // Protege também texto digitado/ditado, ou colado por um navegador que não disparou o tratamento acima.
      if (textoEnviar.length > MAX_TEXTO_MENSAGEM) {
        if (anexosEnviar.length >= 10) throw new Error('O texto passa de 20.000 caracteres e precisa virar anexo, mas esta mensagem já tem 10 anexos. Tire um deles e envie novamente.');
        const arquivo = arquivoDeTextoLongo(textoEnviar, anexosEnviar);
        anexosEnviar = [...anexosEnviar, arquivo];
        textoEnviar = avisoDeTextoLongo(arquivo.name);
        setAnexos(anexosEnviar);
        setTexto(textoEnviar);
      }
      const lista = await Promise.all(anexosEnviar.map(async (f) => ({ nome: f.name, contentBase64: await fileToBase64(f) })));
      const midia = midiaAnexada.filter((m) => m.caminho && !m.erro).map((m) => ({ nome: m.nome, caminho: m.caminho }));
      setConv(await api(`/projects/${projeto.id}/conversations/${conv.id}/messages`, 'POST', { content: textoEnviar, ...(lista.length ? { anexos: lista } : {}), ...(midia.length ? { midia } : {}) }));
      setTexto('');
      setAnexos([]);
      setMidiaAnexada([]);
      recarregarConversas().catch(() => undefined); // título e ordem da lista
    } catch (err: any) {
      setErro(err.message);
    } finally {
      enviando.current = false;
      setOcupado(false);
    }
  };
  // Respostas dos cartões de pergunta da IA: viram uma mensagem do usuário (a IA continua dali).
  const responderPerguntas = async (resposta: string) => {
    if (!conv || enviando.current) return;
    enviando.current = true;
    setOcupado(true);
    setErro(null);
    try {
      setConv(await api(`/projects/${projeto.id}/conversations/${conv.id}/messages`, 'POST', { content: resposta }));
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
  const mensagensBase: any[] = (conv?.messages ?? []).filter((m: any) => m.kind !== 'sistema' || !m.content.startsWith('Plano aprovado'));
  // Se a IA repete o texto da última entrega antes de propor um plano,
  // renderizar a entrega UMA vez e conservar somente a proposta nova.
  // Não descarta mensagens ou anexos persistidos no banco.
  const mensagens: any[] = mensagensBase.map((m, i) => {
    const anterior = mensagensBase[i - 1];
    if (m.kind !== 'plano' || anterior?.kind !== 'entrega' || !m.content || !anterior.content) return m;
    const a = String(anterior.content).trim();
    const b = String(m.content).trim();
    if (b === a || b.startsWith(a + '\n')) return { ...m, content: b.slice(a.length).trim() };
    // Algumas respostas repetem a entrega com espaços diferentes.
    if (b.replace(/\s+/g, ' ').startsWith(a.replace(/\s+/g, ' ')) && b.length < a.length + 250)
      return { ...m, content: '' };
    return m;
  });
  const ultimaIa = [...mensagens].reverse().find((m) => m.role === 'ASSISTENTE' && m.kind !== 'sistema');

  return (
    <IaContexto.Provider value={{ contas, atual: projeto.provider, trocar }}>
    <div className={`conversa${painel ? ' com-painel' : ''}${previa ? ' com-previa' : ''}`}>
      <div className="conversa-col">
        <header className="conversa-topo">
          <div>
            <h1>{projeto.name}</h1>
            <select
              className="seletor-ia"
              aria-label="Área ou agente do projeto"
              title="Mudar o agente deste projeto sem excluir arquivos, conversas ou resultados"
              value={projeto.area?.slug ?? ''}
              disabled={trocandoArea || !areasDisponiveis.length}
              onChange={(e) => void trocarArea(e.target.value)}
            >
              {areasDisponiveis.length
                ? areasDisponiveis.map((a) => <option key={a.id} value={a.slug}>{a.name}</option>)
                : <option value={projeto.area?.slug ?? ''}>{projeto.area?.name ?? 'Área'}</option>}
            </select>{' '}
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
          <div className="acoes-topo">
            {/* Painel recolhido: as abas ficam aqui em cima e abrem o painel direto nelas. */}
            {!painel && (
              <div className="abas-topo">
                {ABAS_PAINEL.map((a) => (
                  <button key={a.chave} className="link" onClick={() => onAba(a.chave)}>{a.titulo}</button>
                ))}
              </div>
            )}
            <button className={previa ? 'secondary ativo' : 'secondary'} onClick={() => setPrevia(!previa)} title="Ver o site ou sistema do projeto rodando, ao lado da conversa">{previa ? 'Fechar prévia' : 'Ver o projeto'}</button>
            <button className="secondary" onClick={onPainel} title={painel ? 'Recolher o painel (as abas ficam aqui em cima)' : 'Abrir o painel'}>{painel ? 'Recolher painel ›' : '‹ Painel'}</button>
          </div>
        </header>

        <div className="mensagens" ref={lista} onScroll={aoRolar} onWheel={usuarioQuerRolar} onTouchStart={usuarioQuerRolar} onPointerDown={usuarioQuerRolar}>
          {mensagens.length === 0 && (
            <div className="dica">
              <p>Nova conversa. A IA já conhece as regras, o conhecimento, os arquivos e a memória deste projeto.</p>
              <p>Conte o que você quer. Exemplos:</p>
              {['Crie a estrutura inicial do projeto seguindo o agente', 'O que você sabe sobre este projeto?', 'Quais regras você segue aqui?'].map((s) => (
                <button key={s} className="chip" onClick={() => setTexto(s)}>{s}</button>
              ))}
            </div>
          )}
          {mensagens.map((m) => (
            <Mensagem
              key={m.id}
              m={m}
              projetoId={projeto.id}
              podeFazer={m === ultimaIa}
              onFazer={() => fazer(m)}
              onMudou={trabalhoMudou}
              onReenviar={m === ultimaIa ? reenviar : undefined}
              respondida={mensagens.some((x: any) => x.role === 'USUARIO' && new Date(x.createdAt) > new Date(m.createdAt))}
              onResponder={responderPerguntas}
            />
          ))}
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
          {(anexos.length > 0 || midiaAnexada.length > 0) && (
            <div className="anexos-pendentes">
              <span className="anexos-rotulo muted small">{anexos.length + midiaAnexada.length === 1 ? 'Anexado nesta mensagem:' : `${anexos.length + midiaAnexada.length} anexos nesta mensagem:`}</span>
              {anexos.map((f, i) => (
                <span key={`a-${f.name}-${i}`} className="anexo-chip">
                  {f.type.startsWith('image/') ? <MiniaturaLocal arquivo={f} /> : <span className="anexo-tipo">{(f.name.split('.').pop() ?? '').toUpperCase().slice(0, 4)}</span>}
                  <span className="anexo-nome">{f.name}</span>
                  <button type="button" className="link" aria-label={`Tirar ${f.name}`} onClick={() => setAnexos(anexos.filter((_, j) => j !== i))}>×</button>
                </span>
              ))}
              {midiaAnexada.map((m) => (
                <span key={m.id} className={m.erro ? 'anexo-chip erro' : 'anexo-chip'} title={m.erro ?? m.nome}>
                  <span className="anexo-tipo">{(m.nome.split('.').pop() ?? (m.audio ? 'AUD' : 'VID')).toUpperCase().slice(0, 4)}</span>
                  <span className="anexo-nome">{m.nome}</span>
                  <span className="muted small">{m.erro ? 'falhou' : m.caminho ? 'enviado' : m.pct >= 100 ? 'finalizando…' : `enviando ${m.pct}%`}</span>
                  <button type="button" className="link" aria-label={`Tirar ${m.nome}`} onClick={() => tirarMidia(m)}>×</button>
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
            accept="image/png,image/jpeg,image/gif,image/webp,video/*,.mp4,.mov,.webm,.mkv,.m4v,.mp3,.wav,.m4a,.aac,.ogg,.pdf,.docx,.xlsx,.pptx,.odt,.ods,.odp,.txt,.md,.csv,.json,.html,.xml,.yml,.yaml,.sql,.py,.ts,.tsx,.js,.jsx,.css,.sh"
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
            placeholder={pensando ? 'A IA está respondendo…' : 'Escreva sua mensagem (Enter envia, Shift+Enter quebra linha). Arraste ou cole imagem, vídeo, áudio ou .zip aqui.'}
            disabled={pensando}
          />
          <BotaoDitado texto={texto} onTexto={setTexto} desativado={pensando || ocupado} pararRef={pararDitado} />
          <button disabled={ocupado || pensando || midiaSubindo || (!texto.trim() && !anexos.length && !temMidiaEnviada)}>
            {midiaSubindo ? 'Anexando…' : ocupado ? 'Enviando…' : 'Enviar'}
          </button>
        </form>
        </>
        )}
      </div>
      {previa && <PreviaDoProjeto projetoId={projeto.id} onFechar={() => setPrevia(false)} onPedirIa={responderPerguntas} />}
      {painel && <Painel projeto={projeto} versao={versaoPainel} onProjetoMudou={onProjetoMudou} aba={aba} onAba={onAba} />}
    </div>
    </IaContexto.Provider>
  );
}

function Mensagem({ m, projetoId, podeFazer, onFazer, onMudou, onReenviar, respondida = false, onResponder }: { m: any; projetoId: string; podeFazer: boolean; onFazer: () => Promise<void>; onMudou: () => void; onReenviar?: () => Promise<void>; respondida?: boolean; onResponder?: (texto: string) => Promise<void> }) {
  const [indo, setIndo] = useState(false);
  if (m.kind === 'sistema') return <div className="aviso-sistema">{m.content}</div>;
  if (m.role === 'USUARIO') {
    return (
      <div className="msg eu">
        {m.attachments?.length > 0 && (
          <div className="anexos-msg">
            {m.attachments.map((a: any) => (
              <AnexoDaMensagem
                key={a.nome}
                a={a}
                url={a.caminho
                  ? `/projects/${projetoId}/midia/content?path=${encodeURIComponent(a.caminho)}`
                  : `/projects/${projetoId}/conversations/${m.conversationId}/messages/${m.id}/anexos/${encodeURIComponent(a.nome)}`}
              />
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
        <TextoDaIa texto={m.content} />
        {/conectada|indisponível|limite|Conexões/.test(m.content) && <TrocarIa depois={onReenviar} />}
      </div>
    );
  }
  return (
    <div className={m.kind === 'entrega' ? 'msg ia entrega' : 'msg ia'}>
      {m.kind === 'entrega' && <div className="selo-entrega">Entrega do trabalho</div>}
      <TextoDaIa texto={m.content} />
      {Array.isArray(m.perguntas) && m.perguntas.length > 0 && (
        <PerguntasComOpcoes perguntas={m.perguntas} respondida={respondida} onResponder={onResponder} />
      )}
      {m.kind === 'entrega' && m.jobId && <ArquivosDoTrabalho projetoId={projetoId} jobId={m.jobId} />}
      {m.kind === 'plano' && m.plan && (
        <div className="plano">
          <b>Posso fazer isto:</b>
          <ol>{(m.plan.steps ?? []).map((s: any, i: number) => <li key={i}>{s.title || s.key}</li>)}</ol>
          <p className="muted small">No fim, uma IA separada confere se tudo seguiu as regras do agente e do projeto. Só então fica pronto.</p>
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

type TrechoDaIa = { tipo: 'texto' | 'comando'; conteudo: string };

const INICIO_DE_COMANDO = /^(?:[-*]\s+)?(?:\$\s*|root@[^#\n]+#\s*)?(?:sudo\s+|nivoo\s+|git\s+|npm\s+|npx\s+|pnpm\s+|yarn\s+|docker\s+|systemctl\s+|journalctl\s+|pm2\s+|kill(?:all)?\s+|sleep\s+|ss\s+|netstat\s+|lsof\s+|service\s+|reboot(?:\s|$)|shutdown\s+|top(?:\s|$)|free\s+|ls(?:\s|$)|cd\s+|pwd(?:\s|$)|df\s+|du\s+|cat\s+|tail\s+|head\s+|grep\s+|rg\s+|find\s+|curl\s+|wget\s+|apt(?:-get)?\s+|psql\s+|node\s+|python\d*\s+|bash\s+|sh\s+|ssh\s+|scp\s+|chmod\s+|chown\s+|cp\s+|mv\s+|mkdir\s+|tar\s+|zip\s+|unzip\s+|sed\s+|awk\s+|export\s+|env\s+)/;

function pareceComando(texto: string): boolean {
  return INICIO_DE_COMANDO.test(texto.trim());
}

/** Além dos blocos Markdown, reconhece o padrão antigo em que a IA punha um comando entre crases ou aspas. */
function separarComandos(texto: string): TrechoDaIa[] {
  const trechos: TrechoDaIa[] = [];
  const adicionarTextoSimples = (parte: string) => {
    let acumulado = '';
    const descarregar = () => {
      if (acumulado) trechos.push({ tipo: 'texto', conteudo: acumulado });
      acumulado = '';
    };
    for (const linha of parte.split(/(\n)/)) {
      if (linha !== '\n' && pareceComando(linha)) {
        descarregar();
        trechos.push({ tipo: 'comando', conteudo: linha.trim().replace(/^[-*]\s+/, '') });
      } else acumulado += linha;
    }
    descarregar();
  };
  const adicionarTexto = (parte: string) => {
    if (!parte) return;
    const re = /`([^`\n]+)`|'([^'\n]+)'/g;
    let pos = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(parte))) {
      const candidato = m[1] ?? m[2] ?? '';
      if (!pareceComando(candidato)) continue;
      if (m.index > pos) adicionarTextoSimples(parte.slice(pos, m.index));
      trechos.push({ tipo: 'comando', conteudo: candidato.trim() });
      pos = m.index + m[0].length;
    }
    if (pos < parte.length) adicionarTextoSimples(parte.slice(pos));
  };
  const cercado = /```[^\n]*\n([\s\S]*?)```/g;
  let pos = 0;
  let m: RegExpExecArray | null;
  while ((m = cercado.exec(texto))) {
    adicionarTexto(texto.slice(pos, m.index));
    if (m[1].trim()) trechos.push({ tipo: 'comando', conteudo: m[1].trim() });
    pos = m.index + m[0].length;
  }
  adicionarTexto(texto.slice(pos));
  return trechos.length ? trechos : [{ tipo: 'texto', conteudo: texto }];
}

function BlocoDeComando({ comando }: { comando: string }) {
  const [copiado, setCopiado] = useState(false);
  return (
    <div className="bloco-comando">
      <div className="bloco-comando-topo">
        <span>{comando.includes('\n') ? 'Comandos' : 'Comando'}</span>
        <button
          type="button"
          className="link"
          onClick={async () => {
            await copiarTexto(comando);
            setCopiado(true);
            window.setTimeout(() => setCopiado(false), 1800);
          }}
        >
          {copiado ? 'Copiado' : 'Copiar'}
        </button>
      </div>
      <pre><code>{comando}</code></pre>
    </div>
  );
}

function TextoDaIa({ texto }: { texto: string }) {
  const trechos = separarComandos(String(texto ?? ''));
  const comandos = trechos.filter((t) => t.tipo === 'comando').map((t) => t.conteudo);
  // Resposta antiga que espalhou a sequência pelo parágrafo: preserva as explicações e reúne os comandos
  // numa única caixa para copiar/colar tudo de uma vez, na ordem em que a IA os enviou.
  const agrupados: TrechoDaIa[] = comandos.length > 1
    ? [
        { tipo: 'texto', conteudo: trechos.filter((t) => t.tipo === 'texto').map((t) => t.conteudo).join('') },
        { tipo: 'comando', conteudo: comandos.join('\n') },
      ]
    : trechos;
  return (
    <div className="texto texto-ia">
      {agrupados.map((t, i) =>
        t.tipo === 'comando'
          ? <BlocoDeComando key={i} comando={t.conteudo} />
          : <span key={i} className="texto-comum">{t.conteudo}</span>,
      )}
    </div>
  );
}

/**
 * Perguntas da IA em cartões: cada pergunta com as opções para clicar (a recomendada primeiro) e "Outra" para
 * escrever. "Enviar respostas" manda tudo de uma vez como mensagem do usuário, e a IA continua dali.
 */
function PerguntasComOpcoes({ perguntas, respondida, onResponder }: { perguntas: any[]; respondida: boolean; onResponder?: (texto: string) => Promise<void> }) {
  const [escolhas, setEscolhas] = useState<string[][]>(() => perguntas.map(() => []));
  const [outras, setOutras] = useState<string[]>(() => perguntas.map(() => ''));
  const [enviando, setEnviando] = useState(false);
  const alternar = (i: number, rotulo: string, multipla: boolean) =>
    setEscolhas((atual) => atual.map((e, k) => (k !== i ? e : multipla ? (e.includes(rotulo) ? e.filter((x) => x !== rotulo) : [...e, rotulo]) : e[0] === rotulo ? [] : [rotulo])));
  const respostaDe = (i: number) => [...escolhas[i], ...(outras[i].trim() ? [outras[i].trim()] : [])];
  const completas = perguntas.every((_, i) => respostaDe(i).length > 0);
  const enviar = async () => {
    if (!onResponder || !completas) return;
    setEnviando(true);
    const texto = ['Minhas respostas:', ...perguntas.map((q, i) => `${perguntas.length > 1 ? `${i + 1}. ` : ''}${q.pergunta}\n→ ${respostaDe(i).join('; ')}`)].join('\n\n');
    try {
      await onResponder(texto);
    } finally {
      setEnviando(false);
    }
  };
  return (
    <div className={respondida ? 'perguntas-ia respondida' : 'perguntas-ia'}>
      {perguntas.map((q, i) => (
        <div key={i} className="pergunta-ia">
          <b>{perguntas.length > 1 ? `${i + 1}. ` : ''}{q.pergunta}</b>
          {q.multipla && <span className="muted small"> (pode escolher mais de uma)</span>}
          <div className="opcoes-ia">
            {q.opcoes.map((o: any) => (
              <button
                key={o.rotulo}
                type="button"
                disabled={respondida}
                className={escolhas[i].includes(o.rotulo) ? 'opcao-ia escolhida' : 'opcao-ia'}
                onClick={() => alternar(i, o.rotulo, !!q.multipla)}
              >
                <span className="rotulo">{o.rotulo}</span>
                {o.descricao && <span className="descricao">{o.descricao}</span>}
              </button>
            ))}
          </div>
          {!respondida && (
            <input
              className="outra-ia"
              placeholder="Outra (escreva a sua resposta)"
              value={outras[i]}
              onChange={(e) => setOutras((atual) => atual.map((x, k) => (k === i ? e.target.value : x)))}
            />
          )}
        </div>
      ))}
      {respondida ? (
        <span className="muted small">Respondido.</span>
      ) : (
        <div className="row">
          <button disabled={!completas || enviando || !onResponder} onClick={enviar}>{enviando ? 'Enviando…' : 'Enviar respostas'}</button>
          {!completas && <span className="muted small">Escolha uma opção (ou escreva em "Outra") em cada pergunta.</span>}
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
    <div className={`progresso p-${job.status}${job.blockedReason === 'PAUSADO' ? ' pausado' : ''}`}>
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
      {job.status === 'BLOQUEADO' && job.blockedReason === 'PAUSADO' && (
        <span>
          Pausado por você. Tudo o que foi feito está salvo.{' '}
          <button onClick={() => acao(() => api(`/projects/${projetoId}/jobs/${jobId}/resume`, 'POST', { by: nomeUsuario() }))}>Continuar</button>
          <TrocarIa depois={async () => { await api(`/projects/${projetoId}/jobs/${jobId}/resume`, 'POST', { by: nomeUsuario() }); await carregar(); }} />
        </span>
      )}
      {['BLOQUEADO', 'FALHOU'].includes(job.status) && job.blockedReason !== 'PAUSADO' && (
        <span>
          Parei: {conferenciaFalhou(job) ? 'a revisão final precisa de você (veja abaixo)' : MOTIVO[job.blockedReason] ?? 'algo deu errado'}.{' '}
          {!conferenciaFalhou(job) && (
            <>
              <button className="secondary" onClick={() => acao(() => api(`/projects/${projetoId}/jobs/${jobId}/resume`, 'POST', { by: nomeUsuario() }))}>Tentar de novo</button>
              <TrocarIa depois={async () => { await api(`/projects/${projetoId}/jobs/${jobId}/resume`, 'POST', { by: nomeUsuario() }); await carregar(); }} />
            </>
          )}
          {conferenciaFalhou(job) && job.status === 'BLOQUEADO' && <RevisaoParada projetoId={projetoId} jobId={jobId} onMudou={carregar} />}
          <DetalhesDaParada job={job} />
        </span>
      )}
      {['EXECUTANDO', 'PENDENTE', 'AGUARDANDO_RECURSO'].includes(job.status) && (
        <button className="secondary" title="Para agora e guarda tudo; depois é só clicar em Continuar" onClick={() => acao(() => api(`/projects/${projetoId}/jobs/${jobId}/pause`, 'POST', { by: nomeUsuario() }))}>Pausar</button>
      )}
      {erro && <div className="error">{erro}</div>}
    </div>
  );
}

/**
 * Prévia do projeto (site ou sistema rodando no servidor do Nivoo), ao lado da conversa. Liga sob pedido; o endereço
 * é próprio (previa-<domínio>), então o sistema roda inteiro: rotas, telas, chamadas à API e conexões ao vivo.
 */
function PreviaDoProjeto({ projetoId, onFechar, onPedirIa }: { projetoId: string; onFechar: () => void; onPedirIa: (texto: string) => Promise<void> }) {
  const [e, setE] = useState<any | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [tamanho, setTamanho] = useState<'computador' | 'celular'>(() => (lerPreferencia('nivoo_previa_tamanho', 'computador') as 'computador' | 'celular'));
  const [recarga, setRecarga] = useState(0);
  const [verLog, setVerLog] = useState(false);
  const carregar = useCallback(async () => {
    try {
      setE(await api(`/projects/${projetoId}/previa`));
    } catch (x: any) {
      setErro(x.message);
    }
  }, [projetoId]);
  useEffect(() => {
    carregar();
  }, [carregar]);
  useEffect(() => {
    const t = setInterval(carregar, e?.estado === 'ligando' ? 1500 : 15000);
    return () => clearInterval(t);
  }, [carregar, e?.estado]);
  const acao = async (qual: 'ligar' | 'desligar') => {
    setErro(null);
    try {
      setE(await api(`/projects/${projetoId}/previa/${qual}`, 'POST'));
    } catch (x: any) {
      setErro(x.message);
    }
  };
  const mudarTamanho = (t: 'computador' | 'celular') => {
    setTamanho(t);
    gravarPreferencia('nivoo_previa_tamanho', t);
  };
  const estado = e?.estado ?? 'parada';
  const semEndereco = e && !e.enderecoConfigurado && !/^(localhost|127\.0\.0\.1)$/.test(window.location.hostname);
  const rotulo: Record<string, string> = { parada: 'Desligada', ligando: 'Ligando…', 'no-ar': 'No ar', erro: 'Com erro' };
  return (
    <section className="previa">
      <div className="previa-barra">
        <span className={`previa-estado e-${estado}`}>● {rotulo[estado] ?? estado}</span>
        {estado === 'no-ar' && e?.mensagem && <span className="muted small previa-origem">{e.mensagem}</span>}
        <span className="previa-acoes">
          {(estado === 'parada' || estado === 'erro') && <button onClick={() => acao('ligar')}>Ligar a prévia</button>}
          {estado === 'no-ar' && (
            <>
              <button className="secondary" title="Recarregar a página" onClick={() => setRecarga((n) => n + 1)}>Recarregar</button>
              <button className="secondary" title="Copia de novo a pasta principal (com o último trabalho) e religa" onClick={() => acao('ligar')}>Atualizar versão</button>
              <span className="tamanhos">
                <button className={tamanho === 'computador' ? 'secondary ativo' : 'secondary'} onClick={() => mudarTamanho('computador')}>Computador</button>
                <button className={tamanho === 'celular' ? 'secondary ativo' : 'secondary'} onClick={() => mudarTamanho('celular')}>Celular</button>
              </span>
              <a className="link small" href={e.url} target="_blank" rel="noreferrer">nova aba</a>
            </>
          )}
          {(estado === 'no-ar' || estado === 'ligando') && <button className="secondary" onClick={() => acao('desligar')}>Desligar</button>}
          <button className="secondary" aria-label="Fechar a prévia" title="Fechar a prévia" onClick={onFechar}>×</button>
        </span>
      </div>
      {semEndereco && (
        <div className="aviso-sistema">A prévia ainda não tem endereço no seu domínio: no servidor, rode <code>nivoo update</code> (ou <code>nivoo dominio previa</code>).</div>
      )}
      {erro && <div className="error small">{erro}</div>}
      <div className="previa-corpo">
        {estado === 'no-ar' && e?.url ? (
          <div className={`previa-moldura t-${tamanho}`}>
            <iframe key={`${e.url}-${recarga}`} src={e.url} title="Prévia do projeto" sandbox="allow-scripts allow-forms allow-same-origin allow-popups allow-modals allow-downloads" />
          </div>
        ) : estado === 'ligando' ? (
          <div className="previa-info">
            <p>{e?.mensagem || 'Preparando…'}</p>
            <p className="muted small">Na primeira vez, instalar as dependências pode levar alguns minutos.</p>
            {e?.log && <pre className="texto-arquivo">{e.log.slice(-3000)}</pre>}
          </div>
        ) : estado === 'erro' ? (
          <div className="previa-info">
            <p className="error">{e?.mensagem}</p>
            <div className="row">
              {!e?.trabalhoEmAndamento && (
              <button
                className="secondary"
                onClick={() =>
                  onPedirIa(
                    `A prévia do projeto não ligou: ${e?.mensagem ?? ''}\n\nAjuste o projeto para a prévia funcionar: crie ou corrija o nivoo-previa.json na raiz ({"tipo":"servidor","pasta":"…","instalar":"…","comando":"… ouvindo na porta $PORT","caminho":"/"}, ou {"tipo":"estatico","pasta":"…"} para site), conferindo com o sistema ligado na porta $NIVOO_PORTA_TESTE.`,
                  )
                }
              >
                Pedir à IA para arrumar a prévia
              </button>
              )}
              {e?.log && <button className="link small" onClick={() => setVerLog(!verLog)}>{verLog ? 'ocultar registro' : 'ver o registro'}</button>}
            </div>
            {verLog && <pre className="texto-arquivo">{e.log.slice(-6000)}</pre>}
          </div>
        ) : (
          <div className="previa-info">
            <p>Veja o site ou o sistema deste projeto funcionando, aqui do lado da conversa.</p>
            <p className="muted small">Site: abre direto. Sistema: o Nivoo instala, liga numa cópia da pasta principal (com um banco de teste próprio) e desliga sozinho depois de 2 h sem uso.</p>
            <button onClick={() => acao('ligar')}>Ligar a prévia</button>
          </div>
        )}
      </div>
    </section>
  );
}

type AbaPainel = 'memoria' | 'arquivos' | 'midia' | 'git' | 'ajustes';
const ABAS_PAINEL: Array<{ chave: AbaPainel; titulo: string }> = [
  { chave: 'memoria', titulo: 'Memória' },
  { chave: 'arquivos', titulo: 'Arquivos' },
  { chave: 'midia', titulo: 'Mídia' },
  { chave: 'git', titulo: 'Git' },
  { chave: 'ajustes', titulo: 'Ajustes' },
];

/** Preferência de tela guardada neste navegador (falha calada: modo privado, armazenamento bloqueado). */
export function lerPreferencia(chave: string, padrao: string): string {
  try {
    return localStorage.getItem(chave) ?? padrao;
  } catch {
    return padrao;
  }
}
export function gravarPreferencia(chave: string, valor: string): void {
  try {
    localStorage.setItem(chave, valor);
  } catch {
    /* sem armazenamento: vale só nesta tela */
  }
}

function Painel({ projeto, versao, onProjetoMudou, aba, onAba }: { projeto: any; versao: number; onProjetoMudou: () => void; aba: AbaPainel; onAba: (a: AbaPainel) => void }) {
  const projetoId = projeto.id;
  const setAba = onAba;
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
  // Vídeo abre no player; o resto como texto.
  const abrir = async (path: string) =>
    setAberto({ path, conteudo: /\.(mp4|webm|mov)$/i.test(path) ? '' : await lerArquivo(`/projects/${projetoId}/files/content?path=${encodeURIComponent(path)}`) });
  return (
    <aside className="painel">
      <div className="abas">
        <button className={aba === 'memoria' ? 'tab active' : 'tab'} onClick={() => setAba('memoria')}>Memória</button>
        <button className={aba === 'arquivos' ? 'tab active' : 'tab'} onClick={() => setAba('arquivos')}>Arquivos</button>
        <button className={aba === 'midia' ? 'tab active' : 'tab'} onClick={() => setAba('midia')}>Mídia</button>
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
              const itens = memoria.filter((m) => g.categorias.includes(m.category)).sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
              if (!itens.length) return null;
              return (
                <div key={g.chave} className="mem-grupo">
                  <div className="mem-cabeca">
                    <h3>{g.titulo}</h3>
                    <span className="mem-conta">{itens.length}</span>
                  </div>
                  {itens.map((m) => <ItemDaMemoria key={m.id} m={m} texto={m.content} onEsquecer={() => esquecer(m)} />)}
                </div>
              );
            })}
          <p className="muted small mem-dica">Uma entrada por assunto: quando algo muda, o item é atualizado (a versão anterior fica no histórico). Também em <code>memoria/MEMORIA.md</code>, na pasta do projeto.</p>
          <MemoriaInterna projetoId={projetoId} versao={versao} />
        </div>
      )}
      {aba === 'midia' && <CatalogoMidiaProjeto projetoId={projetoId} versao={versao} />}
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
    .replace(/^\[sessão [^\]]*\] término=.*/, 'sessão encerrada; conferindo o resultado…')
    .replace(/^Conferindo a etapa \(testes, build…\): /, 'conferindo (testes e build): ')
    .replace(/^Conferência rodando \((\d+) min\): /, 'conferindo há $1 min — ')
    .replace(/^Conferência ainda rodando \((\d+) min\):? ?/, 'conferindo há $1 min ')
    .replace(/^Conferência final: /, 'conferência final: ')
    .replace(/^\[limite da IA\] /, 'IA: ')
    .replace(/^\[limite do provedor\] .*/s, 'aviso de limite de uso da IA');
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
        {job.status !== 'PENDENTE' && !atual && feitas >= total ? 'Etapas prontas: conferindo o resultado final…' : job.status === 'PENDENTE' || !inicio ? 'Na fila para começar…' : `Rodando há ${duracao(inicio)}${tentativas.length > 1 ? ` · sessão ${tentativas.length} (continua de onde parou)` : ''}`}
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
      {/* Também durante o trabalho: o relatório completo (log ao vivo, tentativas, conferências) para o suporte. */}
      <div className="row small" style={{ marginTop: 4 }}>
        <BotaoDiagnostico url={`/projects/${job.projectId}/jobs/${job.id}/diagnostico`} nomeArquivo={`diagnostico-trabalho-${String(job.id).slice(0, 8)}.md`} />
      </div>
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
  const [ativo, setAtivo] = useState(false);
  const [src, setSrc] = useState<string | null>(null);
  const [falhou, setFalhou] = useState(false);
  useEffect(() => {
    if (!ativo) return;
    let u: string | null = null;
    let saiu = false;
    // A mídia (vídeos enviados/editados) fica fora do git: vem por /midia/content; o resto (cenas no git) por /files/content.
    const rota = /^midia\//.test(caminho)
      ? `/projects/${projetoId}/midia/content?path=${encodeURIComponent(caminho)}`
      : `/projects/${projetoId}/files/content?path=${encodeURIComponent(caminho)}`;
    // Mídia grande usa o player nativo + HTTP Range: baixa só os trechos necessários. Arquivo legado no git ainda
    // vira Blob, mas apenas depois do clique — nunca todos os vídeos da conversa ao abrir a página.
    if (/^midia\//.test(caminho)) {
      setSrc(urlAutenticada(rota));
      return;
    }
    urlDoArquivo(rota, 'video/mp4').then((x) => {
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
  }, [ativo, projetoId, caminho]);
  return (
    <div className="video-pronto">
      {!ativo ? (
        <button type="button" className="secondary" onClick={() => setAtivo(true)}>▶ Carregar vídeo</button>
      ) : src ? (
        <video src={src} controls playsInline preload="metadata" onError={() => setFalhou(true)} />
      ) : (
        <span className="muted small">{falhou ? `Não foi possível abrir ${caminho}.` : 'Carregando o vídeo…'}</span>
      )}
      {src && (
        <a className="small" href={src} download={caminho.split('/').pop()}>
          baixar {caminho}
        </a>
      )}
    </div>
  );
}

type MidiaCatalogada = {
  id: string; nome: string; tipo: 'video' | 'locucao' | 'trilha' | 'audio';
  bytes: number; trabalhoId: string | null; criadoEm: string | null; referencia: string; caminho?: string;
};

/** Visão única dos arquivos aproveitáveis de TODOS os trabalhos, não dos PNGs de QA. */
function CatalogoMidiaProjeto({ projetoId, versao }: { projetoId: string; versao: number }) {
  const [itens, setItens] = useState<MidiaCatalogada[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [baixando, setBaixando] = useState<string | null>(null);
  const [aberto, setAberto] = useState<MidiaCatalogada | null>(null);
  const recarregar = useCallback(async () => {
    setCarregando(true);
    try {
      setItens(await api<MidiaCatalogada[]>(`/projects/${projetoId}/media-catalog`));
      setErro(null);
    } catch (e: any) {
      setErro(String(e?.message ?? 'Não foi possível consultar as mídias'));
    } finally { setCarregando(false); }
  }, [projetoId]);
  useEffect(() => { void recarregar(); }, [recarregar, versao]);
  const grupos: Array<{ tipo: MidiaCatalogada['tipo']; titulo: string }> = [
    { tipo: 'video', titulo: 'Vídeos' },
    { tipo: 'locucao', titulo: 'Locuções' },
    { tipo: 'trilha', titulo: 'Trilhas musicais' },
    { tipo: 'audio', titulo: 'Outros áudios' },
  ];
  return (
    <div className="lista" style={{ padding: 10 }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <strong>Biblioteca de mídia</strong>
        <button type="button" className="secondary small" onClick={() => void recarregar()} disabled={carregando}>
          {carregando ? 'Atualizando…' : 'Atualizar'}
        </button>
      </div>
      <p className="muted small">Todos os vídeos e áudios dos trabalhos anteriores. Arquivos de conferência não aparecem aqui. Nada será apagado.</p>
      {erro && <p className="error" role="alert">{erro}</p>}
      {!carregando && itens.length === 0 && <p className="muted small">Nenhuma mídia registrada no catálogo. A mídia física ainda pode estar na aba de edição do projeto.</p>}
      {grupos.map(({ tipo, titulo }) => {
        const grupo = itens.filter(x => x.tipo === tipo);
        if (!grupo.length) return null;
        return <section key={tipo} style={{ marginTop: 12 }}>
          <strong>{titulo} ({grupo.length})</strong>
          <div style={{ display: 'grid', gap: 8, marginTop: 8 }}>
            {grupo.map(r => <div key={r.id} className="arquivo-chip resultado" style={{ padding: 10, display: 'grid', gap: 6, overflowWrap: 'anywhere' }}>
              <strong className="small">{r.nome.split('/').pop()}</strong>
              <span className="muted small">{(r.bytes / 1024 / 1024).toFixed(2)} MB · trabalho {r.trabalhoId?.slice(0, 8) ?? 'não identificado'}</span>
              <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                <button className="secondary small" type="button" onClick={() => setAberto(r)}>Ouvir / assistir</button>
                <button type="button" className="small" disabled={baixando === r.id} onClick={async () => {
                  setBaixando(r.id); setErro(null);
                  try { await baixarResultadoDoTrabalho(projetoId, r); }
                  catch (e: any) { setErro(String(e?.message ?? e)); }
                  finally { setBaixando(null); }
                }}>{baixando === r.id ? 'Preparando…' : 'Baixar'}</button>
                <button type="button" className="secondary small" onClick={() => void copiarTexto(r.referencia)}>Copiar referência</button>
              </div>
            </div>)}
          </div>
        </section>;
      })}
      {aberto && <ResultadoAberto projetoId={projetoId} r={aberto} onFechar={() => setAberto(null)} />}
    </div>
  );
}

type ResultadoVisivel = { id: string; nome: string; bytes: number; sha256?: string; criadoEm?: string | null };

function tipoDeResultado(r: ResultadoVisivel): { nome: string; icone: string; importante: boolean } {
  const nome = String(r.nome).toLowerCase();
  if (/\.(mp4|webm|mov)$/.test(nome)) return { nome: /(?:previa|prévia|preview|teste)[-_./]/i.test(nome) ? 'Prévia de vídeo' : 'Vídeo', icone: '🎬', importante: true };
  if (/\.(mp3|wav|m4a|ogg|aac)$/.test(nome)) {
    if (/trilha|instrumental|musica|música|soundtrack/.test(nome)) return { nome: 'Trilha musical', icone: '🎵', importante: true };
    if (/locucao|locução|narracao|narração|voz|fala|tts/.test(nome)) return { nome: 'Locução', icone: '🎙️', importante: true };
    return { nome: 'Áudio', icone: '🎧', importante: true };
  }
  return { nome: 'Arquivo técnico', icone: '📄', importante: false };
}

async function baixarResultadoDoTrabalho(projetoId: string, resultado: ResultadoVisivel): Promise<void> {
  // Streaming direto do servidor, sem transformar um MP4 inteiro em Blob no navegador.
  const a = document.createElement('a');
  const midia = (resultado as MidiaCatalogada).caminho;
  a.href = midia
    ? urlAutenticada(`/projects/${projetoId}/midia/content?path=${encodeURIComponent(midia)}`)
    : urlAutenticada(`/projects/${projetoId}/artifacts/${resultado.id}?download=1`);
  a.download = String(resultado.nome).split('/').pop() ?? 'resultado';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** Só os arquivos de entrega ficam destacados; logs e quadros de inspeção continuam acessíveis. */
/** Arquivos que o trabalho criou/alterou/apagou: clique abre para ler (texto) ou assistir (vídeo). */
function ArquivosDoTrabalho({ projetoId, jobId }: { projetoId: string; jobId: string }) {
  const [lista, setLista] = useState<any[] | null>(null);
  const [resultados, setResultados] = useState<ResultadoVisivel[]>([]);
  const [aberto, setAberto] = useState<string | null>(null);
  const [resultadoAberto, setResultadoAberto] = useState<ResultadoVisivel | null>(null);
  const [erroDownload, setErroDownload] = useState<string | null>(null);
  const [baixandoId, setBaixandoId] = useState<string | null>(null);
  useEffect(() => {
    api<any[]>(`/projects/${projetoId}/jobs/${jobId}/arquivos`).then(setLista).catch(() => setLista([]));
    api<ResultadoVisivel[]>(`/projects/${projetoId}/jobs/${jobId}/resultados`)
      .then((r) => setResultados(r.filter((x) => !/^conferencia-regras\.json$|^respostas-do-usuario\.md$/.test(x.nome))))
      .catch(() => setResultados([]));
  }, [projetoId, jobId]);
  if (!lista?.length && !resultados.length) return null;
  const nome: Record<string, string> = { A: 'novo', M: 'alterado', D: 'apagado', R: 'movido' };
  const visiveis = (lista ?? []).slice(0, 40);
  const tamanho = (b: number) => (b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : b >= 1024 ? `${Math.round(b / 1024)} KB` : `${b} B`);
  const entregas = resultados.filter((r) => tipoDeResultado(r).importante);
  const tecnicos = resultados.filter((r) => !tipoDeResultado(r).importante);
  const baixar = async (r: ResultadoVisivel) => {
    setErroDownload(null);
    setBaixandoId(r.id);
    try { await baixarResultadoDoTrabalho(projetoId, r); }
    catch (e: any) { setErroDownload(String(e?.message ?? 'Falha no download')); }
    finally { setBaixandoId(null); }
  };
  return (
    <div className="arquivos-trabalho">
      {entregas.length > 0 && (
        <section aria-label="Arquivos para assistir e baixar">
          <strong>Arquivos para assistir e baixar ({entregas.length})</strong>
          <p className="muted small">Vídeos, locuções e trilhas gerados neste trabalho. Clique em “Abrir” para assistir ou ouvir.</p>
          <div style={{ display: 'grid', gap: 8, marginTop: 8 }}>
            {entregas.map((r) => {
              const tipo = tipoDeResultado(r);
              return (
                <div key={r.id} className="arquivo-chip resultado" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', flexWrap: 'wrap' }}>
                  <span aria-hidden="true" style={{ fontSize: 22 }}>{tipo.icone}</span>
                  <div style={{ flex: '1 1 220px', minWidth: 0, overflowWrap: 'anywhere' }}>
                    <strong>{tipo.nome}</strong>
                    <div className="small">{String(r.nome).split('/').pop()}</div>
                    <span className="muted small">{tamanho(r.bytes)}</span>
                  </div>
                  <button type="button" className="secondary" onClick={() => setResultadoAberto(r)}>Abrir</button>
                  <button type="button" onClick={() => void baixar(r)} disabled={baixandoId === r.id}>
                    {baixandoId === r.id ? 'Preparando…' : 'Baixar'}
                  </button>
                </div>
              );
            })}
          </div>
        </section>
      )}
      {erroDownload && <p className="error" role="alert">Não consegui baixar: {erroDownload}</p>}
      {tecnicos.length > 0 && (
        <details style={{ marginTop: 12 }}>
          <summary className="small">Arquivos técnicos e de conferência ({tecnicos.length}) — mostrar somente se necessário</summary>
          <div className="arquivos-chips" style={{ marginTop: 8 }}>
            {tecnicos.map((r) => (
              <button key={r.id} className="arquivo-chip resultado" onClick={() => setResultadoAberto(r)} title={`${tamanho(r.bytes)} · arquivo técnico`}>
                {r.nome} <span className="muted">· {tamanho(r.bytes)}</span>
              </button>
            ))}
          </div>
        </details>
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
  const [imagem, setImagem] = useState<string | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);
  const url = r.caminho
    ? `/projects/${projetoId}/midia/content?path=${encodeURIComponent(r.caminho)}`
    : `/projects/${projetoId}/artifacts/${r.id}`;
  const ehImagem = /\.(png|jpe?g|gif|webp)$/i.test(String(r.nome));
  const ehVideo = /\.(mp4|webm|mov)$/i.test(String(r.nome));
  const ehAudio = /\.(mp3|wav|m4a|ogg|aac)$/i.test(String(r.nome));
  useEffect(() => {
    if (ehVideo || ehAudio) {
      setVideoUrl(urlAutenticada(url));
      return;
    }
    if (ehImagem) {
      let active = true;
      let u: string | null = null;
      urlDoArquivo(url).then(x => {
        if (!x) return;
        if (!active) { URL.revokeObjectURL(x); return; }
        u = x;
        if (ehVideo || ehAudio) setVideoUrl(x);
        else setImagem(x);
      });
      return () => { active = false; if (u) URL.revokeObjectURL(u); };
    }
    lerArquivo(url).then(setTexto);
  }, [url, ehImagem, ehVideo, ehAudio]);
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
        {ehAudio ? (videoUrl ? <audio controls preload="metadata" src={videoUrl} style={{width:'100%'}} /> : <p className="muted">Carregando áudio…</p>) : ehVideo ? (videoUrl ? <video controls playsInline preload="metadata" src={videoUrl} style={{width:'100%',maxHeight:'70vh'}} /> : <p className="muted">Carregando vídeo…</p>) : ehImagem ? (imagem ? <img className="foto-resultado" src={imagem} alt={r.nome} /> : <p className="muted">Carregando…</p>) : <pre className="texto-arquivo">{texto ?? 'Carregando…'}</pre>}
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
