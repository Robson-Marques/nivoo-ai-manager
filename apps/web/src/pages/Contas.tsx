import { FormEvent, useCallback, useEffect, useState } from 'react';
import { api } from '../api';

/**
 * Contas de IA: conectar Claude, ChatGPT e Gemini pelo navegador, com o login oficial de cada uma
 * (a página mostra o link; você entra com a sua conta). Chave de API é uma alternativa opcional.
 */
export function Contas() {
  const [contas, setContas] = useState<any[] | null>(null);
  const carregar = useCallback(async () => setContas(await api<any[]>('/accounts')), []);
  useEffect(() => {
    carregar().catch(() => setContas([]));
  }, [carregar]);
  return (
    <div className="pagina">
      <header className="conversa-topo">
        <div>
          <h1>Contas de IA</h1>
          <span className="muted small">Conecte as suas contas. Cada projeto escolhe qual IA trabalha nele.</span>
        </div>
      </header>
      <div className="cartoes uma-coluna">
        {['Claude', 'ChatGPT', 'Gemini'].map((ia) => (
          <section key={ia} className="conta">
            <h2>{ia}</h2>
            <p className="muted small">Conecte pela conta (assinatura), por chave de API (cobrança por uso) ou pelos dois. Cada projeto escolhe qual usar.</p>
            {contas?.filter((c) => c.ia === ia).map((c) => <Conta key={c.id} conta={c} onMudou={carregar} />)}
          </section>
        ))}
      </div>
    </div>
  );
}

function Conta({ conta, onMudou }: { conta: any; onMudou: () => void }) {
  const [login, setLogin] = useState<any>(conta.login && ['iniciando', 'aguardando_codigo', 'aguardando_site'].includes(conta.login.state) ? conta.login : null);
  const [codigo, setCodigo] = useState('');
  const [chave, setChave] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const emAndamento = login && ['iniciando', 'aguardando_codigo', 'aguardando_site'].includes(login.state);

  useEffect(() => {
    if (!emAndamento) return;
    const t = setInterval(async () => {
      try {
        const s = await api(`/accounts/${conta.id}/login`);
        setLogin(s);
        if (s.state === 'conectado') onMudou();
      } catch {
        /* segue tentando */
      }
    }, 2000);
    return () => clearInterval(t);
  }, [emAndamento, conta.id, onMudou]);

  const acao = async (fn: () => Promise<any>) => {
    setErro(null);
    try {
      return await fn();
    } catch (e: any) {
      setErro(e.message);
    }
  };
  const conectar = () => acao(async () => setLogin(await api(`/accounts/${conta.id}/login`, 'POST')));
  const enviarCodigo = (e: FormEvent) => {
    e.preventDefault();
    acao(async () => {
      setLogin(await api(`/accounts/${conta.id}/login/code`, 'POST', { code: codigo }));
      setCodigo('');
    });
  };
  const salvarChave = (e: FormEvent) => {
    e.preventDefault();
    acao(async () => {
      await api(`/accounts/${conta.id}/key`, 'POST', { key: chave });
      setChave('');
      onMudou();
    });
  };

  const titulo = conta.tipo === 'conta' ? `Conta (${conta.conta})` : 'Chave de API';
  return (
    <div className="conta-opcao">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div>
          <b>{titulo}</b> <span className={conta.conectado ? 'selo ok' : 'selo'}>{conta.conectado ? 'Conectado' : 'Não conectado'}</span>
          {conta.desabilitado && <span className="muted small"> (desabilitado pelo administrador)</span>}
        </div>
        <div className="row">
          {conta.tipo === 'conta' && !conta.conectado && !emAndamento && <button onClick={conectar} disabled={!conta.instalado}>Conectar</button>}
          {conta.conectado && !conta.configuradoPeloAdministrador && (
            <button className="danger" onClick={() => window.confirm(`Desconectar ${conta.nome}?`) && acao(async () => { await api(`/accounts/${conta.id}`, 'DELETE'); onMudou(); })}>Desconectar</button>
          )}
        </div>
      </div>
      {!conta.instalado && <p className="muted small">O programa oficial desta IA não está instalado no servidor. Rode a atualização do sistema (nivoo update).</p>}

      {emAndamento && (
        <div className="login-passos">
          <p>{login.message}</p>
          {login.url && (
            <p>
              <a href={login.url} target="_blank" rel="noreferrer noopener" className="botao-link">Abrir o link de login</a>
            </p>
          )}
          {login.userCode && (
            <p>
              Código para digitar no site: <b className="codigo">{login.userCode}</b>
            </p>
          )}
          {login.state === 'aguardando_codigo' && (
            <form className="row" onSubmit={enviarCodigo}>
              <input value={codigo} onChange={(e) => setCodigo(e.target.value)} placeholder="Cole aqui o código que apareceu" />
              <button disabled={!codigo.trim()}>Enviar código</button>
            </form>
          )}
          <button className="link" onClick={() => acao(async () => { await api(`/accounts/${conta.id}/login`, 'DELETE'); setLogin(null); })}>cancelar</button>
        </div>
      )}
      {login && login.state === 'erro' && <div className="error">{login.message}</div>}
      {login && login.state === 'conectado' && <div className="ok-msg">{login.message}</div>}

      {conta.tipo === 'api' && !conta.conectado && (
        <form className="row" onSubmit={salvarChave}>
          <input type="password" value={chave} onChange={(e) => setChave(e.target.value)} placeholder={`Cole a chave de API (crie em ${conta.ondeChave})`} />
          <button disabled={!chave.trim()}>Salvar chave</button>
        </form>
      )}
      {erro && <div className="error">{erro}</div>}
    </div>
  );
}
