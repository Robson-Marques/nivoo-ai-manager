import { FormEvent, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, nomeUsuario } from '../api';
import { CamposNovoRepo, EscolherRepo, NovoRepo, nomeRepoPadrao, SeletorContaGit } from './Git';

/** Novo projeto: nome, do que se trata, agente e qual IA vai trabalhar nele. */
export function NovoProjeto({ onFechar, onCriado, origemInicial = 'zero' }: { onFechar: () => void; onCriado: (id: string) => void; origemInicial?: 'zero' | 'git' | 'novo' }) {
  const [nome, setNome] = useState('');
  const [sobre, setSobre] = useState('');
  const [modelo, setModelo] = useState('geral');
  const [ia, setIa] = useState('claude-code-cli');
  const [modelos, setModelos] = useState<any[]>([]);
  const [contas, setContas] = useState<any[]>([]);
  const [origem, setOrigem] = useState<'zero' | 'git' | 'novo'>(origemInicial);
  const [novoRepo, setNovoRepo] = useState<NovoRepo>({ accountId: '', namespace: '', tipoNamespace: 'usuario', nome: '', privado: true });
  const [digitar, setDigitar] = useState(false);
  const [repo, setRepo] = useState('');
  const [branch, setBranch] = useState('main');
  const [contaGit, setContaGit] = useState('');
  const [contasGit, setContasGit] = useState<any[]>([]);
  const [projetoOrigemId, setProjetoOrigemId] = useState('');
  const [projetos, setProjetos] = useState<any[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  useEffect(() => {
    api<any[]>('/areas').then(setModelos).catch(() => undefined);
    api<any[]>('/projects').then(setProjetos).catch(() => undefined);
    api<any[]>('/git/accounts').then(setContasGit).catch(() => undefined);
    api<any[]>('/accounts')
      .then((c) => {
        setContas(c);
        const conectada = c.find((x) => x.padrao && x.conectado) ?? c.find((x) => x.conectado);
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
      const p = await api('/projects', 'POST', { name: nome, description: sobre, base: modelo, provider: ia, author: nomeUsuario(), git, ...(modelo === 'design-video' && projetoOrigemId ? { projetoOrigemId } : {}) });
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
  // Agente de vídeo: a montagem usa Claude/ChatGPT; o Gemini gera Omni/Lyria e a voz padrão é Kokoro local.
  const agenteDeVideo = modelo === 'design-video' || modelo === 'video-veo';
  const contasMontagem = agenteDeVideo ? contas.filter((c) => c.tipo !== 'gemini-api') : contas;
  useEffect(() => {
    if (!agenteDeVideo) return;
    const atual = contas.find((c) => c.id === ia);
    if (!atual || atual.tipo === 'gemini-api') {
      const naoGemini = contas.filter((c) => c.tipo !== 'gemini-api');
      setIa((naoGemini.find((c) => c.conectado) ?? naoGemini[0])?.id ?? 'claude-code-cli');
    }
  }, [agenteDeVideo, contas]);
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
          <span>Agente</span>
          <div className="tipos">
            {modelos.map((m) => (
              <button type="button" key={m.id} className={modelo === m.slug ? 'tipo on' : 'tipo'} onClick={() => setModelo(m.slug)}>
                <b>{m.name}</b>
                <span>{m.description}</span>
              </button>
            ))}
          </div>
          <span className="muted small">
            Falta um agente? <Link to="/agentes" onClick={onFechar}>Crie em Agentes</Link>.
          </span>
          {modelo === 'design-video' && (
            <div className="campo origem-video">
              <span>Projeto de origem (de qual projeto é o vídeo)</span>
              <select
                value={projetoOrigemId}
                onChange={(e) => {
                  const id = e.target.value;
                  setProjetoOrigemId(id);
                  const o = projetos.find((x) => x.id === id);
                  if (o && !nome.trim()) setNome(`${o.name} — Vídeo`);
                }}
              >
                <option value="">Escolha um projeto…</option>
                {projetos.filter((x) => x.slug !== 'design-video' && x.area?.slug !== 'design-video').map((x) => (
                  <option key={x.id} value={x.id}>{x.name}{x.area?.name ? ` (${x.area.name})` : ''}</option>
                ))}
              </select>
              <span className="muted small">O projeto de vídeo fica separado e enxerga o nome, a descrição, as regras, o conhecimento e as telas da origem.</span>
            </div>
          )}
        </div>
        <div className="campo">
          <span>{agenteDeVideo ? 'Qual IA monta o vídeo (roteiro, estrutura, legenda)?' : 'Qual IA vai trabalhar neste projeto?'}</span>
          <div className="tipos">
            {contasMontagem.map((c) => (
              <button type="button" key={c.id} className={ia === c.id ? 'tipo on' : 'tipo'} onClick={() => setIa(c.id)}>
                <b>{c.nome}</b>
                <span>{c.conectado ? 'conectada' : 'não conectada'}</span>
              </button>
            ))}
          </div>
          {agenteDeVideo && (
            <span className="muted small">
              O Gemini não aparece aqui de propósito: a chave dele é usada só para <b>gerar</b> vídeo Omni e, se você escolher, música Lyria. A montagem usa Claude ou ChatGPT e a locução padrão usa Kokoro local, sem token.
            </span>
          )}
          {contasMontagem.length > 0 && !contasMontagem.find((c) => c.id === ia)?.conectado && (
            <span className="muted small">
              Esta IA ainda não está conectada. <Link to="/contas" onClick={onFechar}>Conectar em Conexões</Link>.
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
