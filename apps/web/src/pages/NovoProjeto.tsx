import { FormEvent, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, nomeUsuario } from '../api';
import { CamposNovoRepo, EscolherRepo, NovoRepo, nomeRepoPadrao, SeletorContaGit } from './Git';

/** Novo projeto: nome, do que se trata, modelo e qual IA vai trabalhar nele. */
export function NovoProjeto({ onFechar, onCriado }: { onFechar: () => void; onCriado: (id: string) => void }) {
  const [nome, setNome] = useState('');
  const [sobre, setSobre] = useState('');
  const [modelo, setModelo] = useState('geral');
  const [ia, setIa] = useState('claude-code-cli');
  const [modelos, setModelos] = useState<any[]>([]);
  const [contas, setContas] = useState<any[]>([]);
  const [origem, setOrigem] = useState<'zero' | 'git' | 'novo'>('zero');
  const [novoRepo, setNovoRepo] = useState<NovoRepo>({ accountId: '', namespace: '', tipoNamespace: 'usuario', nome: '', privado: true });
  const [digitar, setDigitar] = useState(false);
  const [repo, setRepo] = useState('');
  const [branch, setBranch] = useState('main');
  const [contaGit, setContaGit] = useState('');
  const [contasGit, setContasGit] = useState<any[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  useEffect(() => {
    api<any[]>('/areas').then(setModelos).catch(() => undefined);
    api<any[]>('/git/accounts').then(setContasGit).catch(() => undefined);
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
      const git = origem === 'git' ? { url: repo, branch, accountId: contaGit || undefined } : undefined;
      const p = await api('/projects', 'POST', { name: nome, description: sobre, base: modelo, provider: ia, author: nomeUsuario(), git });
      if (origem === 'novo') {
        try {
          await api(`/projects/${p.id}/git/create`, 'POST', { ...novoRepo, nome: novoRepo.nome || nomeRepoPadrao(nome) });
        } catch (err: any) {
          window.alert(`O projeto foi criado, mas o repositório não: ${err.message}\nTente de novo na aba Git do projeto.`);
        }
      }
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
          <span>Começar</span>
          <div className="tipos tres">
            <button type="button" className={origem === 'zero' ? 'tipo on' : 'tipo'} onClick={() => setOrigem('zero')}><b>Do zero</b><span>pasta nova, só aqui</span></button>
            <button type="button" className={origem === 'novo' ? 'tipo on' : 'tipo'} onClick={() => setOrigem('novo')}><b>Do zero + repositório novo</b><span>cria o repositório no GitHub/GitLab e mantém atualizado</span></button>
            <button type="button" className={origem === 'git' ? 'tipo on' : 'tipo'} onClick={() => setOrigem('git')}><b>Trazer de um repositório Git</b><span>projeto que você já tem no GitHub/GitLab</span></button>
          </div>
          {origem === 'novo' && <CamposNovoRepo contas={contasGit} valor={{ ...novoRepo, nome: novoRepo.nome || nomeRepoPadrao(nome) }} onChange={setNovoRepo} />}
          {origem === 'git' && (
            <>
              {contasGit.length > 0 && !digitar && (
                <>
                  <EscolherRepo contas={contasGit} onEscolher={(r) => { setRepo(r.url); setBranch(r.branch); setContaGit(r.accountId); if (!nome) setNome(r.nome.split('/').pop() ?? ''); }} />
                  {repo && <span className="small">Escolhido: <b className="mono">{repo}</b> (branch {branch})</span>}
                  <button type="button" className="link small" onClick={() => setDigitar(true)}>digitar o endereço</button>
                </>
              )}
              {(contasGit.length === 0 || digitar) && (
                <>
                  <label>Endereço do repositório<input value={repo} onChange={(e) => setRepo(e.target.value)} required placeholder="https://git.suaempresa.com.br/grupo/projeto.git (ou git@...)" /></label>
                  <label>Branch<input value={branch} onChange={(e) => setBranch(e.target.value)} /></label>
                  <SeletorContaGit contas={contasGit} valor={contaGit} onChange={setContaGit} />
                </>
              )}
            </>
          )}
        </div>
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
          <button disabled={ocupado || !nome.trim() || (origem === 'git' && !repo.trim()) || (origem === 'novo' && (!contasGit.length || !novoRepo.namespace))}>{ocupado ? (origem === 'git' ? 'Baixando o repositório…' : origem === 'novo' ? 'Criando o projeto e o repositório…' : 'Criando…') : 'Criar projeto'}</button>
        </div>
      </form>
    </div>
  );
}
