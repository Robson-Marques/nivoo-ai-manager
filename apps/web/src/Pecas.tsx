import { ChangeEvent, useEffect, useRef, useState } from 'react';
import { api, enviarArquivos, lerArquivo, textoDoArquivo } from './api';

/**
 * Peças compartilhadas pelas telas de Agentes e de Ajustes do projeto: o editor de regras em texto livre
 * (com importação de PDF/Word/texto) e a lista de materiais de referência (envio de arquivos ou pasta).
 */

export function EditorDeRegras(props: { titulo: string; ajuda: string; inicial: string; placeholder: string; versao?: number; onSalvar: (texto: string) => Promise<unknown> }) {
  const [texto, setTexto] = useState(props.inicial);
  const [status, setStatus] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const arquivo = useRef<HTMLInputElement>(null);
  useEffect(() => setTexto(props.inicial), [props.inicial]);
  const importar = async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    setErro(null);
    setStatus(`Lendo ${f.name}…`);
    try {
      const t = await textoDoArquivo(f);
      setTexto((atual) => (atual.trim() ? `${atual.trimEnd()}\n\n${t}` : t));
      setStatus(`Texto de "${f.name}" colocado abaixo. Revise e clique em Salvar.`);
    } catch (err: any) {
      setErro(err.message);
      setStatus(null);
    }
  };
  const salvar = async () => {
    setOcupado(true);
    setErro(null);
    try {
      await props.onSalvar(texto);
      setStatus('Salvo. A versão anterior continua guardada no histórico.');
    } catch (err: any) {
      setErro(err.message);
    } finally {
      setOcupado(false);
    }
  };
  return (
    <div className="editor-regras">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <b>{props.titulo}</b>
        {props.versao ? <span className="muted small">versão {props.versao}</span> : null}
      </div>
      <p className="muted small">{props.ajuda}</p>
      <textarea rows={12} value={texto} onChange={(e) => setTexto(e.target.value)} placeholder={props.placeholder} />
      <div className="row">
        <button onClick={salvar} disabled={ocupado || texto === props.inicial || !texto.trim()}>Salvar</button>
        <button className="secondary" type="button" onClick={() => arquivo.current?.click()}>Importar de PDF, Word, Excel, PowerPoint ou texto</button>
        <input ref={arquivo} type="file" accept=".pdf,.docx,.xlsx,.pptx,.odt,.ods,.odp,.txt,.md,.csv" hidden onChange={importar} />
      </div>
      {status && <div className="ok-msg">{status}</div>}
      {erro && <div className="error">{erro}</div>}
    </div>
  );
}

export function Materiais(props: { titulo: string; ajuda: string; listar: () => Promise<Array<{ path: string; size: number }>>; rotaEnvio: string; rotaArquivo: (p: string) => string; rotaRemover: (p: string) => string }) {
  const [arquivos, setArquivos] = useState<Array<{ path: string; size: number }> | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aberto, setAberto] = useState<{ path: string; conteudo: string } | null>(null);
  const { listar } = props;
  const carregar = () => listar().then(setArquivos).catch(() => setArquivos([]));
  useEffect(() => {
    carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listar]);
  const enviar = async (e: ChangeEvent<HTMLInputElement>) => {
    const fs = e.target.files;
    if (!fs?.length) return;
    setErro(null);
    try {
      setStatus(await enviarArquivos(props.rotaEnvio, fs, setStatus));
      carregar();
    } catch (err: any) {
      setErro(err.message);
      setStatus(null);
    }
    e.target.value = '';
  };
  const remover = async (p: string) => {
    if (!window.confirm(`Remover "${p}"?`)) return;
    await api(props.rotaRemover(p), 'DELETE');
    carregar();
  };
  return (
    <div className="materiais">
      <b>{props.titulo}</b>
      <p className="muted small">{props.ajuda}</p>
      <div className="row">
        <label className="botao-arquivo">
          Enviar arquivos
          <input type="file" multiple onChange={enviar} />
        </label>
        <label className="botao-arquivo secundario">
          Enviar uma pasta
          <input type="file" multiple {...({ webkitdirectory: '', directory: '' } as any)} onChange={enviar} />
        </label>
      </div>
      {status && <div className="ok-msg">{status}</div>}
      {erro && <div className="error">{erro}</div>}
      {arquivos && arquivos.length === 0 && <p className="muted small">Nenhum material ainda.</p>}
      <ul className="arquivos-lista">
        {arquivos?.map((f) => (
          <li key={f.path}>
            <button className="arquivo" onClick={async () => setAberto({ path: f.path, conteudo: await lerArquivo(props.rotaArquivo(f.path)) })}>{f.path}</button>
            <button className="link" onClick={() => remover(f.path)}>remover</button>
          </li>
        ))}
      </ul>
      {aberto && <VerArquivo {...aberto} onFechar={() => setAberto(null)} />}
    </div>
  );
}

export function VerArquivo({ path, conteudo, onFechar }: { path: string; conteudo: string; onFechar: () => void }) {
  return (
    <div className="modal-fundo" onClick={onFechar}>
      <div className="modal largo" onClick={(e) => e.stopPropagation()}>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2>{path}</h2>
          <button className="secondary" onClick={onFechar}>Fechar</button>
        </div>
        <pre className="texto-arquivo">{conteudo}</pre>
      </div>
    </div>
  );
}


/**
 * Modelo da IA do projeto (ex.: Claude → Opus; ChatGPT → GPT-6.1-Sol). A lista vem do programa oficial da
 * IA; "Outro…" permite digitar um nome. A escolha fica guardada por IA no projeto.
 */
export function SeletorModelo({ projeto, onMudou, className, ia: iaFixa, rotulo = 'Modelo', mostrarAviso = false }: { projeto: any; onMudou: () => void; className?: string; ia?: string; rotulo?: string; mostrarAviso?: boolean }) {
  const ia = iaFixa ?? projeto.provider;
  const ehNvidia = ia === 'nvidia-api' || ia.startsWith('nvidia-api--');
  const [opcoes, setOpcoes] = useState<Array<{ id: string; nome: string; categoria?: string; descricao?: string }>>([]);
  const [aviso, setAviso] = useState<string | null>(null);
  const atual: string = (projeto.aiModels ?? {})[ia] ?? '';
  useEffect(() => {
    setOpcoes([]);
    api<{ opcoes: Array<{ id: string; nome: string; categoria?: string; descricao?: string }>; aviso?: string }>(`/accounts/${ia}/models`)
      .then((r) => {
        setOpcoes(r.opcoes);
        setAviso(r.aviso ?? null);
      })
      .catch(() => undefined);
  }, [ia]);
  const salvar = async (valor: string) => {
    let model: string | null = valor || null;
    if (valor === '__outro__') {
      const digitado = window.prompt('Nome do modelo (como a IA chama, ex.: opus, gpt-6.1-sol, gemini-2.5-pro):', atual);
      if (!digitado?.trim()) return;
      model = digitado.trim();
    }
    await api(`/projects/${projeto.id}`, 'PATCH', { model, ...(iaFixa ? { modeloDe: iaFixa } : {}) });
    onMudou();
  };
  const lista: Array<{ id: string; nome: string; categoria?: string; descricao?: string }> = atual && !opcoes.some((o) => o.id === atual)
    ? [{ id: atual, nome: ehNvidia ? atual + ' (antigo/incompatível: escolha outro)' : atual, categoria: 'Outros' }, ...opcoes]
    : opcoes;
  const gruposNvidia = [...new Set(lista.map(o => o.categoria ?? 'Programação e agentes'))];
  const seletor = (
    <select className={className} value={atual} onChange={(e) => salvar(e.target.value)} title={aviso ?? 'Modelo usado por esta IA neste projeto'}>
      <option value="">{ia === 'gemini-video' ? 'Modelo: automático (o melhor que a chave permite)' : 'Modelo: padrão da IA'}</option>
      {ehNvidia
        ? gruposNvidia.map(g => (
            <optgroup key={g} label={g}>
              {lista.filter(o => (o.categoria ?? 'Programação e agentes') === g).map(o => (
                <option key={o.id} value={o.id} title={o.descricao ?? o.nome}>
                  {o.nome}
                </option>
              ))}
            </optgroup>
          ))
        : lista.map(o => <option key={o.id} value={o.id}>Modelo: {o.nome}</option>)}
      {!ehNvidia && <option value="__outro__">Outro… (digitar o nome)</option>}
    </select>
  );
  if (!mostrarAviso || !aviso) return seletor;
  return (
    <>
      {seletor}
      <span className="muted small">{aviso}</span>
    </>
  );
}
