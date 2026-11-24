/**
 * Objeto JSON que começa em `inicio` (um "{"), lido pela estrutura (chaves, aspas, escapes) — não pela cerca ```: um
 * bloco de código DENTRO do texto da resposta (ex.: comandos do servidor) não corta o JSON. Conserta o que as IAs
 * costumam mandar: quebra de linha e tabulação soltas dentro do texto. Devolve o texto do objeto ou null.
 */
function objetoJsonEm(texto: string, inicio: number): string | null {
  let prof = 0;
  let emTexto = false;
  let escape = false;
  let saida = '';
  for (let i = inicio; i < texto.length; i++) {
    const c = texto[i];
    if (emTexto) {
      if (escape) {
        escape = false;
        saida += c;
      } else if (c === '\\') {
        escape = true;
        saida += c;
      } else if (c === '"') {
        emTexto = false;
        saida += c;
      } else if (c === '\n') saida += '\\n';
      else if (c === '\r') saida += '\\r';
      else if (c === '\t') saida += '\\t';
      else saida += c;
      continue;
    }
    if (c === '"') emTexto = true;
    else if (c === '{') prof++;
    else if (c === '}') {
      prof--;
      if (prof === 0) return saida + c;
    }
    saida += c;
  }
  return null;
}

/** Remove only syntactic trailing commas, never text inside JSON strings. */
function removeTrailingCommas(json:string):string {
  let out='', quoted=false, escaped=false;
  for(let i=0;i<json.length;i++){
    const c=json[i];
    if(quoted){
      out+=c;
      if(escaped)escaped=false;
      else if(c==='\\')escaped=true;
      else if(c==='"')quoted=false;
      continue;
    }
    if(c==='"')quoted=true;
    if(c===','&&/^\s*[}\]]/.test(json.slice(i+1)))continue;
    out+=c;
  }
  return out;
}

function tentar(json: string | null): any | null {
  if (!json) return null;
  for (const v of [json, removeTrailingCommas(json)]) {
    try {
      const o = JSON.parse(v);
      // Só a resposta principal ({"tipo":"resposta"|"plano"}); um item de memória ({"tipo":"FATO"}) não é a resposta.
      if (o && typeof o === 'object' && (o.tipo === undefined || o.tipo === 'resposta' || o.tipo === 'plano')) return o;
    } catch {
      /* próxima tentativa */
    }
  }
  return null;
}

/**
 * O JSON final da resposta da IA ({"tipo":...}): do ÚLTIMO ```json para trás; depois o último {"tipo" solto; por fim
 * o texto inteiro. Null se nenhum der certo.
 */
export function extractJson(text: string): any | null {
  const posicoes: number[] = [];
  for (const m of text.matchAll(/```json\s*/g)) posicoes.push(m.index! + m[0].length);
  for (const ini of posicoes.reverse()) {
    const abre = text.indexOf('{', ini);
    if (abre < 0) continue;
    const o = tentar(objetoJsonEm(text, abre));
    if (o) return o;
  }
  for (const m of [...text.matchAll(/\{\s*"tipo"\s*:\s*"(resposta|plano)"/g)].reverse()) {
    const o = tentar(objetoJsonEm(text, m.index!));
    if (o) return o;
  }
  const inteiro = text.trim();
  return inteiro.startsWith('{') ? tentar(objetoJsonEm(inteiro, 0)) : null;
}

/** JSON quebrado sem conserto: ao menos o "texto" da resposta, para o usuário não ficar sem nada. */
export function salvarTextoDaResposta(text: string): string | null {
  const m = /"texto"\s*:\s*"((?:[^"\\]|\\.)*)"/s.exec(text);
  if (!m) return null;
  try {
    return JSON.parse(`"${m[1].replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t')}"`);
  } catch {
    return m[1];
  }
}

/** Perguntas com opções vindas da IA, validadas: 1 a 4 perguntas, 2 a 4 opções cada (texto curto). */
export function normalizarPerguntas(bruto: unknown): Array<{ pergunta: string; opcoes: Array<{ rotulo: string; descricao: string }>; multipla: boolean }> | null {
  if (!Array.isArray(bruto)) return null;
  const lista = bruto
    .slice(0, 4)
    .map((q: any) => {
      const pergunta = String(q?.pergunta ?? q?.texto ?? '').trim().slice(0, 1000);
      const opcoes = (Array.isArray(q?.opcoes) ? q.opcoes : [])
        .slice(0, 6)
        .map((o: any) => (typeof o === 'string' ? { rotulo: o, descricao: '' } : { rotulo: String(o?.rotulo ?? o?.label ?? ''), descricao: String(o?.descricao ?? o?.description ?? '') }))
        .map((o: { rotulo: string; descricao: string }) => ({ rotulo: o.rotulo.trim().slice(0, 160), descricao: o.descricao.trim().slice(0, 500) }))
        .filter((o: { rotulo: string }) => o.rotulo);
      return { pergunta, opcoes, multipla: q?.multipla === true };
    })
    .filter((q) => q.pergunta && q.opcoes.length >= 2);
  return lista.length ? lista : null;
}
