import { FormEvent, ReactNode, useCallback, useEffect, useState } from 'react';
import { api } from '../api';

/**
 * Conexões: as IAs que trabalham nos projetos (Claude, ChatGPT, Gemini — pela conta ou por chave de API)
 * e as contas Git (GitHub, GitLab). Quantas quiser de cada tipo, cada uma com o seu nome
 * (ex.: "ChatGPT 1" e "ChatGPT 2"); logins e chaves nunca se misturam.
 */

const EM_ANDAMENTO = ['iniciando', 'aguardando_codigo', 'aguardando_site'];

const TIPOS_GIT = [
  { tipo: 'github', ia: 'GitHub', modo: 'git', descricao: 'Repositórios no github.com' },
  { tipo: 'gitlab', ia: 'GitLab', modo: 'git', descricao: 'Seu GitLab (servidor próprio)' },
];

export function Contas() {
  const [ias, setIas] = useState<any[] | null>(null);
  const [gits, setGits] = useState<any[] | null>(null);
  const [nova, setNova] = useState(false);
  const [abrir, setAbrir] = useState<string | null>(null); // conexão recém-criada: já abre o login/chave
  const [atualizando, setAtualizando] = useState(false);
  const carregar = useCallback(async (atualizar = false) => {
    const [a, g] = await Promise.all([api<any[]>(`/accounts${atualizar ? '?atualizar=1' : ''}`), api<any[]>('/git/accounts')]);
    setIas(a);
    setGits(g);
  }, []);
  useEffect(() => {
    carregar().catch(() => {
      setIas([]);
      setGits([]);
    });
  }, [carregar]);
  const total = (ias?.length ?? 0) + (gits?.length ?? 0);
  return (
    <div className="pagina">
      <div className="conexoes">
        <h1>Conexões</h1>
        <p className="muted">IAs que trabalham nos projetos e contas Git. Pode ter quantas quiser de cada tipo, cada uma com o seu nome; cada projeto escolhe qual usa.</p>
        <div className="conexoes-topo">
          <h2>Conexões cadastradas ({total})</h2>
          <div className="row">
            <button
              className="icone-botao"
              title="Conferir todas agora"
              aria-label="Conferir todas agora"
              disabled={atualizando}
              onClick={async () => {
                setAtualizando(true);
                await carregar(true).finally(() => setAtualizando(false));
              }}
            >
              <Icone nome="atualizar" girando={atualizando} />
            </button>
            <button className="botao-nova" onClick={() => setNova(true)}>
              <Icone nome="mais" /> Nova
            </button>
          </div>
        </div>

        {ias === null && <p className="muted small">Carregando…</p>}
        {ias !== null && total === 0 && (
          <div className="conexoes-vazio">
            <p>Nenhuma conexão ainda.</p>
            <button onClick={() => setNova(true)}>Criar a primeira conexão</button>
          </div>
        )}
        {!!ias?.length && <div className="conexoes-grupo">Inteligência artificial</div>}
        {ias?.map((c) => <ConexaoIa key={c.id} c={c} abrirAgora={abrir === c.id} onMudou={() => carregar()} />)}
        {!!gits?.length && <div className="conexoes-grupo">Git</div>}
        {gits?.map((g) => <ConexaoGit key={g.id} g={g} onMudou={() => carregar()} />)}
      </div>
      {nova && (
        <NovaConexao
          ias={ias ?? []}
          onFechar={() => setNova(false)}
          onCriada={async (id) => {
            setNova(false);
            setAbrir(id);
            await carregar();
          }}
        />
      )}
    </div>
  );
}

/** Linha de uma conexão: ícone, nome, selos, estado e ações (como uma lista de integrações). */
function Linha({ icone, nome, selos, detalhe, estado, acoes, children }: { icone: ReactNode; nome: string; selos: ReactNode; detalhe: ReactNode; estado: ReactNode; acoes: ReactNode; children?: ReactNode }) {
  return (
    <div className="conexao">
      <div className="conexao-linha">
        <div className="conexao-icone">{icone}</div>
        <div className="conexao-info">
          <div className="conexao-nome">
            <b>{nome}</b>
            {selos}
          </div>
          <div className="conexao-detalhe">{detalhe}</div>
          <div>{estado}</div>
        </div>
        <div className="conexao-acoes">{acoes}</div>
      </div>
      {children}
    </div>
  );
}

function BotaoIcone({ nome, titulo, onClick, perigo, disabled }: { nome: string; titulo: string; onClick: () => void; perigo?: boolean; disabled?: boolean }) {
  return (
    <button className={perigo ? 'icone-botao perigo' : 'icone-botao'} title={titulo} aria-label={titulo} onClick={onClick} disabled={disabled}>
      <Icone nome={nome} />
    </button>
  );
}

function Estado({ ok, texto }: { ok: boolean | 'andamento'; texto: string }) {
  return <span className={ok === true ? 'estado ok' : ok === 'andamento' ? 'estado andamento' : 'estado'}><Icone nome={ok === true ? 'sinal' : ok === 'andamento' ? 'relogio' : 'aviso'} /> {texto}</span>;
}

function ConexaoIa({ c, abrirAgora, onMudou }: { c: any; abrirAgora: boolean; onMudou: () => void }) {
  const [login, setLogin] = useState<any>(c.login && EM_ANDAMENTO.includes(c.login.state) ? c.login : null);
  const [codigo, setCodigo] = useState('');
  const [chave, setChave] = useState('');
  const [mostrarChave, setMostrarChave] = useState(abrirAgora && c.modo === 'api' && !c.conectado);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const emAndamento = login && EM_ANDAMENTO.includes(login.state);

  const acao = useCallback(async (fn: () => Promise<any>) => {
    setErro(null);
    setAviso(null);
    try {
      return await fn();
    } catch (e: any) {
      setErro(e.message);
    }
  }, []);
  const conectar = useCallback(() => acao(async () => setLogin(await api(`/accounts/${c.id}/login`, 'POST'))), [acao, c.id]);
  // Conexão pela conta recém-criada: o login já começa.
  useEffect(() => {
    if (abrirAgora && c.modo === 'conta' && !c.conectado && c.instalado) conectar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abrirAgora]);
  useEffect(() => {
    if (!emAndamento) return;
    const t = setInterval(async () => {
      try {
        const s = await api(`/accounts/${c.id}/login`);
        setLogin(s);
        if (s.state === 'conectado') onMudou();
      } catch {
        /* segue tentando */
      }
    }, 2000);
    return () => clearInterval(t);
  }, [emAndamento, c.id, onMudou]);

  const enviarCodigo = (e: FormEvent) => {
    e.preventDefault();
    acao(async () => {
      setLogin(await api(`/accounts/${c.id}/login/code`, 'POST', { code: codigo }));
      setCodigo('');
    });
  };
  const salvarChave = (e: FormEvent) => {
    e.preventDefault();
    acao(async () => {
      await api(`/accounts/${c.id}/key`, 'POST', { key: chave });
      setChave('');
      setMostrarChave(false);
      onMudou();
    });
  };
  const renomear = () => {
    const n = window.prompt('Nome desta conexão:', c.nome);
    if (n?.trim() && n.trim() !== c.nome) acao(async () => { await api(`/accounts/${c.id}`, 'PATCH', { nome: n.trim() }); onMudou(); });
  };
  const excluir = () => {
    if (!window.confirm(`Excluir a conexão "${c.nome}"? O login/chave dela é apagado deste servidor.`)) return;
    acao(async () => { await api(`/accounts/${c.id}`, 'DELETE'); onMudou(); });
  };
  const desconectar = () => {
    if (!window.confirm(`Desconectar "${c.nome}"? A conexão continua na lista para conectar de novo.`)) return;
    acao(async () => { await api(`/accounts/${c.id}/disconnect`, 'POST'); onMudou(); });
  };

  const estado = emAndamento ? (
    <Estado ok="andamento" texto="Conectando…" />
  ) : c.conectado ? (
    <Estado ok texto="Conectado" />
  ) : (
    <Estado ok={false} texto={c.instalado ? 'Não conectado' : 'Programa da IA não instalado no servidor'} />
  );
  const detalhe = [c.modo === 'conta' ? c.conta : `chave de API (${c.ondeChave})`, c.projetos ? `usada em ${c.projetos} projeto(s)` : null, c.configuradoPeloAdministrador ? 'configurada pelo administrador' : null]
    .filter(Boolean)
    .join(' · ');
  return (
    <Linha
      icone={<span className={`marca marca-${c.ia.toLowerCase()}`}>{c.ia[0]}</span>}
      nome={c.nome}
      selos={
        <>
          <span className="selo-tipo">{c.ia} · {c.modo === 'conta' ? 'conta' : 'API'}</span>
          {c.padrao && <span className="selo-padrao"><Icone nome="estrela" /> padrão</span>}
        </>
      }
      detalhe={detalhe}
      estado={estado}
      acoes={
        <>
          {c.modo === 'conta' && !emAndamento && <BotaoIcone nome="plugue" titulo={c.conectado ? 'Reconectar (entrar de novo)' : 'Conectar'} onClick={conectar} disabled={!c.instalado} />}
          {c.modo === 'api' && <BotaoIcone nome="chave" titulo={c.conectado ? 'Trocar a chave' : 'Informar a chave'} onClick={() => setMostrarChave(!mostrarChave)} />}
          {!c.padrao && <BotaoIcone nome="estrela" titulo="Usar como padrão nos projetos novos" onClick={() => acao(async () => { await api(`/accounts/${c.id}`, 'PATCH', { padrao: true }); onMudou(); })} />}
          <BotaoIcone nome="lapis" titulo="Renomear" onClick={renomear} />
          {c.conectado && !c.configuradoPeloAdministrador && <BotaoIcone nome="desligar" titulo="Desconectar" onClick={desconectar} />}
          <BotaoIcone nome="lixeira" titulo="Excluir conexão" onClick={excluir} perigo />
        </>
      }
    >
      {emAndamento && (
        <div className="conexao-painel">
          <p>{login.message}</p>
          {login.url && <a href={login.url} target="_blank" rel="noreferrer noopener" className="botao-link">Abrir o link de login</a>}
          {login.userCode && <p>Código para digitar no site: <b className="codigo">{login.userCode}</b></p>}
          {login.state === 'aguardando_codigo' && (
            <form className="row" onSubmit={enviarCodigo}>
              <input value={codigo} onChange={(e) => setCodigo(e.target.value)} placeholder="Cole aqui o código que apareceu" />
              <button disabled={!codigo.trim()}>Enviar código</button>
            </form>
          )}
          <button className="link" onClick={() => acao(async () => { await api(`/accounts/${c.id}/login`, 'DELETE'); setLogin(null); })}>cancelar</button>
        </div>
      )}
      {mostrarChave && (
        <form className="conexao-painel row" onSubmit={salvarChave}>
          <input type="password" autoFocus value={chave} onChange={(e) => setChave(e.target.value)} placeholder={`Cole a chave de API (crie em ${c.ondeChave})`} />
          <button disabled={!chave.trim()}>Salvar chave</button>
        </form>
      )}
      {login?.state === 'erro' && <div className="conexao-painel error">{login.message}</div>}
      {login?.state === 'conectado' && <div className="conexao-painel ok-msg">{login.message}</div>}
      {!c.conectado && !emAndamento && c.problema && c.instalado && !login && !/^não conectado/.test(c.problema) && <div className="conexao-painel muted small">{c.problema}</div>}
      {aviso && <div className="conexao-painel ok-msg">{aviso}</div>}
      {erro && <div className="conexao-painel error">{erro}</div>}
    </Linha>
  );
}

function ConexaoGit({ g, onMudou }: { g: any; onMudou: () => void }) {
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null);
  const [testando, setTestando] = useState(false);
  const testar = async () => {
    setTestando(true);
    setMsg(null);
    try {
      const r = await api(`/git/accounts/${g.id}/testar`, 'POST');
      setMsg({ ok: true, texto: `Token válido${r.usuario ? ` (usuário ${r.usuario})` : ''}.` });
    } catch (e: any) {
      setMsg({ ok: false, texto: e.message });
    } finally {
      setTestando(false);
    }
  };
  const renomear = async () => {
    const n = window.prompt('Nome desta conexão:', g.nome);
    if (!n?.trim() || n.trim() === g.nome) return;
    try {
      await api(`/git/accounts/${g.id}`, 'PATCH', { nome: n.trim() });
      onMudou();
    } catch (e: any) {
      setMsg({ ok: false, texto: e.message });
    }
  };
  const excluir = async () => {
    if (!window.confirm(`Excluir a conexão "${g.nome}"? O token é apagado deste servidor.`)) return;
    await api(`/git/accounts/${g.id}`, 'DELETE');
    onMudou();
  };
  return (
    <Linha
      icone={<span className="marca marca-git"><Icone nome="ramo" /></span>}
      nome={g.nome}
      selos={<span className="selo-tipo">{g.tipo === 'github' ? 'GitHub' : 'GitLab'}</span>}
      detalhe={[g.host, g.autorNome ? `commits como ${g.autorNome}` : null].filter(Boolean).join(' · ')}
      estado={msg ? <Estado ok={msg.ok} texto={msg.ok ? 'Conectado' : 'Problema no token'} /> : <Estado ok texto="Token salvo" />}
      acoes={
        <>
          <BotaoIcone nome="escudo" titulo="Testar o token agora" onClick={testar} disabled={testando} />
          <BotaoIcone nome="lapis" titulo="Renomear" onClick={renomear} />
          <BotaoIcone nome="lixeira" titulo="Excluir conexão" onClick={excluir} perigo />
        </>
      }
    >
      {msg && <div className={msg.ok ? 'conexao-painel ok-msg' : 'conexao-painel error'}>{msg.texto}</div>}
    </Linha>
  );
}

/** "+ Nova": escolhe o tipo, dá um nome e (Git/API) informa o token ou a chave. */
function NovaConexao({ ias, onFechar, onCriada }: { ias: any[]; onFechar: () => void; onCriada: (id: string) => void }) {
  const [tipos, setTipos] = useState<any[]>([]);
  const [tipo, setTipo] = useState<any | null>(null);
  const [nome, setNome] = useState('');
  const [host, setHost] = useState('');
  const [token, setToken] = useState('');
  const [autorNome, setAutorNome] = useState('');
  const [autorEmail, setAutorEmail] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  useEffect(() => {
    api<any[]>('/accounts/tipos').then(setTipos).catch(() => undefined);
  }, []);
  const escolher = (t: any) => {
    setTipo(t);
    setErro(null);
    if (t.modo === 'git') return setNome(t.ia);
    // Sugere "ChatGPT 2" quando já existe "ChatGPT".
    const usados = new Set(ias.map((c) => c.nome.toLowerCase()));
    let n = t.nomePadrao;
    for (let i = 2; usados.has(n.toLowerCase()); i++) n = `${t.nomePadrao} ${i}`;
    setNome(n);
  };
  const criar = async (e: FormEvent) => {
    e.preventDefault();
    setErro(null);
    setOcupado(true);
    try {
      if (tipo.modo === 'git') {
        const g = await api('/git/accounts', 'POST', {
          tipo: tipo.tipo,
          host: tipo.tipo === 'github' ? 'https://github.com' : host,
          token,
          nome: nome || undefined,
          autorNome: autorNome || undefined,
          autorEmail: autorEmail || undefined,
        });
        onCriada(g.id);
      } else {
        const c = await api('/accounts', 'POST', { tipo: tipo.tipo, nome });
        if (tipo.modo === 'api' && token.trim()) await api(`/accounts/${c.id}/key`, 'POST', { key: token.trim() });
        onCriada(c.id);
      }
    } catch (err: any) {
      setErro(err.message);
    } finally {
      setOcupado(false);
    }
  };
  const todos = [...tipos, ...TIPOS_GIT];
  return (
    <div className="modal-fundo" onClick={onFechar}>
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={criar}>
        <h2>Nova conexão</h2>
        {!tipo ? (
          <>
            <p className="muted small">Escolha o tipo. Pode criar quantas quiser de cada um (ex.: duas contas do ChatGPT).</p>
            <div className="tipos-conexao">
              {todos.map((t) => (
                <button type="button" key={t.tipo} className="tipo-conexao" onClick={() => escolher(t)}>
                  <span className={`marca marca-${t.modo === 'git' ? 'git' : t.ia.toLowerCase()}`}>{t.modo === 'git' ? <Icone nome="ramo" /> : t.ia[0]}</span>
                  <span>
                    <b>{t.ia}{t.modo === 'conta' ? ' — conta' : t.modo === 'api' ? ' — chave de API' : ''}</b>
                    <span className="muted small">{t.modo === 'conta' ? t.conta : t.modo === 'api' ? `cobrança por uso (${t.ondeChave})` : t.descricao}</span>
                  </span>
                </button>
              ))}
            </div>
            <div className="row"><button type="button" className="secondary" onClick={onFechar}>Cancelar</button></div>
          </>
        ) : (
          <>
            <div className="row small"><button type="button" className="link" onClick={() => setTipo(null)}>← trocar o tipo</button> <span className="selo-tipo">{tipo.ia}{tipo.modo === 'conta' ? ' · conta' : tipo.modo === 'api' ? ' · API' : ''}</span></div>
            <label>Nome da conexão<input autoFocus value={nome} onChange={(e) => setNome(e.target.value)} required maxLength={60} placeholder="Ex.: ChatGPT da empresa" /></label>
            {tipo.modo === 'conta' && <p className="muted small">Ao criar, o login começa: abra o link, entre com a {tipo.conta} e siga as instruções. Cada conexão tem o seu próprio login.</p>}
            {tipo.modo === 'api' && <label>Chave de API<input type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder={`Crie em ${tipo.ondeChave} (pode informar depois)`} /></label>}
            {tipo.modo === 'git' && (
              <>
                {tipo.tipo === 'gitlab' && <label>Endereço do GitLab<input value={host} onChange={(e) => setHost(e.target.value)} required placeholder="https://git.suaempresa.com.br" /></label>}
                <label>
                  Token de acesso
                  <input type="password" value={token} onChange={(e) => setToken(e.target.value)} required placeholder={tipo.tipo === 'github' ? 'GitHub → Settings → Developer settings → Personal access tokens' : 'GitLab → Preferências → Access Tokens (escopo api)'} />
                </label>
                <span className="muted small">Para criar repositórios pelo Nivoo: GitHub "Administration" de escrita (ou token clássico com repo); GitLab escopo api. O token fica no servidor e nunca vai para a IA.</span>
                <div className="row">
                  <label style={{ flex: 1 }}>Autor dos commits (opcional)<input value={autorNome} onChange={(e) => setAutorNome(e.target.value)} placeholder="Seu nome" /></label>
                  <label style={{ flex: 1 }}>E-mail do autor (opcional)<input value={autorEmail} onChange={(e) => setAutorEmail(e.target.value)} placeholder="voce@exemplo.com" /></label>
                </div>
              </>
            )}
            {erro && <div className="error">{erro}</div>}
            <div className="row">
              <button disabled={ocupado || !nome.trim() || (tipo.modo === 'git' && (!token.trim() || (tipo.tipo === 'gitlab' && !host.trim())))}>
                {ocupado ? (tipo.modo === 'git' ? 'Conferindo o token…' : 'Criando…') : tipo.modo === 'conta' ? 'Criar e conectar' : 'Criar conexão'}
              </button>
              <button type="button" className="secondary" onClick={onFechar}>Cancelar</button>
            </div>
          </>
        )}
      </form>
    </div>
  );
}

/** Ícones de traço simples (desenhados aqui; sem biblioteca externa). */
export function Icone({ nome, girando }: { nome: string; girando?: boolean }) {
  const p: Record<string, ReactNode> = {
    atualizar: <><path d="M20 11a8 8 0 1 0-2.3 5.7" /><path d="M20 4v7h-7" /></>,
    mais: <><path d="M12 5v14" /><path d="M5 12h14" /></>,
    estrela: <path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z" />,
    lapis: <><path d="M4 20h4L19 9l-4-4L4 16z" /><path d="m14 6 4 4" /></>,
    lixeira: <><path d="M4 7h16" /><path d="M9 7V4h6v3" /><path d="M6 7l1 13h10l1-13" /></>,
    plugue: <><path d="M9 3v5" /><path d="M15 3v5" /><path d="M6 8h12v3a6 6 0 0 1-12 0z" /><path d="M12 17v4" /></>,
    desligar: <><path d="M12 3v9" /><path d="M6.3 7.5a8 8 0 1 0 11.4 0" /></>,
    chave: <><circle cx="8" cy="15" r="4" /><path d="m11 12 9-9" /><path d="m17 6 3 3" /></>,
    escudo: <><path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z" /><path d="m9 12 2 2 4-4" /></>,
    ramo: <><circle cx="6" cy="5" r="2" /><circle cx="6" cy="19" r="2" /><circle cx="18" cy="8" r="2" /><path d="M6 7v10" /><path d="M18 10c0 4-6 3-11.5 7.5" /></>,
    sinal: <><path d="M5 12a10 10 0 0 1 14 0" /><path d="M8.5 15.5a5 5 0 0 1 7 0" /><circle cx="12" cy="19" r="1" /></>,
    aviso: <><circle cx="12" cy="12" r="9" /><path d="M12 8v5" /><path d="M12 16h.01" /></>,
    relogio: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  };
  return (
    <svg className={girando ? 'icone girando' : 'icone'} viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {p[nome]}
    </svg>
  );
}
