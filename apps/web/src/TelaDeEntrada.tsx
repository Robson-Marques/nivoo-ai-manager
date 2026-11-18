import { Marca } from './Marca';
import { FormEvent, useEffect, useState } from 'react';
import { entrarComLogin, entrarComToken, ouvirEntrada, statusDeEntrada } from './api';

/**
 * Entrada no Nivoo quando o servidor pede autenticação. Dois jeitos, conforme o servidor:
 *  - login por usuário e senha (domínio próprio, sem Cloudflare): NIVOO_LOGIN_USUARIO/SENHA;
 *  - token de acesso (túnel SSH, ou domínio sem login da Cloudflare): NIVOO_API_TOKEN.
 * Com o login da Cloudflare configurado, esta tela não aparece. Fica guardado neste navegador.
 */
export function TelaDeEntrada() {
  const [pedindo, setPedindo] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [porSenha, setPorSenha] = useState(false);
  const [usuario, setUsuario] = useState('');
  const [senha, setSenha] = useState('');
  const [token, setToken] = useState('');
  const [ocupado, setOcupado] = useState(false);
  useEffect(
    () =>
      ouvirEntrada((p, e) => {
        setPedindo(p);
        setErro(e ?? null);
        if (p) statusDeEntrada().then((s) => setPorSenha(s.loginDisponivel)).catch(() => undefined);
      }),
    [],
  );
  if (!pedindo) return null;
  const entrar = async (e: FormEvent) => {
    e.preventDefault();
    setOcupado(true);
    try {
      if (porSenha) await entrarComLogin(usuario.trim(), senha);
      else await entrarComToken(token);
    } finally {
      setOcupado(false);
    }
  };
  return (
    <div className="entrada-fundo">
      <form className="entrada-caixa" onSubmit={entrar}>
        <h1><Marca tamanho={40} /></h1>
        {porSenha ? (
          <>
            <p>Entre com o seu usuário e senha.</p>
            <label>
              Usuário
              <input autoFocus value={usuario} onChange={(e) => setUsuario(e.target.value)} placeholder="seu usuário" autoComplete="username" />
            </label>
            <label>
              Senha
              <input type="password" value={senha} onChange={(e) => setSenha(e.target.value)} placeholder="sua senha" autoComplete="current-password" />
            </label>
            {erro && <div className="error">{erro}</div>}
            <button disabled={ocupado || !usuario.trim() || !senha}>{ocupado ? 'Entrando…' : 'Entrar'}</button>
            <p className="muted small">
              Esqueceu? No servidor, como root, veja <code>NIVOO_LOGIN_USUARIO</code> e <code>NIVOO_LOGIN_SENHA</code> em <code>/etc/nivoo/nivoo.env</code>.
            </p>
          </>
        ) : (
          <>
            <p>Para entrar neste servidor, cole o token de acesso. É pedido uma vez só neste navegador.</p>
            <label>
              Token de acesso
              <input type="password" autoFocus value={token} onChange={(e) => setToken(e.target.value)} placeholder="cole aqui" />
            </label>
            {erro && <div className="error">{erro}</div>}
            <button disabled={ocupado || !token.trim()}>{ocupado ? 'Conferindo…' : 'Entrar'}</button>
            <p className="muted small">
              Onde está: no servidor, como root, <code>grep NIVOO_API_TOKEN /etc/nivoo/nivoo.env</code> (o que vem depois do =). Com o login da Cloudflare
              configurado (<code>nivoo dominio acesso</code>), esta tela não aparece.
            </p>
          </>
        )}
      </form>
    </div>
  );
}
