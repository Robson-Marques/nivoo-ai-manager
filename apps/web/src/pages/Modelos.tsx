import { ChangeEvent, FormEvent, useCallback, useEffect, useState } from 'react';
import { api } from '../api';

/**
 * Modelos (áreas) em linguagem simples. Um modelo = regras + pasta de padrões (guias, estrutura,
 * identidade visual...). Todo projeto criado no modelo segue isso, em toda conversa e todo trabalho.
 */

const LOTE_BYTES = 25 * 1024 * 1024;
const IGNORAR = /(^|\/)(node_modules|\.git|__pycache__|\.venv)(\/|$)|(^|\/)(\.DS_Store|Thumbs\.db|desktop\.ini)$/i;

function base64(f: File): Promise<string> {
  return new Promise((ok, erro) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result).replace(/^data:[^,]*,/, ''));
    r.onerror = () => erro(r.error);
    r.readAsDataURL(f);
  });
}

/** Envia a pasta escolhida (em lotes) para a base do modelo. Retorna um resumo para mostrar. */
export async function enviarPasta(area: string, arquivos: FileList, onProgresso: (t: string) => void): Promise<string> {
  const lista = Array.from(arquivos)
    .map((f) => ({ f, path: ((f as any).webkitRelativePath || f.name).split('/').slice((f as any).webkitRelativePath ? 1 : 0).join('/') }))
    .filter((x) => x.path && !IGNORAR.test(x.path));
  let enviados = 0;
  const ignorados: string[] = [];
  let lote: Array<{ path: string; contentBase64: string }> = [];
  let bytes = 0;
  const flush = async () => {
    if (!lote.length) return;
    const r = await api(`/areas/${area}/base/import`, 'POST', { files: lote, message: `pasta enviada pela tela (${lote.length} arquivo(s))` });
    enviados += r.importados;
    ignorados.push(...r.ignorados);
    lote = [];
    bytes = 0;
  };
  for (const { f, path } of lista) {
    if (f.size > 10 * 1024 * 1024) {
      ignorados.push(`${path} (maior que 10 MB)`);
      continue;
    }
    if (bytes + f.size > LOTE_BYTES || lote.length >= 500) await flush();
    lote.push({ path, contentBase64: await base64(f) });
    bytes += f.size;
    onProgresso(`Enviando… ${enviados + lote.length} de ${lista.length}`);
  }
  await flush();
  return `${enviados} arquivo(s) guardados no modelo.${ignorados.length ? ` Ignorados: ${ignorados.length} (pastas de sistema ou arquivos grandes).` : ''}`;
}

export function Modelos() {
  const [areas, setAreas] = useState<any[] | null>(null);
  const [novo, setNovo] = useState(false);
  const carregar = useCallback(async () => {
    const lista = await api<any[]>('/areas');
    setAreas(await Promise.all(lista.map((a) => api(`/areas/${a.slug}`))));
  }, []);
  useEffect(() => {
    carregar().catch(() => setAreas([]));
  }, [carregar]);
  return (
    <div className="modelos">
      <header className="conversa-topo">
        <div>
          <h1>Modelos</h1>
          <span className="muted small">Cada modelo guarda as regras e a pasta de padrões que todos os seus projetos seguem.</span>
        </div>
        <button onClick={() => setNovo(true)}>+ Novo modelo</button>
      </header>
      <div className="modelos-lista">
        {areas?.map((a) => <CartaoModelo key={a.id} area={a} onMudou={carregar} />)}
      </div>
      {novo && (
        <NovoModelo
          onFechar={() => setNovo(false)}
          onCriado={async () => {
            setNovo(false);
            await carregar();
          }}
        />
      )}
    </div>
  );
}

function CartaoModelo({ area, onMudou }: { area: any; onMudou: () => void }) {
  const [msg, setMsg] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [verArquivos, setVerArquivos] = useState(false);
  const [editando, setEditando] = useState(false);
  const [regras, setRegras] = useState(area.currentInstruction?.text ?? '');
  const escolher = async (e: ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files?.length) return;
    setErro(null);
    try {
      setMsg(await enviarPasta(area.slug, e.target.files, setMsg));
      onMudou();
    } catch (err: any) {
      setErro(err.message);
      setMsg(null);
    }
    e.target.value = '';
  };
  const salvarRegras = async (e: FormEvent) => {
    e.preventDefault();
    setErro(null);
    try {
      await api(`/areas/${area.slug}/instructions`, 'POST', { text: regras, reason: 'regras editadas na tela de modelos' });
      setEditando(false);
      setMsg('Regras salvas. A versão anterior continua no histórico.');
      onMudou();
    } catch (err: any) {
      setErro(err.message);
    }
  };
  return (
    <section className="modelo">
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h2>{area.name}</h2>
          <p className="muted small">{area.description}</p>
          <p className="small">
            {area.projects.length} projeto(s) · {area.baseFiles.length} arquivo(s) de padrões · regras versão {area.instructionsVersion}
          </p>
        </div>
        <label className="botao-arquivo">
          Enviar pasta de padrões
          <input type="file" multiple {...({ webkitdirectory: '', directory: '' } as any)} onChange={escolher} />
        </label>
      </div>
      {msg && <div className="ok-msg">{msg}</div>}
      {erro && <div className="error">{erro}</div>}
      <div className="row">
        <button className="secondary" onClick={() => setVerArquivos(!verArquivos)}>{verArquivos ? 'Esconder arquivos' : 'Ver arquivos'}</button>
        <button className="secondary" onClick={() => setEditando(!editando)}>{editando ? 'Cancelar' : 'Editar regras'}</button>
      </div>
      {verArquivos && (
        <ul className="arquivos-modelo">
          {area.baseFiles.map((f: any) => <li key={f.path}>{f.path}</li>)}
        </ul>
      )}
      {editando && (
        <form onSubmit={salvarRegras}>
          <textarea rows={10} value={regras} onChange={(e) => setRegras(e.target.value)} />
          <button disabled={!regras.trim()}>Salvar regras</button>
        </form>
      )}
    </section>
  );
}

function NovoModelo({ onFechar, onCriado }: { onFechar: () => void; onCriado: () => void }) {
  const [nome, setNome] = useState('');
  const [regras, setRegras] = useState('');
  const [pasta, setPasta] = useState<FileList | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const criar = async (e: FormEvent) => {
    e.preventDefault();
    setOcupado(true);
    setErro(null);
    try {
      const a = await api('/areas', 'POST', { name: nome, template: 'generica', instructions: regras || undefined, description: regras ? regras.slice(0, 200) : undefined });
      if (pasta?.length) await enviarPasta(a.slug, pasta, setStatus);
      onCriado();
    } catch (err: any) {
      setErro(err.message);
    } finally {
      setOcupado(false);
    }
  };
  return (
    <div className="modal-fundo" onClick={onFechar}>
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={criar}>
        <h2>Novo modelo</h2>
        <label>Nome do modelo<input autoFocus value={nome} onChange={(e) => setNome(e.target.value)} required placeholder="Ex.: Studio (software e web design)" /></label>
        <label>Regras do modelo (opcional)<textarea rows={4} value={regras} onChange={(e) => setRegras(e.target.value)} placeholder="Como a IA deve trabalhar nos projetos deste modelo. Ex.: siga sempre o fluxo e a identidade visual da pasta de padrões." /></label>
        <label className="botao-arquivo">
          {pasta?.length ? `Pasta escolhida: ${pasta.length} arquivo(s)` : 'Escolher pasta de padrões (opcional)'}
          <input type="file" multiple {...({ webkitdirectory: '', directory: '' } as any)} onChange={(e) => setPasta(e.target.files)} />
        </label>
        {status && <div className="muted small">{status}</div>}
        {erro && <div className="error">{erro}</div>}
        <div className="row fim">
          <button type="button" className="secondary" onClick={onFechar}>Cancelar</button>
          <button disabled={ocupado || !nome.trim()}>{ocupado ? 'Criando…' : 'Criar modelo'}</button>
        </div>
      </form>
    </div>
  );
}
