import { useEffect, useState } from 'react';
import { api } from '../api';

interface Conexao { id: string; tipo: string; conectado: boolean; nome: string }
interface MidiaNvidia { tipo: 'imagem' | 'video'; mime: string; base64: string }

/**
 * Geração de mídia NVIDIA diretamente dentro do Studio de Vídeo.
 * Reutiliza o upload durável já existente (sem criar segunda biblioteca).
 * Só mostra o controle quando há chave NVIDIA conectada.
 */
export function NvidiaImagemStudio({ onImport }: { onImport: (f: File) => Promise<void> }) {
  const [contas, setContas] = useState<Conexao[]>([]);
  const [aberto, setAberto] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [modalidade, setModalidade] = useState<'imagem' | 'video'>('imagem');
  const [proporcao, setProporcao] = useState<'9:16' | '16:9'>('9:16');
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
      if (!prompt.trim()) throw new Error('Descreva a mídia antes de gerar.');
      const isVideo = modalidade === 'video';
      const body = isVideo
        ? { modelo: 'nvidia/cosmos3-nano', prompt: prompt.trim(), proporcao, numFrames: 25 }
        : { modelo: 'black-forest-labs/flux.1-schnell', prompt: prompt.trim(), largura: 1024, altura: 1024 };
      let r: MidiaNvidia;
      if (isVideo) {
        const iniciar = await api<{ id: string; estado: string }>(
          '/accounts/' + encodeURIComponent(conexao) + '/nvidia/video/iniciar', 'POST', body);
        setNotice('Geração Cosmos3 iniciada uma única vez. Consultando o pedido ' + iniciar.id + '…');
        let pronto: MidiaNvidia | null = null;
        for (let i = 0; i < 80; i++) {
          await new Promise(resolve => setTimeout(resolve, 2500));
          const estado = await api<{ estado: string; resultado?: MidiaNvidia; erro?: string }>(
            '/accounts/' + encodeURIComponent(conexao) + '/nvidia/video/' + encodeURIComponent(iniciar.id));
          if (estado.estado === 'falhou') throw new Error(estado.erro ?? 'A NVIDIA não concluiu o vídeo');
          if (estado.estado === 'concluido' && estado.resultado) { pronto = estado.resultado; break; }
        }
        if (!pronto) throw new Error('Geração ainda em andamento. Pedido ' + iniciar.id +
          '. Não reinicie a geração: consulte o estado na NVIDIA.');
        r = pronto;
      } else {
        r = await api<MidiaNvidia>('/accounts/' + encodeURIComponent(conexao) + '/nvidia/imagem', 'POST', body);
      }
      const mime = isVideo ? 'video/mp4' : 'image/jpeg';
      const limite = isVideo ? 60_000_000 : 8_000_000;
      if (r.tipo !== modalidade || typeof r.base64 !== 'string' || r.mime !== mime || r.base64.length > limite) {
        throw new Error('A NVIDIA não retornou a mídia no formato esperado.');
      }
      const binario = atob(r.base64.replace(/\s/g, ''));
      const bytes = new Uint8Array(binario.length);
      for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);
      const nome = (isVideo ? 'nvidia-cosmos-' : 'nvidia-flux-') + Date.now() + (isVideo ? '.mp4' : '.jpg');
      await onImport(new File([bytes], nome, { type: mime }));
      setNotice((isVideo ? 'Vídeo' : 'Imagem') + ' adicionado à biblioteca de mídia deste projeto.');
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
        {aberto ? 'Fechar NVIDIA' : 'Gerar imagem/vídeo NVIDIA'}
      </button>
      {aberto && <div className="studio-fields" style={{ padding: 10, maxWidth: 440 }}>
        <p className="muted small">
          FLUX.1 Schnell gera imagens; Cosmos3 Nano gera clipes curtos. O acesso depende da sua conta NVIDIA.
          A mídia aprovada é importada diretamente à biblioteca do projeto.
        </p>
        <label>
          Conexão NVIDIA
          <select value={conexao} onChange={e => setConexao(e.target.value)}>
            {contas.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
          </select>
        </label>
        <label>
          Tipo de geração
          <select value={modalidade} onChange={e => setModalidade(e.target.value as 'imagem' | 'video')}>
            <option value="imagem">Imagem — FLUX.1 Schnell</option>
            <option value="video">Vídeo — Cosmos3 Nano (prévia de 1 segundo)</option>
          </select>
        </label>
        {modalidade === 'video' && <label>Formato
          <select value={proporcao} onChange={e => setProporcao(e.target.value as '9:16' | '16:9')}>
            <option value="9:16">Vertical 9:16</option>
            <option value="16:9">Horizontal 16:9</option>
          </select>
        </label>}
        <label>
          Descrição da mídia
          <textarea
            aria-label="Descrição para geração de mídia NVIDIA"
            rows={3} value={prompt} maxLength={2000} onChange={e => setPrompt(e.target.value)}
            placeholder="Ex.: pizza em primeiro plano com fumaça e iluminação cinematográfica"
          />
        </label>
        <button type="button" disabled={ocupado || !prompt.trim()} onClick={() => { void gerar(); }}>
          {ocupado ? 'Gerando/importando…' : 'Gerar e colocar na biblioteca'}
        </button>
        {modalidade === 'video' && <p className="muted small">A geração pode demorar. Se ocorrer timeout, NÃO repita sem verificar o histórico da NVIDIA. Algumas contas recebem HTTP 404 por falta de permissão Public API Endpoints.</p>}
        {notice && <p className="ok-msg">{notice}</p>}
        {erro && <p className="error">{erro}</p>}
      </div>}
    </div>
  );
}
