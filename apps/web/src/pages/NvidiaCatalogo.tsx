import { NvidiaFerramentas } from './NvidiaFerramentas';

/**
 * Conexões NVIDIA é uma área OPERACIONAL, não uma vitrine do NVIDIA Build.
 * O catálogo público mistura serviços API, downloads locais e modelos não
 * disponíveis para a conta. Exibí-lo como "integrado" confundia o usuário.
 * O seletor de agentes continua no projeto; serviços de API ficam aqui.
 */
export function NvidiaCatalogo({ conexaoId }: { conexaoId: string }) {
  return (
    <section className="conexao-painel" aria-label="Serviços NVIDIA para usar no Nivoo AI Manager">
      <NvidiaFerramentas conexaoId={conexaoId} />
      <p className="muted small" style={{ marginTop: 12 }}>
        Para configurar um modelo de programação, abra o projeto no Studio Workflow e escolha a IA NVIDIA.
        A presença de um ID na API ou a indicação de Free Endpoint não comprova acesso ou cota.
      </p>
      <details>
        <summary className="muted small" style={{ cursor: 'pointer' }}>Pesquisar outros modelos NVIDIA (fora do Nivoo)</summary>
        <p className="muted small">
          O catálogo público contém modelos que exigem GPU, download ou conectores que ainda não existem no
          Nivoo AI Manager. Eles não são mostrados aqui como funcionalidades disponíveis.
        </p>
        <a href="https://build.nvidia.com/models?pageSize=96" target="_blank" rel="noopener noreferrer">
          Abrir o catálogo oficial da NVIDIA
        </a>
      </details>
    </section>
  );
}
