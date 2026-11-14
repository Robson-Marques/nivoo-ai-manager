import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useProjetos } from '../Layout';
import { api, nomeUsuario } from '../api';
import { EditorDeRegras, Materiais } from '../Pecas';

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
        ajuda="Documentos que a IA deve conhecer: manuais, especificações, cardápios, identidade visual… PDFs e Word também viram texto para qualquer IA ler. A IA consulta, mas nunca altera estes arquivos."
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
        <span className="muted small">Qualquer IA escolhida recebe as mesmas regras, conhecimento e memória. <Link to="/contas">Contas de IA</Link></span>
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
        <b>Excluir projeto</b>
        <span className="muted small">Apaga a conversa, a memória, as regras, o conhecimento e os arquivos deste projeto. Não dá para desfazer.</span>
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
