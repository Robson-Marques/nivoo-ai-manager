import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';

/**
 * Git do projeto em linguagem simples (as contas GitHub/GitLab ficam em Conexões): ligar a um repositório,
 * atualizar (pull), enviar (push + versão/tag) e envio automático. O token nunca chega à IA.
 */

/** Painel Git do projeto (aba "Git"). */
export function GitDoProjeto({ projeto, onMudou }: { projeto: any; onMudou: () => void }) {
  const [st, setSt] = useState<any>(null);
  const [contas, setContas] = useState<any[]>([]);
  const [url, setUrl] = useState('');
  const [branch, setBranch] = useState('main');
  const [conta, setConta] = useState('');
  const [tag, setTag] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [modo, setModo] = useState<'criar' | 'ligar' | 'mudar' | null>(null);
  const [novo, setNovo] = useState<NovoRepo>({ accountId: '', namespace: '', tipoNamespace: 'usuario', nome: nomeRepoPadrao(projeto.name), privado: true });
  const carregar = useCallback(async () => setSt(await api(`/projects/${projeto.id}/git`)), [projeto.id]);
  useEffect(() => {
    carregar().catch((e) => setErro(e.message));
    api<any[]>('/git/accounts').then(setContas).catch(() => undefined);
  }, [carregar]);
  const acao = async (nome: string, fn: () => Promise<any>, ok: string) => {
    setErro(null);
    setMsg(null);
    setOcupado(nome);
    try {
      await fn();
      setMsg(ok);
      await carregar();
      onMudou();
    } catch (e: any) {
      setErro(e.message);
    } finally {
      setOcupado(null);
    }
  };
  if (!st) return <div className="lista"><p className="muted small">Carregando…</p></div>;
  const criarRepo = (mudar: boolean) =>
    acao('criar', () => api(`/projects/${projeto.id}/git/create`, 'POST', novo), mudar ? 'Projeto mudou para o repositório novo, com todo o histórico. O repositório antigo não foi alterado.' : 'Repositório criado e projeto enviado. O envio automático está ligado.').then(() => setModo(null));
  const formCriar = (mudar: boolean) => (
    <form className="campo" onSubmit={(e) => { e.preventDefault(); criarRepo(mudar); }}>
      <b>{mudar ? 'Mudar para um repositório novo' : 'Criar repositório novo'}</b>
      <span className="muted small">
        {mudar
          ? 'Cria o repositório na conta escolhida (ex.: no GitLab) e envia todo o histórico do projeto. Daqui em diante o projeto usa o novo; o antigo fica como está.'
          : 'Cria o repositório (vazio) na conta escolhida, envia o projeto e mantém atualizado a cada trabalho concluído.'}
      </span>
      <CamposNovoRepo contas={contas} valor={novo} onChange={setNovo} />
      <div className="row">
        <button disabled={!!ocupado || !novo.namespace || !novo.nome.trim()}>{ocupado === 'criar' ? 'Criando…' : mudar ? 'Criar e mudar' : 'Criar repositório e enviar'}</button>
        <button type="button" className="secondary" onClick={() => setModo(null)}>Cancelar</button>
      </div>
    </form>
  );
  return (
    <div className="lista ajustes">
      {st.ligado ? (
        <>
          <div className="campo">
            <b>Repositório</b>
            <span className="small mono">{st.url}</span>
            <span className="small">Branch: <b>{st.branch}</b>{st.conta ? ` · conta ${st.conta.nome}` : ' · sem conta (repositório público)'}</span>
            {st.erro ? (
              <div className="error">{st.erro}</div>
            ) : (
              <span className="small">
                {st.remotoVazio ? 'O repositório ainda está vazio: o primeiro envio cria a branch.' : `${st.enviar} commit(s) para enviar · ${st.receber} commit(s) novos no repositório`}
              </span>
            )}
          </div>
          <div className="campo">
            <div className="row">
              <button className="secondary" disabled={!!ocupado} onClick={() => acao('pull', () => api(`/projects/${projeto.id}/git/pull`, 'POST'), 'Pasta do projeto atualizada com o repositório.')}>
                {ocupado === 'pull' ? 'Atualizando…' : 'Atualizar do Git'}
              </button>
            </div>
            <div className="row">
              <input value={tag} onChange={(e) => setTag(e.target.value)} placeholder="Versão/tag (opcional, ex.: v1.2.3)" style={{ maxWidth: 220 }} />
              <button disabled={!!ocupado} onClick={() => acao('push', () => api(`/projects/${projeto.id}/git/push`, 'POST', tag ? { tag } : {}), tag ? `Enviado ao Git com a tag ${tag}.` : 'Enviado ao Git.').then(() => setTag(''))}>
                {ocupado === 'push' ? 'Enviando…' : 'Enviar para o Git'}
              </button>
            </div>
            <label className="row small" style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <input type="checkbox" checked={st.autoEnvio} style={{ width: 'auto' }} onChange={(e) => acao('auto', () => api(`/projects/${projeto.id}/git`, 'PATCH', { autoEnvio: e.target.checked }), e.target.checked ? 'Envio automático ligado.' : 'Envio automático desligado.')} />
              Enviar sozinho para o Git a cada trabalho concluído (depois da conferência das regras)
            </label>
          </div>
          <div className="campo">
            <b>Últimos commits da pasta do projeto</b>
            <ul className="arquivos-lista">
              {st.commits.map((c: any) => (
                <li key={c.commit}><span className="small"><span className="mono">{c.commit}</span> {c.mensagem}</span></li>
              ))}
            </ul>
          </div>
          {modo === 'mudar' ? formCriar(true) : <button className="link small" onClick={() => setModo('mudar')}>mudar para outro repositório (ex.: do GitHub para o GitLab)</button>}
          <button className="link small" onClick={() => window.confirm('Desligar este projeto do repositório? Nada é apagado.') && acao('unlink', () => api(`/projects/${projeto.id}/git`, 'DELETE'), 'Projeto desligado do repositório.')}>desligar do repositório</button>
        </>
      ) : (
        <>
          {modo === null && (
            <div className="campo">
              <b>Este projeto ainda não está num repositório Git</b>
              <div className="row">
                <button onClick={() => setModo('criar')}>Criar repositório novo</button>
                <button className="secondary" onClick={() => setModo('ligar')}>Ligar a um que já existe</button>
              </div>
            </div>
          )}
          {modo === 'criar' && formCriar(false)}
          {modo === 'ligar' && (
        <form className="campo" onSubmit={(e) => { e.preventDefault(); acao('link', () => api(`/projects/${projeto.id}/git/link`, 'POST', { url, branch, accountId: conta || undefined }), 'Projeto ligado ao repositório. Use "Enviar para o Git" quando quiser publicar.'); }}>
          <b>Ligar a um repositório</b>
          <span className="muted small">Para um repositório vazio ou que já tem este mesmo histórico. Para trabalhar num projeto que já existe no Git, crie um projeto novo com "Trazer de um repositório Git".</span>
          <EscolherRepo contas={contas} onEscolher={(r) => { setUrl(r.url); setBranch(r.branch); setConta(r.accountId); }} />
          <label>Endereço do repositório<input value={url} onChange={(e) => setUrl(e.target.value)} required placeholder="https://git.suaempresa.com.br/grupo/projeto.git" /></label>
          <label>Branch<input value={branch} onChange={(e) => setBranch(e.target.value)} /></label>
          <SeletorContaGit contas={contas} valor={conta} onChange={setConta} />
          <div className="row"><button disabled={!!ocupado || !url.trim()}>Ligar</button><button type="button" className="secondary" onClick={() => setModo(null)}>Cancelar</button></div>
        </form>
          )}
        </>
      )}
      {msg && <div className="ok-msg">{msg}</div>}
      {erro && <div className="error">{erro}</div>}
    </div>
  );
}

export function SeletorContaGit({ contas, valor, onChange }: { contas: any[]; valor: string; onChange: (v: string) => void }) {
  return (
    <label>
      Conta Git
      <select value={valor} onChange={(e) => onChange(e.target.value)}>
        <option value="">Automática (a do mesmo servidor) / repositório público</option>
        {contas.map((c) => <option key={c.id} value={c.id}>{c.nome} — {c.host}</option>)}
      </select>
      {contas.length === 0 && <span className="muted small">Repositório privado? Cadastre a conta em <Link to="/contas">Conexões</Link>.</span>}
    </label>
  );
}

export interface NovoRepo {
  accountId: string;
  namespace: string;
  tipoNamespace: 'usuario' | 'grupo';
  nome: string;
  privado: boolean;
}

/** Onde criar o repositório novo: conta (GitHub ou GitLab), usuário ou grupo, nome e privacidade. */
export function CamposNovoRepo({ contas, valor, onChange }: { contas: any[]; valor: NovoRepo; onChange: (v: NovoRepo) => void }) {
  const [lugares, setLugares] = useState<any[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  useEffect(() => {
    if (!valor.accountId && contas.length) onChange({ ...valor, accountId: contas[0].id });
  }, [contas, valor, onChange]);
  useEffect(() => {
    setLugares(null);
    setErro(null);
    if (!valor.accountId) return;
    api<any[]>(`/git/accounts/${valor.accountId}/namespaces`)
      .then((l) => {
        setLugares(l);
        if (l.length && !l.some((x) => x.id === valor.namespace)) onChange({ ...valor, namespace: l[0].id, tipoNamespace: l[0].tipo });
      })
      .catch((e) => setErro(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valor.accountId]);
  if (!contas.length) return <span className="muted small">Cadastre primeiro a conta do GitHub ou do GitLab em <Link to="/contas">Conexões</Link>.</span>;
  return (
    <>
      <label>
        Criar em
        <select value={valor.accountId} onChange={(e) => onChange({ ...valor, accountId: e.target.value, namespace: '' })}>
          {contas.map((c) => <option key={c.id} value={c.id}>{c.nome} — {c.host}</option>)}
        </select>
      </label>
      <label>
        Dono (seu usuário ou um grupo/organização)
        <select
          value={valor.namespace}
          disabled={!lugares}
          onChange={(e) => {
            const l = lugares!.find((x) => x.id === e.target.value);
            onChange({ ...valor, namespace: l.id, tipoNamespace: l.tipo });
          }}
        >
          {!lugares && <option>Carregando…</option>}
          {lugares?.map((l) => <option key={l.id} value={l.id}>{l.nome}{l.tipo === 'grupo' ? ' (grupo)' : ' (você)'}</option>)}
        </select>
      </label>
      {erro && <div className="error">{erro}</div>}
      <label>Nome do repositório<input value={valor.nome} onChange={(e) => onChange({ ...valor, nome: e.target.value })} required placeholder="ex.: painel-de-vendas" /></label>
      <label className="row small" style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <input type="checkbox" checked={valor.privado} style={{ width: 'auto' }} onChange={(e) => onChange({ ...valor, privado: e.target.checked })} />
        Repositório privado
      </label>
    </>
  );
}

/** Escolher um dos repositórios da conta, sem digitar o endereço. */
export function EscolherRepo({ contas, onEscolher }: { contas: any[]; onEscolher: (r: { url: string; branch: string; accountId: string; nome: string }) => void }) {
  const [conta, setConta] = useState(contas[0]?.id ?? '');
  const [busca, setBusca] = useState('');
  const [lista, setLista] = useState<any[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  useEffect(() => {
    if (!conta && contas.length) setConta(contas[0].id);
  }, [contas, conta]);
  useEffect(() => {
    if (!conta) return;
    setErro(null);
    const t = setTimeout(() => {
      api<any[]>(`/git/accounts/${conta}/repos?busca=${encodeURIComponent(busca)}`)
        .then(setLista)
        .catch((e) => setErro(e.message));
    }, 300);
    return () => clearTimeout(t);
  }, [conta, busca]);
  if (!contas.length) return null;
  return (
    <div className="campo escolher-repo">
      <div className="row">
        <select value={conta} onChange={(e) => { setConta(e.target.value); setLista(null); }} style={{ flex: 1 }}>
          {contas.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
        </select>
        <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar pelo nome" style={{ flex: 1 }} />
      </div>
      {erro && <div className="error">{erro}</div>}
      <div className="lista-repos">
        {lista === null && !erro && <span className="muted small">Carregando seus repositórios…</span>}
        {lista?.length === 0 && <span className="muted small">Nenhum repositório encontrado.</span>}
        {lista?.map((r) => (
          <button type="button" key={r.url} className="repo-item" onClick={() => onEscolher({ url: r.url, branch: r.branch, accountId: conta, nome: r.nome })}>
            <b>{r.nome}</b> <span className="muted small">{r.privado ? 'privado' : 'público'} · {r.branch}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export const nomeRepoPadrao = (t: string) =>
  t.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
