import { useEffect, useState } from 'react';
import { api } from '../api';

interface Conexao { id: string; tipo: string; conectado: boolean; nome: string }
interface ImagemNvidia { tipo: 'imagem'; mime: string; base64: string }

/**
 * Geração de mídia NVIDIA diretamente dentro do Studio de Vídeo.
 * Reutiliza o upload durável já existente (sem criar segunda biblioteca).
 * Só mostra o controle quando há chave NVIDIA conectada.
 */
export function NvidiaImagemStudio({ onImport }: { onImport: (f: File) => Promise<void> }) {
  const [contas, setContas] = useState<Conexao[]>([]);
  const [aberto, setAberto] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [conexao, setConexao] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    api<Conexao[]>('/accounts').then(cs => {
      const nvidia = cs.filter(c => c.tipo === 'nvidia-api' && c.conectado);
      setContas(nvidia);
      setConexao(atual => nvidia.some(c => c.id === atual) ? atual : nvidia[0]?.id ?? '');
    }).catch(() => { setContas([]); });
  }, []);

  if (!contas.length) return null;

  const gerar = async () => {
    setOcupado(true);
    setErro(null);
    setNotice(null);
    try {
      if (!prompt.trim()) throw new Error('Descreva a imagem antes de gerar.');
      const r = await api<ImagemNvidia>('/accounts/' + encodeURIComponent(conexao) + '/nvidia/imagem', 'POST', {
        modelo: 'black-forest-labs/flux.1-schnell', prompt: prompt.trim(), largura: 1024, altura: 1024,
      });
      if (r.tipo !== 'imagem' || typeof r.base64 !== 'string' || r.mime !== 'image/jpeg' || r.base64.length > 8_000_000) {
        throw new Error('A NVIDIA não retornou uma imagem JPEG válida.');
      }
      const binario = atob(r.base64.replace(/\s/g, ''));
      const bytes = new Uint8Array(binario.length);
      for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);
      const nome = 'nvidia-flux-' + Date.now() + '.jpg';
      await onImport(new File([bytes], nome, { type: 'image/jpeg' }));
      setNotice('Imagem adicionada à biblioteca de mídia deste projeto.');
      setPrompt('');
    } catch (e: any) {
      setErro(String(e?.message ?? e));
    } finally {
      setOcupado(false);
    }
  };

  return (
    <div className="studio-nvidia-imagem" style={{ marginTop: 8 }}>
      <button type="button" className="secondary" onClick={() => setAberto(v => !v)}>
        {aberto ? 'Fechar NVIDIA' : 'Gerar imagem com NVIDIA'}
      </button>
      {aberto && <div className="studio-fields" style={{ padding: 10, maxWidth: 440 }}>
        <p className="muted small">
          FLUX.1 Schnell via API NVIDIA: o acesso pode exigir permissão/créditos.
          A imagem gerada é importada diretamente na biblioteca do Studio de Vídeo.
        </p>
        <label>
          Conexão NVIDIA
          <select value={conexao} onChange={e => setConexao(e.target.value)}>
            {contas.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
          </select>
        </label>
        <label>
          Descrição da imagem
          <textarea
            aria-label="Descrição para geração de imagem NVIDIA"
            rows={3} value={prompt} maxLength={2000} onChange={e => setPrompt(e.target.value)}
            placeholder="Ex.: pizza em primeiro plano com fumaça e iluminação cinematográfica"
          />
        </label>
        <button type="button" disabled={ocupado || !prompt.trim()} onClick={() => { void gerar(); }}>
          {ocupado ? 'Gerando/importando…' : 'Gerar e colocar na biblioteca'}
        </button>
        {notice && <p className="ok-msg">{notice}</p>}
        {erro && <p className="error">{erro}</p>}
      </div>}
    </div>
  );
}
