import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useProjetos } from '../Layout';
import { api, nomeUsuario } from '../api';
import { EditorDeRegras, Materiais, SeletorModelo } from '../Pecas';

const ESTADO: Record<string, string> = { PENDENTE: 'na fila', EXECUTANDO: 'trabalhando', AGUARDANDO_RECURSO: 'esperando a IA', AGUARDANDO_APROVACAO: 'esperando sua confirmação' };

/** "Fine-tune" do projeto em linguagem simples: regras próprias, conhecimento, IA e limite de gasto. */
export function Ajustes({ projeto, onMudou }: { projeto: any; onMudou: () => void }) {
  const [contas, setContas] = useState<any[]>([]);
  const [limite, setLimite] = useState(projeto.maxCostUsd === null ? '' : String(Number(projeto.maxCostUsd)));
  const [msg, setMsg] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const nav = useNavigate();
  const { recarregar } = useProjetos();
  useEffect(() => {
    api<any[]>('/accounts').then(setContas).catch(() => undefined);
  }, []);
  const [trabalhos, setTrabalhos] = useState<any[]>([]);
  const carregarTrabalhos = useCallback(async () => {
    const lista = await api<any[]>(`/projects/${projeto.id}/jobs`);
    setTrabalhos(lista.filter((j) => ['PENDENTE', 'EXECUTANDO', 'AGUARDANDO_RECURSO', 'AGUARDANDO_APROVACAO'].includes(j.status)));
  }, [projeto.id]);
  useEffect(() => {
    carregarTrabalhos().catch(() => undefined);
    const t = setInterval(() => carregarTrabalhos().catch(() => undefined), 5000);
    return () => clearInterval(t);
  }, [carregarTrabalhos]);
  const listar = useCallback(async () => (await api(`/projects/${projeto.id}`)).knowledgeFiles, [projeto.id]);
  const salvar = async (dados: Record<string, unknown>, ok: string) => {
    setErro(null);
    try {
      await api(`/projects/${projeto.id}`, 'PATCH', dados);
      setMsg(ok);
      onMudou();
    } catch (e: any) {
      setErro(e.message);
    }
  };
  return (
    <div className="lista ajustes">
      <EditorDeRegras
        titulo="Regras deste projeto"
        ajuda={`Escreva como a IA deve se comportar NESTE projeto: escopo, o que pode e o que não pode, padrões, tom. Vale junto com as regras do modelo "${projeto.area?.name}". Em todo trabalho, uma IA separada confere se as regras foram seguidas.`}
        placeholder={'Ex.: Este é o sistema da Pizzaria do Zé.\nSó trate de pedidos, cardápio e entregas.\nNunca altere preços sem eu pedir.'}
        inicial={projeto.rules?.text ?? ''}
        versao={projeto.rules?.version}
        onSalvar={(texto) => api(`/projects/${projeto.id}/rules`, 'POST', { text: texto, author: nomeUsuario() }).then(onMudou)}
      />
      <Materiais
        titulo="Conhecimento do projeto"
        ajuda="Documentos que a IA deve conhecer: manuais, especificações, cardápios, identidade visual… PDF, Word, Excel, PowerPoint e LibreOffice são guardados como texto (o original não fica), para qualquer IA ler. A IA consulta, mas nunca altera estes arquivos."
        listar={listar}
        rotaEnvio={`/projects/${projeto.id}/knowledge/import`}
        rotaArquivo={(p) => `/projects/${projeto.id}/knowledge/file?path=${encodeURIComponent(p)}`}
        rotaRemover={(p) => `/projects/${projeto.id}/knowledge/file?path=${encodeURIComponent(p)}&by=${encodeURIComponent(nomeUsuario())}`}
      />
      <div className="campo">
        <b>IA que trabalha neste projeto</b>
        <div className="tipos">
          {contas.map((c) => (
            <button key={c.id} className={projeto.provider === c.id ? 'tipo on' : 'tipo'} onClick={() => salvar({ provider: c.id }, `Agora quem trabalha neste projeto é: ${c.nome}.`)}>
              <b>{c.nome}</b>
              <span>{c.conectado ? 'conectada' : 'não conectada'}</span>
            </button>
          ))}
        </div>
        <div className="row">
          <SeletorModelo projeto={projeto} onMudou={onMudou} />
        </div>
        <span className="muted small">Qualquer IA escolhida recebe as mesmas regras, conhecimento e memória. O modelo fica guardado para cada IA. <Link to="/contas">Conexões</Link></span>
      </div>
      <div className="campo">
        <b>Limite de gasto do projeto (US$)</b>
        <span className="muted small">Já gasto: US$ {Number(projeto.custoGastoUsd ?? 0).toFixed(2)}. Deixe vazio para não limitar.</span>
        <div className="row">
          <input type="number" min="0" step="1" value={limite} onChange={(e) => setLimite(e.target.value)} style={{ maxWidth: 140 }} />
          <button className="secondary" onClick={() => salvar({ maxCostUsd: limite === '' ? null : Number(limite) }, 'Limite salvo.')}>Salvar limite</button>
        </div>
      </div>
      <div className="campo">
        <b>Trabalhos em andamento</b>
        {trabalhos.length === 0 && <span className="muted small">Nenhum.</span>}
        {trabalhos.map((j) => (
          <div key={j.id} className="row" style={{ justifyContent: 'space-between' }}>
            <span className="small">{j.title} — {ESTADO[j.status] ?? j.status}</span>
            <button
              className="danger"
              onClick={async () => {
                setErro(null);
                try {
                  await api(`/projects/${projeto.id}/jobs/${j.id}/interrupt`, 'POST', { by: nomeUsuario() });
                  await carregarTrabalhos();
                  setMsg(`Trabalho "${j.title}" parado. Dá para continuar depois com "Tentar de novo" no chat.`);
                } catch (e: any) {
                  setErro(e.message);
                }
              }}
            >
              Parar
            </button>
          </div>
        ))}
      </div>
      <div className="campo">
        <b>{projeto.archivedAt ? 'Projeto arquivado' : 'Arquivar projeto'}</b>
        <span className="muted small">
          {projeto.archivedAt
            ? 'Este projeto está fora da lista principal. Desarquive para ele voltar.'
            : 'Tira o projeto da lista principal sem apagar nada. Ele fica em "projetos arquivados".'}
        </span>
        <div className="row">
          <button className="secondary" onClick={() => salvar({ archived: !projeto.archivedAt }, projeto.archivedAt ? 'Projeto desarquivado.' : 'Projeto arquivado.')}>
            {projeto.archivedAt ? 'Desarquivar projeto' : 'Arquivar projeto'}
          </button>
        </div>
      </div>
      <div className="campo">
        <b>Excluir projeto</b>
        <span className="muted small">Para o que estiver rodando e apaga as conversas, a memória, as regras, o conhecimento e os arquivos deste projeto. Não dá para desfazer.</span>
        <div className="row">
          <button
            className="danger"
            onClick={async () => {
              if (window.prompt(`Para excluir, digite o nome do projeto: ${projeto.name}`) !== projeto.name) return;
              setErro(null);
              try {
                await api(`/projects/${projeto.id}`, 'DELETE');
                await recarregar();
                nav('/');
              } catch (e: any) {
                setErro(e.message);
              }
            }}
          >
            Excluir este projeto
          </button>
        </div>
      </div>
      {msg && <div className="ok-msg">{msg}</div>}
      {erro && <div className="error">{erro}</div>}
    </div>
  );
}
