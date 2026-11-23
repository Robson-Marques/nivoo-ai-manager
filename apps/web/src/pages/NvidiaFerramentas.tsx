import { useEffect, useState } from 'react';
import { api } from '../api';

type Tipo = 'conversa' | 'traducao' | 'embedding' | 'rerank' | 'imagem' | 'video';
const MODOS: Array<{ id: Tipo; titulo: string; descricao: string; modelo: string }> = [
  { id: 'conversa', titulo: 'Conversa e análise', descricao: 'Chat sem ferramentas de código', modelo: 'nvidia/nemotron-3.5-bolt-e4b' },
  { id: 'traducao', titulo: 'Tradução Riva', descricao: 'Traduzir textos via Riva Translate 4B, sem ferramentas de código', modelo: 'nvidia/riva-translate-4b-instruct-v2' },
  { id: 'embedding', titulo: 'Pesquisa e RAG', descricao: 'Vetorização de texto por Nemotron Embed', modelo: 'nvidia/nemotron-3.5-embed-1b' },
  { id: 'rerank', titulo: 'Relevância de documentos', descricao: 'Reranking de até 30 trechos por Nemotron', modelo: 'nvidia/nemotron-3.5-rerank-8b' },
  { id: 'imagem', titulo: 'Imagens (acesso sujeito à conta)', descricao: 'FLUX.1 Schnell; endpoint existe, mas a NVIDIA pode exigir permissão/créditos', modelo: 'black-forest-labs/flux.1-schnell' },
  { id: 'video', titulo: 'Vídeo Cosmos3 Nano', descricao: 'Text-to-video 480p de 25 quadros; requer Public API Endpoints na sua conta', modelo: 'nvidia/cosmos3-nano' },
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

type EstadoAcesso = { modelo: string; estado: 'confirmado' | 'bloqueado'; descricao: string };
function chaveDoAcesso(conexao: string, tipo: Tipo, modelo: string): string {
  // Sem armazenar chave de API, prompt ou dados da geração no navegador.
  return 'nivoo:nvidia:acesso:' + encodeURIComponent(conexao) + ':' + tipo + ':' + encodeURIComponent(modelo);
}

/** Apenas os serviços que possuem executor. Disponibilidade REAL só após chamada bem-sucedida. */
export function NvidiaFerramentas({ conexaoId }: { conexaoId: string }) {
  const [tipo, setTipo] = useState<Tipo>('conversa');
  const [prompt, setPrompt] = useState('Explique resumidamente a função de um agente de programação.');
  const [consulta, setConsulta] = useState('Qual documento fala sobre vencimento do cartão?');
  const [trechos, setTrechos] = useState('O cartão fecha em 20 de cada mês.\nO vencimento do cartão ocorre no dia 28.\nO produto foi entregue na sexta-feira.');
  const [modelo, setModelo] = useState(MODOS[0].modelo);
  const [idiomaOrigem, setIdiomaOrigem] = useState('pt-br');
  const [idiomaDestino, setIdiomaDestino] = useState('en');
  const [ocupado, setOcupado] = useState(false);
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [acessos, setAcessos] = useState<Partial<Record<Tipo, EstadoAcesso>>>({});
  useEffect(() => {
    try {
      const cache = localStorage.getItem(chaveDoAcesso(conexaoId, tipo, modelo));
      const estado = cache ? JSON.parse(cache) as EstadoAcesso : undefined;
      setAcessos(a => ({ ...a, [tipo]: estado }));
    } catch {
      setAcessos(a => ({ ...a, [tipo]: undefined }));
    }
  }, [conexaoId, tipo, modelo]);
  const acessoAtual = acessos[tipo]?.modelo === modelo ? acessos[tipo] : undefined;
  const bloqueado = acessoAtual?.estado === 'bloqueado';
  const registrar = (estado: EstadoAcesso) => {
    try { localStorage.setItem(chaveDoAcesso(conexaoId, tipo, modelo), JSON.stringify(estado)); } catch { /* armazenamento opcional */ }
    setAcessos(a => ({ ...a, [tipo]: estado }));
  };
  const reverAcesso = () => {
    try { localStorage.removeItem(chaveDoAcesso(conexaoId, tipo, modelo)); } catch { /* opcional */ }
    setAcessos(a => ({ ...a, [tipo]: undefined }));
    setErro(null);
  };
  const mudarTipo = (t: Tipo) => {
    setTipo(t);
    setModelo(MODOS.find(m => m.id === t)!.modelo);
    setErro(null);
    setResultado(null);
    if (t === 'imagem' || t === 'video') setPrompt('Uma pizzaria premium com iluminação cinematográfica e cores quentes, sem texto');
    if (t === 'traducao') setPrompt('Nossa pizzaria usa ingredientes de qualidade e massa sem óleo.');
  };
  const executar = async () => {
    if (bloqueado || ocupado) return;
    setOcupado(true);
    setResultado(null);
    setErro(null);
    try {
      const rota = '/accounts/' + encodeURIComponent(conexaoId) + '/nvidia/' + (tipo === 'traducao' ? 'conversa' : tipo);
      const body = tipo === 'traducao' ? { modelo, prompt, idiomaOrigem, idiomaDestino } :
        tipo === 'conversa' ? { modelo, prompt } :
        tipo === 'embedding' ? { modelo, texto: prompt, inputType: 'query' } :
        tipo === 'rerank' ? { modelo, consulta, trechos: trechos.split('\n').map(t => t.trim()).filter(Boolean) } :
        tipo === 'video' ? { modelo, prompt, proporcao: '9:16', numFrames: 25 } :
        { modelo, prompt, largura: 1024, altura: 1024 };
      if (tipo === 'video') {
        const iniciado = await api<{ id: string }>(rota + '/iniciar', 'POST', body);
        let pronto: Resultado | null = null;
        for (let n = 0; n < 80; n++) {
          await new Promise(resolve => setTimeout(resolve, 2500));
          const estado = await api<{ estado: string; erro?: string; resultado?: Resultado }>(
            rota + '/' + encodeURIComponent(iniciado.id));
          if (estado.estado === 'falhou') throw new Error(estado.erro ?? 'Erro de geração na NVIDIA');
          if (estado.estado === 'concluido' && estado.resultado) { pronto = estado.resultado; break; }
        }
        if (!pronto) throw new Error('Geração ainda em andamento: pedido ' + iniciado.id + '. Não a reenvie.');
        setResultado(pronto);
      } else {
        setResultado(await api<Resultado>(rota, 'POST', body));
      }
      registrar({ modelo, estado: 'confirmado', descricao: 'Execução concluída nesta conta' });
    } catch (e: any) {
      const mensagem = String(e?.message ?? e);
      setErro(mensagem);
      // Falhas de permissão/rota NÃO devem voltar como serviço utilizável.
      // Não bloquear por 429 (cota temporária), timeout ou falha de rede.
      if (/\bHTTP (402|403|404)\b/i.test(mensagem)) {
        registrar({ modelo, estado: 'bloqueado', descricao: mensagem.slice(0, 450) });
      }
    } finally {
      setOcupado(false);
    }
  };
  const urlImagem = resultado?.tipo === 'imagem' && resultado.base64 &&
    resultado.base64.length < 8_000_000 ? 'data:' + (resultado.mime ?? 'image/jpeg') + ';base64,' + resultado.base64 : null;
  const urlVideo = resultado?.tipo === 'video' && resultado.base64 && resultado.base64.length < 60_000_000
    ? 'data:video/mp4;base64,' + resultado.base64 : null;
  return (
    <section className="conexao-painel" aria-label="Ferramentas NVIDIA integradas">
      <strong>Ferramentas NVIDIA no Nivoo AI Manager</strong>
      <p className="muted small">
        Apenas serviços com conector implementado. Estar listado na NVIDIA não significa acesso autorizado:
        o serviço só é confirmado após uma execução bem-sucedida nesta conta.
      </p>
      <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
        {MODOS.filter(m => m.id !== 'imagem' && m.id !== 'video').map(m => (
          <button key={m.id} type="button" className={m.id === tipo ? '' : 'secondary'} onClick={() => mudarTipo(m.id)}>
            {m.titulo}
          </button>
        ))}
      </div>
      <details open={tipo === 'imagem' || tipo === 'video' ? true : undefined}>
        <summary className="muted small" style={{ cursor: 'pointer', marginTop: 10 }}>
          Imagem e vídeo — podem exigir liberação especial da NVIDIA
        </summary>
        <div className="row" style={{ flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
          {MODOS.filter(m => m.id === 'imagem' || m.id === 'video').map(m => (
            <button key={m.id} type="button" className={m.id === tipo ? '' : 'secondary'} onClick={() => mudarTipo(m.id)}>
              {m.titulo}
            </button>
          ))}
        </div>
      </details>
      <p className="muted small">{MODOS.find(m => m.id === tipo)?.descricao}</p>
      <p className="muted small">
        {bloqueado ? 'Acesso negado ou endpoint não liberado para esta conta (verificação deste navegador).' :
          acessoAtual?.estado === 'confirmado' ? 'Funcionou nesta conta em uma execução anterior.' :
            'Ainda não testado nesta conta. A execução pode consumir créditos ou cota.'}
      </p>
      {bloqueado && (
        <div className="conexao-painel error">
          {acessoAtual?.descricao}
          <p>Essa função não será executada novamente automaticamente.</p>
          <button type="button" className="secondary" onClick={reverAcesso}>
            Já liberei o acesso na NVIDIA — tentar novamente
          </button>
        </div>
      )}
      <label>
        ID do modelo
        <input
          value={modelo}
          onChange={e => setModelo(e.target.value)}
          spellCheck={false}
          aria-label="Modelo NVIDIA do serviço"
        />
      </label>
      {tipo === 'traducao' && <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <label>De
          <select value={idiomaOrigem} onChange={e => setIdiomaOrigem(e.target.value)}>
            <option value="pt-br">Português (Brasil)</option><option value="en">Inglês</option>
            <option value="es-es">Espanhol</option><option value="fr">Francês</option>
            <option value="de">Alemão</option><option value="it">Italiano</option>
            <option value="ja">Japonês</option><option value="zh-cn">Chinês simplificado</option>
          </select>
        </label>
        <label>Para
          <select value={idiomaDestino} onChange={e => setIdiomaDestino(e.target.value)}>
            <option value="en">Inglês</option><option value="pt-br">Português (Brasil)</option>
            <option value="es-es">Espanhol</option><option value="fr">Francês</option>
            <option value="de">Alemão</option><option value="it">Italiano</option>
            <option value="ja">Japonês</option><option value="zh-cn">Chinês simplificado</option>
          </select>
        </label>
      </div>}
      {tipo !== 'rerank' ? (
        <label>
          {tipo === 'embedding' ? 'Texto para vetorização' : tipo === 'imagem' ? 'Descrição da imagem' : tipo === 'video' ? 'Descrição do vídeo' : tipo === 'traducao' ? 'Texto e direção da tradução' : 'Mensagem para a IA'}
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
        <button type="button" disabled={ocupado || bloqueado} onClick={() => { void executar(); }}>
          {ocupado ? 'Consultando NVIDIA…' : bloqueado ? 'Acesso não habilitado' : 'Executar com minha chave NVIDIA'}
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
          {urlVideo && (
            <div>
              <video controls src={urlVideo} style={{ maxWidth: '100%', maxHeight: 450 }} />
              <a className="botao-link" href={urlVideo} download="nvidia-cosmos.mp4">Salvar MP4</a>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
