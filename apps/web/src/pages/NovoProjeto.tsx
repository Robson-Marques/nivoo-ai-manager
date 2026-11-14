import { FormEvent, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, nomeUsuario } from '../api';

/** Novo projeto: nome, do que se trata, modelo e qual IA vai trabalhar nele. */
export function NovoProjeto({ onFechar, onCriado }: { onFechar: () => void; onCriado: (id: string) => void }) {
  const [nome, setNome] = useState('');
  const [sobre, setSobre] = useState('');
  const [modelo, setModelo] = useState('geral');
  const [ia, setIa] = useState('claude-code-cli');
  const [modelos, setModelos] = useState<any[]>([]);
  const [contas, setContas] = useState<any[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  useEffect(() => {
    api<any[]>('/areas').then(setModelos).catch(() => undefined);
    api<any[]>('/accounts')
      .then((c) => {
        setContas(c);
        const conectada = c.find((x) => x.conectado);
        if (conectada) setIa(conectada.id);
      })
      .catch(() => undefined);
  }, []);
  const criar = async (e: FormEvent) => {
    e.preventDefault();
    setOcupado(true);
    setErro(null);
    try {
      const p = await api('/projects', 'POST', { name: nome, description: sobre, base: modelo, provider: ia, author: nomeUsuario() });
      onCriado(p.id);
    } catch (err: any) {
      setErro(err.message);
    } finally {
      setOcupado(false);
    }
  };
  return (
    <div className="modal-fundo" onClick={onFechar}>
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={criar}>
        <h2>Novo projeto</h2>
        <label>Nome do projeto<input autoFocus value={nome} onChange={(e) => setNome(e.target.value)} required placeholder="Ex.: Sistema da Pizzaria do Zé" /></label>
        <label>Sobre o que é este projeto?<textarea rows={3} value={sobre} onChange={(e) => setSobre(e.target.value)} placeholder="Conte o objetivo em poucas palavras. Isso vira a primeira memória do projeto." /></label>
        <div className="campo">
          <span>Modelo</span>
          <div className="tipos">
            {modelos.map((m) => (
              <button type="button" key={m.id} className={modelo === m.slug ? 'tipo on' : 'tipo'} onClick={() => setModelo(m.slug)}>
                <b>{m.name}</b>
                <span>{m.description}</span>
              </button>
            ))}
          </div>
          <span className="muted small">
            Falta um modelo? <Link to="/modelos" onClick={onFechar}>Crie em Modelos</Link>.
          </span>
        </div>
        <div className="campo">
          <span>Qual IA vai trabalhar neste projeto?</span>
          <div className="tipos">
            {contas.map((c) => (
              <button type="button" key={c.id} className={ia === c.id ? 'tipo on' : 'tipo'} onClick={() => setIa(c.id)}>
                <b>{c.nome}</b>
                <span>{c.conectado ? 'conectada' : 'não conectada'}</span>
              </button>
            ))}
          </div>
          {contas.length > 0 && !contas.find((c) => c.id === ia)?.conectado && (
            <span className="muted small">
              Esta IA ainda não está conectada. <Link to="/contas" onClick={onFechar}>Conectar em Contas de IA</Link>.
            </span>
          )}
        </div>
        {erro && <div className="error">{erro}</div>}
        <div className="row fim">
          <button type="button" className="secondary" onClick={onFechar}>Cancelar</button>
          <button disabled={ocupado || !nome.trim()}>Criar projeto</button>
        </div>
      </form>
    </div>
  );
}
