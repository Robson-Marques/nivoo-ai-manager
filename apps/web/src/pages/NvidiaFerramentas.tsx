import { useState } from 'react';
import { api } from '../api';

type Tipo = 'conversa' | 'embedding' | 'rerank' | 'imagem';
const MODOS: Array<{ id: Tipo; titulo: string; descricao: string; modelo: string }> = [
  { id: 'conversa', titulo: 'Conversa e análise', descricao: 'Chat sem ferramentas de código', modelo: 'nvidia/nemotron-3.5-bolt-e4b' },
  { id: 'embedding', titulo: 'Pesquisa e RAG', descricao: 'Vetorização de texto por Nemotron Embed', modelo: 'nvidia/nemotron-3.5-embed-1b' },
  { id: 'rerank', titulo: 'Relevância de documentos', descricao: 'Reranking de até 30 trechos por Nemotron', modelo: 'nvidia/nemotron-3.5-rerank-8b' },
  { id: 'imagem', titulo: 'Imagens (acesso sujeito à conta)', descricao: 'FLUX.1 Schnell; endpoint existe, mas a NVIDIA pode exigir permissão/créditos', modelo: 'black-forest-labs/flux.1-schnell' },
];
interface Resultado {
  tipo: Tipo;
  texto?: string;
  dimensoes?: number;
  vetor?: number[];
  resultados?: Array<{ indice: number; texto: string; pontuacao: number }>;
  base64?: string;
  mime?: string;
  [key: string]: unknown;
}

/** Painel prático para exercitar as APIs disponíveis usando a conexão NVIDIA salva. */
export function NvidiaFerramentas({ conexaoId }: { conexaoId: string }) {
  const [tipo, setTipo] = useState<Tipo>('conversa');
  const [prompt, setPrompt] = useState('Explique resumidamente a função de um agente de programação.');
  const [consulta, setConsulta] = useState('Qual documento fala sobre vencimento do cartão?');
  const [trechos, setTrechos] = useState('O cartão fecha em 20 de cada mês.\nO vencimento do cartão ocorre no dia 28.\nO produto foi entregue na sexta-feira.');
  const [modelo, setModelo] = useState(MODOS[0].modelo);
  const [ocupado, setOcupado] = useState(false);
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const mudarTipo = (t: Tipo) => {
    setTipo(t);
    setModelo(MODOS.find(m => m.id === t)!.modelo);
    setErro(null);
    setResultado(null);
    if (t === 'imagem') setPrompt('Uma pizzaria premium com iluminação cinematográfica e cores quentes, sem texto');
  };
  const executar = async () => {
    setOcupado(true);
    setResultado(null);
    setErro(null);
    try {
      const rota = '/accounts/' + encodeURIComponent(conexaoId) + '/nvidia/' + tipo;
      const body = tipo === 'conversa' ? { modelo, prompt } :
        tipo === 'embedding' ? { modelo, texto: prompt, inputType: 'query' } :
        tipo === 'rerank' ? { modelo, consulta, trechos: trechos.split('\n').map(t => t.trim()).filter(Boolean) } :
        { modelo, prompt, largura: 1024, altura: 1024 };
      setResultado(await api<Resultado>(rota, 'POST', body));
    } catch (e: any) {
      setErro(String(e?.message ?? e));
    } finally {
      setOcupado(false);
    }
  };
  const urlImagem = resultado?.tipo === 'imagem' && resultado.base64 &&
    resultado.base64.length < 8_000_000 ? 'data:' + (resultado.mime ?? 'image/jpeg') + ';base64,' + resultado.base64 : null;
  return (
    <section className="conexao-painel" aria-label="Ferramentas NVIDIA integradas">
      <strong>Serviços NVIDIA executáveis por API</strong>
      <p className="muted small">
        O Nivoo AI Manager envia a tarefa usando a sua chave NVIDIA, diretamente ao endpoint da especialidade.
        Alguns serviços podem exigir autorização ou créditos, mesmo quando a página mostra uma opção de avaliação.
        Os modelos apenas para download não são executados aqui.
      </p>
      <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
        {MODOS.map(m => (
          <button key={m.id} type="button" className={m.id === tipo ? '' : 'secondary'} onClick={() => mudarTipo(m.id)}>
            {m.titulo}
          </button>
        ))}
      </div>
      <p className="muted small">{MODOS.find(m => m.id === tipo)?.descricao}</p>
      <label>
        ID do modelo
        <input
          value={modelo}
          onChange={e => setModelo(e.target.value)}
          spellCheck={false}
          aria-label="Modelo NVIDIA do serviço"
        />
      </label>
      {tipo !== 'rerank' ? (
        <label>
          {tipo === 'embedding' ? 'Texto para vetorização' : tipo === 'imagem' ? 'Descrição da imagem' : 'Mensagem para a IA'}
          <textarea value={prompt} rows={3} onChange={e => setPrompt(e.target.value)} maxLength={15000} />
        </label>
      ) : (
        <>
          <label>
            Pergunta para pesquisa
            <textarea value={consulta} rows={2} onChange={e => setConsulta(e.target.value)} maxLength={5000}/>
          </label>
          <label>
            Documentos ou trechos (um por linha)
            <textarea value={trechos} rows={5} onChange={e => setTrechos(e.target.value)} maxLength={15000}/>
          </label>
        </>
      )}
      <div className="row">
        <button type="button" disabled={ocupado} onClick={() => { void executar(); }}>
          {ocupado ? 'Consultando NVIDIA…' : 'Executar com minha chave NVIDIA'}
        </button>
      </div>
      {erro && <p className="error">{erro}</p>}
      {resultado && (
        <div style={{ marginTop: 10 }}>
          {resultado.texto && <pre className="texto-arquivo">{resultado.texto}</pre>}
          {resultado.tipo === 'embedding' && <div className="small">
            Vetor produzido com {resultado.dimensoes} dimensões.
            <pre className="texto-arquivo">Prévia: {JSON.stringify(resultado.vetor?.slice(0, 8))}</pre>
          </div>}
          {resultado.resultados && (
            <ol>
              {resultado.resultados.map((r, i) =>
                <li key={i}><b>{Number(r.pontuacao).toFixed(3)}</b> — {r.texto}</li>)}
            </ol>
          )}
          {urlImagem && (
            <div>
              <img src={urlImagem} alt="Imagem gerada pela NVIDIA" style={{ maxWidth: '100%', maxHeight: 450, objectFit: 'contain' }}/>
              <a className="botao-link" href={urlImagem} download="nvidia-flux.jpg">Salvar imagem JPEG</a>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
