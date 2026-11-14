import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';

/**
 * Git em linguagem simples: contas (GitHub, GitLab próprio) e, no projeto, ligar a um repositório,
 * atualizar (pull), enviar (push + versão/tag) e envio automático. O token nunca chega à IA.
 */

export function ContasGit() {
  const [contas, setContas] = useState<any[]>([]);
  const [tipo, setTipo] = useState<'github' | 'gitlab'>('github');
  const [host, setHost] = useState('');
  const [token, setToken] = useState('');
  const [nome, setNome] = useState('');
  const [autorNome, setAutorNome] = useState('');
  const [autorEmail, setAutorEmail] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const carregar = useCallback(async () => setContas(await api<any[]>('/git/accounts')), []);
  useEffect(() => {
    carregar().catch(() => undefined);
  }, [carregar]);
  const salvar = async (e: FormEvent) => {
    e.preventDefault();
    setErro(null);
    setOcupado(true);
    try {
      await api('/git/accounts', 'POST', { tipo, host: tipo === 'github' ? 'https://github.com' : host, token, nome: nome || undefined, autorNome: autorNome || undefined, autorEmail: autorEmail || undefined });
      setToken('');
      setNome('');
      await carregar();
    } catch (err: any) {
      setErro(err.message);
    } finally {
      setOcupado(false);
    }
  };
  return (
    <section className="conta">
      <h2>Git (GitHub e GitLab)</h2>
      <p className="muted small">Para trazer projetos que você já tem e enviar o trabalho de volta (commit, versão/tag e push). O token fica guardado no servidor e nunca é entregue à IA.</p>
      {contas.map((c) => (
        <div key={c.id} className="conta-opcao row" style={{ justifyContent: 'space-between' }}>
          <span>
            <b>{c.nome}</b> <span className="muted small">{c.host}{c.autorNome ? ` · commits como ${c.autorNome}` : ''}</span>
          </span>
          <button className="danger" onClick={async () => { if (window.confirm(`Remover a conta ${c.nome}?`)) { await api(`/git/accounts/${c.id}`, 'DELETE'); carregar(); } }}>Remover</button>
        </div>
      ))}
      <form className="conta-opcao campo" onSubmit={salvar}>
        <b>Adicionar conta Git</b>
        <div className="row">
          <button type="button" className={tipo === 'github' ? 'tipo on' : 'tipo'} onClick={() => setTipo('github')}><b>GitHub</b></button>
          <button type="button" className={tipo === 'gitlab' ? 'tipo on' : 'tipo'} onClick={() => setTipo('gitlab')}><b>GitLab (servidor próprio)</b></button>
        </div>
        {tipo === 'gitlab' && <label>Endereço do GitLab<input value={host} onChange={(e) => setHost(e.target.value)} placeholder="https://git.suaempresa.com.br" required /></label>}
        <label>
          Token de acesso
          <input type="password" value={token} onChange={(e) => setToken(e.target.value)} required placeholder={tipo === 'github' ? 'GitHub → Settings → Developer settings → Personal access tokens' : 'GitLab → Preferências → Access Tokens (escopos read_repository e write_repository)'} />
        </label>
        <label>Nome para mostrar (opcional)<input value={nome} onChange={(e) => setNome(e.target.value)} /></label>
        <div className="row">
          <label style={{ flex: 1 }}>Autor dos commits (opcional)<input value={autorNome} onChange={(e) => setAutorNome(e.target.value)} placeholder="Seu nome" /></label>
          <label style={{ flex: 1 }}>E-mail do autor (opcional)<input value={autorEmail} onChange={(e) => setAutorEmail(e.target.value)} placeholder="voce@exemplo.com" /></label>
        </div>
        {erro && <div className="error">{erro}</div>}
        <div className="row">
          <button disabled={ocupado || !token.trim() || (tipo === 'gitlab' && !host.trim())}>{ocupado ? 'Conferindo o token…' : 'Salvar conta'}</button>
        </div>
      </form>
    </section>
  );
}

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
          <button className="link small" onClick={() => window.confirm('Desligar este projeto do repositório? Nada é apagado.') && acao('unlink', () => api(`/projects/${projeto.id}/git`, 'DELETE'), 'Projeto desligado do repositório.')}>desligar do repositório</button>
        </>
      ) : (
        <form className="campo" onSubmit={(e) => { e.preventDefault(); acao('link', () => api(`/projects/${projeto.id}/git/link`, 'POST', { url, branch, accountId: conta || undefined }), 'Projeto ligado ao repositório. Use "Enviar para o Git" quando quiser publicar.'); }}>
          <b>Ligar a um repositório</b>
          <span className="muted small">Para publicar este projeto no GitHub ou no seu GitLab. Para trazer um projeto que já existe, crie um projeto novo com "Trazer de um repositório Git".</span>
          <label>Endereço do repositório<input value={url} onChange={(e) => setUrl(e.target.value)} required placeholder="https://git.suaempresa.com.br/grupo/projeto.git" /></label>
          <label>Branch<input value={branch} onChange={(e) => setBranch(e.target.value)} /></label>
          <SeletorContaGit contas={contas} valor={conta} onChange={setConta} />
          <div className="row"><button disabled={!!ocupado || !url.trim()}>Ligar</button></div>
        </form>
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
      {contas.length === 0 && <span className="muted small">Repositório privado? Cadastre a conta em <Link to="/contas">Contas</Link>.</span>}
    </label>
  );
}
