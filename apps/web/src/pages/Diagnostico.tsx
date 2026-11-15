import { useState } from 'react';
import { copiarTexto, lerArquivo } from '../api';

/** Baixa um texto como arquivo .md (para anexar no suporte). */
export function baixarTexto(nome: string, texto: string): void {
  const u = URL.createObjectURL(new Blob([texto], { type: 'text/markdown;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = u;
  a.download = nome;
  a.click();
  setTimeout(() => URL.revokeObjectURL(u), 10_000);
}

/** Botões "Copiar diagnóstico" / "Baixar" para um relatório servido pela API (Markdown, sem segredos). */
export function BotaoDiagnostico({ url, nomeArquivo, rotulo = 'Copiar diagnóstico completo' }: { url: string; nomeArquivo: string; rotulo?: string }) {
  const [estado, setEstado] = useState<'' | 'gerando' | 'copiado' | 'erro'>('');
  const obter = async () => lerArquivo(url);
  return (
    <span className="row small" style={{ gap: 8 }}>
      <button
        type="button"
        className="secondary"
        disabled={estado === 'gerando'}
        onClick={async () => {
          setEstado('gerando');
          try {
            await copiarTexto(await obter());
            setEstado('copiado');
            setTimeout(() => setEstado(''), 2500);
          } catch {
            setEstado('erro');
          }
        }}
      >
        {estado === 'gerando' ? 'Gerando…' : estado === 'copiado' ? 'Copiado — cole no suporte' : rotulo}
      </button>
      <button type="button" className="link small" onClick={async () => baixarTexto(nomeArquivo, await obter())}>baixar .md</button>
      {estado === 'erro' && <span className="error small">não consegui gerar</span>}
    </span>
  );
}

/** Página Diagnóstico: estado do sistema e últimos erros, num texto só para mandar ao suporte. */
export function Diagnostico() {
  const [texto, setTexto] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);
  const gerar = async () => {
    setCarregando(true);
    try {
      setTexto(await lerArquivo('/system/diagnostico'));
    } finally {
      setCarregando(false);
    }
  };
  return (
    <div className="pagina">
      <div className="conexoes">
        <h1>Diagnóstico</h1>
        <p className="muted">
          Quando algo der errado, mande este relatório para o suporte: versão instalada, worker, fila, IAs conectadas, trabalhos parados e os últimos erros do
          sistema. Tokens, chaves e senhas saem apagados. Para um trabalho específico, use “Copiar diagnóstico completo” no próprio trabalho parado.
        </p>
        <div className="row">
          <button onClick={gerar} disabled={carregando}>{carregando ? 'Gerando…' : texto ? 'Gerar de novo' : 'Gerar diagnóstico do sistema'}</button>
          {texto && <BotaoDiagnostico url="/system/diagnostico" nomeArquivo={`nivoo-diagnostico-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.md`} rotulo="Copiar" />}
        </div>
        {texto && <pre className="texto-arquivo diagnostico">{texto}</pre>}
      </div>
    </div>
  );
}
