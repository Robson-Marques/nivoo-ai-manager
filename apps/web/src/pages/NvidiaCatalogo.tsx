import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';

interface Area { id: string; nome: string; descricao: string }
interface ModeloNvidia {
  id: string | null;
  nome: string;
  areas: string[];
  uso: string;
  endpoint: string;
  oferta: 'free-endpoint' | 'download' | 'ambos' | 'nao-verificada';
  ferramentas: boolean;
  utilizavelNoWorkflow: boolean;
  listadoNaChave: boolean;
  fonte: 'nvidia-build' | 'api-models';
}
interface Catalogo {
  modelos: ModeloNvidia[];
  areas: Area[];
  verificadoNaConta: boolean;
  aviso: string | null;
  origem: string;
  observacao: string;
}

function nomeDaOferta(o: ModeloNvidia['oferta']): string {
  switch (o) {
    case 'free-endpoint': return 'API grátis para avaliação';
    case 'ambos': return 'API grátis + download';
    case 'download': return 'Somente download';
    default: return 'Oferta não verificada';
  }
}

function destinoNoNivoo(modelo: ModeloNvidia): string {
  if (modelo.utilizavelNoWorkflow && modelo.id) return 'Studio Workflow: modelo de agente';
  if (modelo.areas.includes('video')) return 'Studio de Vídeo: conector especializado pendente';
  if (modelo.areas.includes('imagens')) return 'Design de Imagens: conector especializado pendente';
  if (modelo.areas.includes('audio')) return 'Áudio e Transcrição: conector especializado pendente';
  if (modelo.areas.includes('busca')) return 'Busca/RAG: conector especializado pendente';
  if (modelo.areas.includes('dados')) return 'Dados: conector especializado pendente';
  return 'Modelo especializado: não habilitado como agente';
}

/** Exploração por especialidade; nunca oferece modelos de vídeo no seletor de código. */
export function NvidiaCatalogo({ conexaoId }: { conexaoId: string }) {
  const [catalogo, setCatalogo] = useState<Catalogo | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [busca, setBusca] = useState('');
  const [area, setArea] = useState('todas');
  const [oferta, setOferta] = useState('todas');
  const [atualizando, setAtualizando] = useState(false);

  const carregar = async () => {
    setAtualizando(true);
    setErro(null);
    try {
      setCatalogo(await api<Catalogo>('/accounts/' + encodeURIComponent(conexaoId) + '/catalogo'));
    } catch (e: any) {
      setErro(String(e.message ?? e));
    } finally {
      setAtualizando(false);
    }
  };
  useEffect(() => { void carregar(); }, [conexaoId]);

  const modelos = useMemo(() => {
    const q = busca.toLocaleLowerCase('pt-BR').trim();
    return (catalogo?.modelos ?? [])
      .filter(m => area === 'todas' || m.areas.includes(area))
      .filter(m => oferta === 'todas' ||
        (oferta === 'gratis' && (m.oferta === 'free-endpoint' || m.oferta === 'ambos')) ||
        (oferta === 'download' && (m.oferta === 'download' || m.oferta === 'ambos')) ||
        (oferta === 'agentes' && m.utilizavelNoWorkflow) ||
        (oferta === 'api' && m.listadoNaChave))
      .filter(m => !q || [m.nome, m.id ?? '', m.uso, m.endpoint].join(' ').toLocaleLowerCase('pt-BR').includes(q))
      .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  }, [catalogo, area, oferta, busca]);

  const grupos = (catalogo?.areas ?? [])
    .map(g => ({ ...g, modelos: modelos.filter(m => area !== 'todas' || m.areas[0] === g.id) }))
    .filter(g => g.modelos.length > 0 && (area === 'todas' || area === g.id));

  return (
    <section className="conexao-painel" aria-label="Catálogo NVIDIA por tipo de trabalho">
      <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <strong>Catálogo NVIDIA por especialidade</strong>
        <button type="button" className="secondary" onClick={() => { void carregar(); }} disabled={atualizando}>
          {atualizando ? 'Atualizando…' : 'Atualizar catálogo'}
        </button>
      </div>
      <p className="muted small">
        Os modelos podem ter várias funções. Uma entrada com Free Endpoint pode ser testada segundo as cotas NVIDIA;
        Download não significa que exista uma API hospedada. A referência local é parcial; ao cadastrar sua chave,
        os demais IDs retornados pela API também aparecem, sem serem presumidos modelos de código.
      </p>
      <p className="muted small">
        <a href="https://build.nvidia.com/models?pageSize=96" target="_blank" rel="noopener noreferrer">
          Ver catálogo público completo da NVIDIA
        </a>
        {' · '}
        <a href="https://docs.api.nvidia.com/nim/reference/models-1" target="_blank" rel="noopener noreferrer">
          Documentação de endpoints
        </a>
      </p>
      {catalogo?.aviso && <p className="muted small">{catalogo.aviso}</p>}
      {catalogo && <p className="muted small">
        {catalogo.modelos.length} modelos catalogados nesta visualização; {catalogo.modelos.filter(m => m.listadoNaChave).length} IDs retornados pela API desta conexão.
        A lista por API não comprova crédito ou suporte real a cada endpoint.
      </p>}
      {erro && <div className="error">{erro}</div>}
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <input
          type="search" aria-label="Buscar modelos NVIDIA" placeholder="Buscar modelo ou função…"
          value={busca} onChange={e => setBusca(e.target.value)} style={{ minWidth: 180, flex: 1 }}
        />
        <select aria-label="Área de uso" value={area} onChange={e => setArea(e.target.value)}>
          <option value="todas">Todas as áreas</option>
          {catalogo?.areas.map(a => <option value={a.id} key={a.id}>{a.nome}</option>)}
        </select>
        <select aria-label="Tipo de acesso" value={oferta} onChange={e => setOferta(e.target.value)}>
          <option value="todas">Todos os acessos</option>
          <option value="gratis">Free Endpoint</option>
          <option value="download">Download disponível</option>
          <option value="agentes">Compatível com agentes</option>
          <option value="api">Listados pela minha chave</option>
        </select>
      </div>
      {!catalogo && !erro && <p className="muted">Lendo os modelos…</p>}
      {!!catalogo && grupos.length === 0 && <p className="muted">Nenhum modelo corresponde aos filtros.</p>}
      {grupos.map(grupo => (
        <section key={grupo.id} style={{ marginTop: 14 }}>
          <h4 style={{ marginBottom: 4 }}>{grupo.nome} ({grupo.modelos.length})</h4>
          <p className="muted small" style={{ marginTop: 0 }}>{grupo.descricao}</p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 8 }}>
            {grupo.modelos.map((m, i) => (
              <article
                key={m.id ?? (m.nome + '-' + i)}
                style={{ border: '1px solid var(--borda, #5e6673)', borderRadius: 8, padding: 12, minWidth: 0 }}
              >
                <strong>{m.nome}</strong>
                {m.id && <div className="muted small" style={{ overflowWrap: 'anywhere' }}>{m.id}</div>}
                <p className="small" style={{ margin: '7px 0' }}>{m.uso}</p>
                <div className="muted small">{m.areas.map(a => catalogo?.areas.find(x => x.id === a)?.nome ?? a).join(' · ')}</div>
                <div className="small" style={{ marginTop: 8 }}><b>{nomeDaOferta(m.oferta)}</b></div>
                <div className="small">{destinoNoNivoo(m)}</div>
                <div className="muted small">
                  {m.listadoNaChave ? 'ID identificado na sua API; uso/cota ainda não testados' :
                    'ID não confirmado na API desta chave'}
                </div>
              </article>
            ))}
          </div>
        </section>
      ))}
      <p className="muted small" style={{ marginTop: 12 }}>
        Para escolher a IA que altera código, abra o projeto e use o seletor de modelo.
        Modelos de vídeo, áudio, imagem, embedding e rerank não executam a ferramenta de edição de arquivos.
      </p>
    </section>
  );
}
