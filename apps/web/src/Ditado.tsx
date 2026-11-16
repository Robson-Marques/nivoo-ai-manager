import { useEffect, useRef, useState } from 'react';
import { IconeMicrofone } from './Icones';

/** O reconhecimento de fala do próprio navegador (Chrome, Edge, Safari; o Firefox não tem). */
const Reconhecedor = (): any => (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition;

/**
 * Ditado: a fala vira texto na caixa de mensagem, em português, pelo próprio navegador — não gasta a IA do projeto.
 * Clique para falar e de novo para parar; o texto aparece enquanto você fala e dá para corrigir antes de enviar.
 * O navegador encerra o reconhecimento sozinho depois de uma pausa: enquanto o botão estiver ligado, ele recomeça.
 */
export function BotaoDitado({ texto, onTexto, desativado }: { texto: string; onTexto: (t: string) => void; desativado?: boolean }) {
  const [ouvindo, setOuvindo] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const rec = useRef<any>(null);
  const querOuvir = useRef(false);
  const textoAtual = useRef(texto);
  textoAtual.current = texto;

  const parar = () => {
    querOuvir.current = false;
    rec.current?.stop?.();
  };
  useEffect(() => () => {
    querOuvir.current = false;
    rec.current?.abort?.();
  }, []);
  // Mensagem enviada (a caixa fica ocupada enquanto a IA responde): o ditado para.
  useEffect(() => {
    if (desativado && querOuvir.current) parar();
  }, [desativado]);

  const ouvir = () => {
    const C = Reconhecedor();
    const r = new C();
    r.lang = 'pt-BR';
    r.continuous = !/Android/i.test(navigator.userAgent); // no Android o modo contínuo repete palavras
    r.interimResults = true;
    const base = textoAtual.current && !/\s$/.test(textoAtual.current) ? `${textoAtual.current} ` : textoAtual.current;
    r.onresult = (e: any) => {
      let falado = '';
      for (let i = 0; i < e.results.length; i++) falado += e.results[i][0].transcript;
      onTexto(`${base}${falado.trim()}`);
    };
    r.onerror = (e: any) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        querOuvir.current = false;
        setAviso('Libere o microfone para este site (no cadeado da barra de endereço) e clique de novo.');
      } else if (e.error === 'network') {
        querOuvir.current = false;
        setAviso('O ditado precisa de internet (quem transcreve é o serviço do navegador).');
      } else if (e.error === 'audio-capture') {
        querOuvir.current = false;
        setAviso('Nenhum microfone encontrado neste aparelho.');
      }
      // "no-speech" (silêncio) e "aborted" (parado por você) não são erro.
    };
    r.onend = () => {
      rec.current = null;
      if (querOuvir.current) {
        try {
          ouvir(); // pausa na fala: continua ouvindo até você parar
          return;
        } catch {
          querOuvir.current = false;
        }
      }
      setOuvindo(false);
    };
    rec.current = r;
    r.start();
  };

  const alternar = () => {
    if (ouvindo) return parar();
    if (!Reconhecedor()) {
      setAviso('Este navegador não faz ditado (o Firefox não tem). Use o Chrome, o Edge ou o Safari — ou o microfone do teclado do celular.');
      return;
    }
    setAviso(null);
    querOuvir.current = true;
    try {
      ouvir();
      setOuvindo(true);
    } catch (e: any) {
      querOuvir.current = false;
      setAviso(`Não consegui ligar o microfone: ${e?.message ?? e}`);
    }
  };

  return (
    <>
      <button
        type="button"
        className={ouvindo ? 'microfone ouvindo' : 'microfone'}
        title={ouvindo ? 'Parar o ditado' : 'Falar em vez de digitar (o navegador transcreve; não gasta a IA)'}
        aria-label={ouvindo ? 'Parar o ditado' : 'Falar a mensagem'}
        aria-pressed={ouvindo}
        disabled={desativado && !ouvindo}
        onClick={alternar}
      >
        <IconeMicrofone />
      </button>
      {(ouvindo || aviso) && (
        <div className={aviso ? 'ditado-aviso erro' : 'ditado-aviso'} role="status">
          {aviso ?? 'Ouvindo… fale normalmente; clique no microfone para parar.'}
        </div>
      )}
    </>
  );
}
