import { FormEvent, useCallback, useEffect, useState } from 'react';
import { api, nomeUsuario } from '../api';
import { EditorDeRegras, Materiais } from '../Pecas';

/**
 * Agentes: o "jeito de trabalhar" de um tipo de projeto (ex.: Sistemas ERP/SaaS, Website, Atendimento).
 * Cada agente tem o texto de funcionamento da IA (regras, escopo, comportamento) e materiais de referência.
 * Todo projeto criado no agente herda isso. Tudo em texto, sem configuração técnica.
 */
export function Modelos() {
  const [modelos, setModelos] = useState<any[] | null>(null);
  const [aberto, setAberto] = useState<string | null>(null);
  const [novo, setNovo] = useState(false);
  const carregar = useCallback(async () => setModelos(await api<any[]>('/areas')), []);
  useEffect(() => {
    carregar().catch(() => setModelos([]));
  }, [carregar]);
  if (aberto) return <EditarModelo slug={aberto} onVoltar={() => { setAberto(null); carregar(); }} />;
  return (
    <div className="pagina">
      <header className="conversa-topo">
        <div>
          <h1>Agentes</h1>
          <span className="muted small">O jeito de trabalhar de cada tipo de projeto. Todo projeto criado num agente segue o que está nele.</span>
        </div>
        <button onClick={() => setNovo(true)}>+ Novo agente</button>
      </header>
      <div className="cartoes">
        {modelos?.map((m) => (
          <button key={m.id} className="cartao" onClick={() => setAberto(m.slug)}>
            <b>{m.name}</b>
            <span>{m.description}</span>
            <span className="muted small">{m._count?.projects ?? 0} projeto(s)</span>
          </button>
        ))}
      </div>
      {novo && (
        <NovoModelo
          onFechar={() => setNovo(false)}
          onCriado={(slug) => {
            setNovo(false);
            setAberto(slug);
          }}
        />
      )}
    </div>
  );
}

function NovoModelo({ onFechar, onCriado }: { onFechar: () => void; onCriado: (slug: string) => void }) {
  const [prontos, setProntos] = useState<any[]>([]);
  const [inicio, setInicio] = useState('geral');
  const [nome, setNome] = useState('');
  const [descricao, setDescricao] = useState('');
  const [texto, setTexto] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  useEffect(() => {
    api<any[]>('/areas/templates')
      .then((t) => {
        setProntos(t);
        setTexto(t.find((x) => x.key === 'geral')?.instructions ?? '');
      })
      .catch(() => undefined);
  }, []);
  const escolher = (key: string) => {
    setInicio(key);
    const t = prontos.find((x) => x.key === key);
    setTexto(t?.instructions ?? '');
    if (!descricao) setDescricao(t?.description ?? '');
  };
  const criar = async (e: FormEvent) => {
    e.preventDefault();
    setOcupado(true);
    setErro(null);
    try {
      const a = await api('/areas', 'POST', { name: nome, template: inicio, instructions: texto, description: descricao, author: nomeUsuario() });
      onCriado(a.slug);
    } catch (err: any) {
      setErro(err.message);
    } finally {
      setOcupado(false);
    }
  };
  return (
    <div className="modal-fundo" onClick={onFechar}>
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={criar}>
        <h2>Novo agente</h2>
        <label>Nome do agente<input autoFocus value={nome} onChange={(e) => setNome(e.target.value)} required placeholder="Ex.: Sistemas ERP / SaaS" /></label>
        <label>Para que serve (uma linha)<input value={descricao} onChange={(e) => setDescricao(e.target.value)} placeholder="Ex.: Sistemas de gestão completos, front-end e back-end" /></label>
        <div className="campo">
          <span>Começar de</span>
          <div className="tipos">
            {prontos.map((t) => (
              <button type="button" key={t.key} className={inicio === t.key ? 'tipo on' : 'tipo'} onClick={() => escolher(t.key)}>
                <b>{t.key === 'geral' ? 'Em branco' : t.name}</b>
                <span>{t.description}</span>
              </button>
            ))}
          </div>
        </div>
        <label>
          Como a IA deve funcionar neste agente
          <textarea rows={10} value={texto} onChange={(e) => setTexto(e.target.value)} />
        </label>
        <span className="muted small">Depois de criar você pode importar um PDF, Word ou texto e enviar materiais de referência.</span>
        {erro && <div className="error">{erro}</div>}
        <div className="row fim">
          <button type="button" className="secondary" onClick={onFechar}>Cancelar</button>
          <button disabled={ocupado || !nome.trim() || !texto.trim()}>Criar agente</button>
        </div>
      </form>
    </div>
  );
}

function EditarModelo({ slug, onVoltar }: { slug: string; onVoltar: () => void }) {
  const [m, setM] = useState<any>(null);
  const [nome, setNome] = useState('');
  const [descricao, setDescricao] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const carregar = useCallback(async () => {
    const a = await api(`/areas/${slug}`);
    setM(a);
    setNome(a.name);
    setDescricao(a.description);
  }, [slug]);
  useEffect(() => {
    carregar().catch(() => undefined);
  }, [carregar]);
  const listar = useCallback(async () => (await api(`/areas/${slug}`)).baseFiles, [slug]);
  if (!m) return null;
  return (
    <div className="pagina">
      <header className="conversa-topo">
        <div>
          <button className="link voltar" onClick={onVoltar}>← Agentes</button>
          <h1>{m.name}</h1>
        </div>
      </header>
      <div className="editor-modelo">
        <div className="campo">
          <label>Nome<input value={nome} onChange={(e) => setNome(e.target.value)} /></label>
          <label>Para que serve<input value={descricao} onChange={(e) => setDescricao(e.target.value)} /></label>
          <div className="row">
            <button className="secondary" disabled={nome === m.name && descricao === m.description} onClick={async () => { await api(`/areas/${slug}`, 'PATCH', { name: nome, description: descricao }); setMsg('Nome e descrição salvos.'); carregar(); }}>Salvar nome e descrição</button>
          </div>
          {msg && <div className="ok-msg">{msg}</div>}
        </div>
        <EditorDeRegras
          titulo="Como a IA deve funcionar neste agente"
          ajuda="Escreva em texto livre todo o funcionamento: papel da IA, escopo, regras, padrões, o que nunca fazer, como entregar. Vale para todos os projetos deste agente. Pode importar de um PDF, Word ou arquivo de texto."
          placeholder="Ex.: Você é um engenheiro de software sênior especializado em sistemas ERP..."
          inicial={m.currentInstruction?.text ?? ''}
          versao={m.currentInstruction?.version}
          onSalvar={(texto) => api(`/areas/${slug}/instructions`, 'POST', { text: texto, author: nomeUsuario() }).then(carregar)}
        />
        <Materiais
          titulo="Materiais de referência do agente"
          ajuda="Padrões, estruturas, guias, identidade visual… Pode enviar uma pasta inteira. Valem para todos os projetos deste agente. PDF, Word, Excel, PowerPoint e LibreOffice são guardados como texto (o original não fica), para qualquer IA ler."
          listar={listar}
          rotaEnvio={`/areas/${slug}/base/import`}
          rotaArquivo={(p) => `/areas/${slug}/base/file?path=${encodeURIComponent(p)}`}
          rotaRemover={(p) => `/areas/${slug}/base/file?path=${encodeURIComponent(p)}&author=${encodeURIComponent(nomeUsuario())}`}
        />
      </div>
    </div>
  );
}
