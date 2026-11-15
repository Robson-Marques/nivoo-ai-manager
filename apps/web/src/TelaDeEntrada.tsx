import { Marca } from './Marca';
import { FormEvent, useEffect, useState } from 'react';
import { entrarComToken, ouvirEntrada } from './api';

/**
 * Entrada no Nivoo quando o servidor pede o token (acesso pelo túnel SSH, ou domínio sem o login da
 * Cloudflare configurado). Aparece uma vez; o token fica guardado neste navegador.
 */
export function TelaDeEntrada() {
  const [pedindo, setPedindo] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [token, setToken] = useState('');
  const [ocupado, setOcupado] = useState(false);
  useEffect(
    () =>
      ouvirEntrada((p, e) => {
        setPedindo(p);
        setErro(e ?? null);
      }),
    [],
  );
  if (!pedindo) return null;
  const entrar = async (e: FormEvent) => {
    e.preventDefault();
    setOcupado(true);
    await entrarComToken(token).finally(() => setOcupado(false));
  };
  return (
    <div className="entrada-fundo">
      <form className="entrada-caixa" onSubmit={entrar}>
        <h1><Marca tamanho={40} /></h1>
        <p>Para entrar neste servidor, cole o token de acesso. É pedido uma vez só neste navegador.</p>
        <label>
          Token de acesso
          <input type="password" autoFocus value={token} onChange={(e) => setToken(e.target.value)} placeholder="cole aqui" />
        </label>
        {erro && <div className="error">{erro}</div>}
        <button disabled={ocupado || !token.trim()}>{ocupado ? 'Conferindo…' : 'Entrar'}</button>
        <p className="muted small">
          Onde está: no servidor, como root, <code>grep NIVOO_API_TOKEN /etc/nivoo/nivoo.env</code> (o que vem depois do =). Com o login da Cloudflare
          configurado no servidor (<code>nivoo dominio acesso</code>), esta tela não aparece.
        </p>
      </form>
    </div>
  );
}
