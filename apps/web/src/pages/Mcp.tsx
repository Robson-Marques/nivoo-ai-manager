import { FormEvent, useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { BotaoIcone, Estado, Icone, Linha } from './Contas';

/**
 * Ferramentas MCP das IAs (navegador, documentação, GitHub, banco…): cada uma é um programa no servidor ou um
 * endereço. Tokens e senhas ficam guardados no servidor e não voltam para a tela. Cada ferramenta vale para
 * todos os projetos ou só para os escolhidos.
 */
export function FerramentasMcp() {
  const [dados, setDados] = useState<{ ferramentas: any[]; prontos: any[] } | null>(null);
  const [projetos, setProjetos] = useState<any[]>([]);
  const [editando, setEditando] = useState<any | 'nova' | null>(null);
  const carregar = useCallback(async () => {
    const [d, p] = await Promise.all([api<any>('/mcp'), api<any[]>('/projects')]);
    setDados(d);
    setProjetos(p);
  }, []);
  useEffect(() => {
    carregar().catch(() => setDados({ ferramentas: [], prontos: [] }));
  }, [carregar]);
  return (
    <div className="conexoes" style={{ marginTop: 28 }}>
      <div className="conexoes-topo">
        <h2>Ferramentas das IAs (MCP) ({dados?.ferramentas.length ?? 0})</h2>
        <button className="botao-nova" onClick={() => setEditando('nova')}>
          <Icone nome="mais" /> Nova ferramenta
        </button>
      </div>
      <p className="muted small">
        Dão às IAs dos projetos acesso a mais coisas: abrir páginas no navegador, consultar documentação, GitHub, banco de dados… Cada ferramenta roda no
        servidor com o que você liberar; use só as que você confia. Tokens e senhas ficam guardados no servidor e nunca vão para o texto da IA.
      </p>
      {dados === null && <p className="muted small">Carregando…</p>}
      {dados?.ferramentas.length === 0 && <p className="muted small">Nenhuma ferramenta ainda. Comece por um modelo pronto em “Nova ferramenta”.</p>}
      {dados?.ferramentas.map((m) => <LinhaMcp key={m.id} m={m} projetos={projetos} onEditar={() => setEditando(m)} onMudou={carregar} />)}
      {editando && dados && (
        <FormMcp
          atual={editando === 'nova' ? null : editando}
          prontos={dados.prontos}
          projetos={projetos}
          onFechar={() => setEditando(null)}
          onSalvo={async () => {
            setEditando(null);
            await carregar();
          }}
        />
      )}
    </div>
  );
}

function LinhaMcp({ m, projetos, onEditar, onMudou }: { m: any; projetos: any[]; onEditar: () => void; onMudou: () => void }) {
  const [teste, setTeste] = useState<any | null>(null);
  const [testando, setTestando] = useState(false);
  const faltando = (m.segredos ?? []).filter((s: any) => !s.definido).map((s: any) => s.nome);
  const onde = m.projetos === 'todos' ? 'todos os projetos' : `${m.projetos.length} projeto(s): ${m.projetos.map((id: string) => projetos.find((p) => p.id === id)?.name ?? '?').join(', ')}`;
  const testar = async () => {
    setTestando(true);
    setTeste(null);
    try {
      setTeste(await api(`/mcp/${m.id}/testar`, 'POST'));
    } catch (e: any) {
      setTeste({ ok: false, erro: e.message });
    } finally {
      setTestando(false);
    }
  };
  return (
    <Linha
      icone={<span className="marca marca-git"><Icone nome="plugue" /></span>}
      nome={m.nome}
      selos={<span className="selo-tipo">{m.tipo === 'comando' ? 'PROGRAMA NO SERVIDOR' : 'ENDEREÇO'}</span>}
      detalhe={
        <>
          <code className="small">{m.tipo === 'comando' ? `${m.comando} ${(m.args ?? []).join(' ')}` : m.url}</code>
          <span> · para {onde} · a IA vê como “{m.nomeTecnico}”</span>
        </>
      }
      estado={
        !m.ativo ? <Estado ok={false} texto="Desligada" /> : faltando.length ? <Estado ok={false} texto={`Falta informar: ${faltando.join(', ')}`} /> : <Estado ok={true} texto="Ligada" />
      }
      acoes={
        <>
          <BotaoIcone nome="plugue" titulo="Testar (liga e lista as ferramentas)" onClick={testar} disabled={testando} />
          <BotaoIcone nome="lapis" titulo="Editar" onClick={onEditar} />
          <BotaoIcone nome="desligar" titulo={m.ativo ? 'Desligar' : 'Ligar'} onClick={async () => { await api(`/mcp/${m.id}`, 'PATCH', { ativo: !m.ativo }); onMudou(); }} />
          <BotaoIcone nome="lixeira" titulo="Excluir" perigo onClick={async () => { if (window.confirm(`Excluir a ferramenta "${m.nome}"? Os tokens guardados dela também saem.`)) { await api(`/mcp/${m.id}`, 'DELETE'); onMudou(); } }} />
        </>
      }
    >
      {testando && <p className="muted small">Ligando a ferramenta… (na primeira vez pode baixar o programa e levar um pouco)</p>}
      {teste && (teste.ok ? (
        <div className="small">
          <b>Funcionando.</b> {teste.ferramentas.length} ferramenta(s): {teste.ferramentas.map((f: any) => f.nome).join(', ') || '—'}
        </div>
      ) : (
        <div className="error small">Não funcionou: {teste.erro}</div>
      ))}
    </Linha>
  );
}

/** "A=1\nB=dois" ⇄ {A:'1', B:'dois'} */
const deLinhas = (t: string) => Object.fromEntries(t.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => [l.split('=')[0].trim(), l.slice(l.indexOf('=') + 1).trim()]));
const paraLinhas = (o: Record<string, string> = {}) => Object.entries(o).map(([k, v]) => `${k}=${v}`).join('\n');

function FormMcp({ atual, prontos, projetos, onFechar, onSalvo }: { atual: any | null; prontos: any[]; projetos: any[]; onFechar: () => void; onSalvo: () => void }) {
  const [nome, setNome] = useState(atual?.nome ?? '');
  const [tipo, setTipo] = useState<'comando' | 'http'>(atual?.tipo ?? 'comando');
  const [comando, setComando] = useState(atual ? `${atual.comando ?? ''} ${(atual.args ?? []).map((a: string) => (/\s/.test(a) ? `"${a}"` : a)).join(' ')}`.trim() : '');
  const [url, setUrl] = useState(atual?.url ?? '');
  const [variaveis, setVariaveis] = useState(paraLinhas(atual?.variaveis));
  // Segredos: nome → valor digitado ('' = manter o atual).
  const [segredos, setSegredos] = useState<Array<{ nome: string; valor: string; definido: boolean; cabecalho: boolean }>>(
    (atual?.segredos ?? []).map((s: any) => ({ nome: s.nome, valor: '', definido: s.definido, cabecalho: (atual?.cabecalhosSecretos ?? []).includes(s.nome) })),
  );
  const [todos, setTodos] = useState(atual ? atual.projetos === 'todos' : true);
  const [escolhidos, setEscolhidos] = useState<string[]>(atual && atual.projetos !== 'todos' ? atual.projetos : []);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const usarPronto = (p: any) => {
    setNome(p.nome);
    setTipo(p.tipo);
    setComando(p.tipo === 'comando' ? [p.comando, ...(p.args ?? [])].join(' ') : '');
    setUrl(p.url ?? '');
    setSegredos((p.cabecalhos ?? []).map((c: string) => ({ nome: c, valor: '', definido: false, cabecalho: true })));
  };
  const salvar = async (e: FormEvent) => {
    e.preventDefault();
    setErro(null);
    setOcupado(true);
    try {
      const partes = comando.trim().match(/"[^"]*"|'[^']*'|\S+/g) ?? [];
      const sem = (s: string) => s.replace(/^["']|["']$/g, '');
      const corpo: any = {
        nome,
        tipo,
        variaveis: deLinhas(variaveis),
        projetos: todos ? 'todos' : escolhidos,
        segredos: Object.fromEntries(segredos.filter((s) => !s.cabecalho).map((s) => [s.nome, s.valor])),
        cabecalhos: Object.fromEntries(segredos.filter((s) => s.cabecalho).map((s) => [s.nome, s.valor])),
      };
      // Segredos removidos da lista: apagar no servidor.
      for (const s of atual?.segredos ?? []) {
        if (!segredos.some((x) => x.nome === s.nome)) ((atual.cabecalhosSecretos ?? []).includes(s.nome) ? corpo.cabecalhos : corpo.segredos)[s.nome] = null;
      }
      if (tipo === 'comando') Object.assign(corpo, { comando: sem(partes[0] ?? ''), args: partes.slice(1).map(sem) });
      else corpo.url = url.trim();
      if (atual) await api(`/mcp/${atual.id}`, 'PATCH', corpo);
      else await api('/mcp', 'POST', corpo);
      onSalvo();
    } catch (err: any) {
      setErro(err.message);
    } finally {
      setOcupado(false);
    }
  };
  return (
    <div className="modal-fundo" onClick={onFechar}>
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={salvar}>
        <h2>{atual ? `Editar ${atual.nome}` : 'Nova ferramenta (MCP)'}</h2>
        {!atual && (
          <>
            <span className="muted small">Modelos prontos (ou preencha à mão abaixo):</span>
            <div className="tipos-conexao">
              {prontos.map((p) => (
                <button type="button" key={p.chave} className="tipo-conexao" onClick={() => usarPronto(p)}>
                  <span className="marca marca-git"><Icone nome="plugue" /></span>
                  <span>
                    <b>{p.nome}</b>
                    <span className="muted small">{p.descricao}</span>
                  </span>
                </button>
              ))}
            </div>
          </>
        )}
        <label>Nome<input value={nome} onChange={(e) => setNome(e.target.value)} required maxLength={60} placeholder="Ex.: Navegador" /></label>
        <div className="row small">
          <label style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}><input type="radio" style={{ width: 'auto' }} checked={tipo === 'comando'} onChange={() => setTipo('comando')} /> Programa no servidor</label>
          <label style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}><input type="radio" style={{ width: 'auto' }} checked={tipo === 'http'} onChange={() => setTipo('http')} /> Endereço na internet</label>
        </div>
        {tipo === 'comando' ? (
          <label>
            Comando
            <input value={comando} onChange={(e) => setComando(e.target.value)} required placeholder="npx -y @playwright/mcp@latest --headless" />
            <span className="muted small">O programa é instalado e roda no servidor (ex.: npx baixa na primeira vez).</span>
          </label>
        ) : (
          <label>Endereço<input value={url} onChange={(e) => setUrl(e.target.value)} required placeholder="https://mcp.exemplo.com/mcp" /></label>
        )}
        <label>
          Variáveis (não secretas), uma por linha
          <textarea rows={2} value={variaveis} onChange={(e) => setVariaveis(e.target.value)} placeholder="MODO=leitura" />
        </label>
        <div className="campo">
          <b className="small">{tipo === 'comando' ? 'Tokens e senhas (variáveis secretas)' : 'Tokens (cabeçalhos secretos)'}</b>
          {segredos.map((s, i) => (
            <div className="row" key={i}>
              <input style={{ flex: 1 }} value={s.nome} onChange={(e) => setSegredos(segredos.map((x, j) => (j === i ? { ...x, nome: e.target.value } : x)))} placeholder={s.cabecalho ? 'Authorization' : 'API_KEY'} />
              <input style={{ flex: 2 }} type="password" value={s.valor} onChange={(e) => setSegredos(segredos.map((x, j) => (j === i ? { ...x, valor: e.target.value } : x)))} placeholder={s.definido ? 'guardado — deixe vazio para manter' : s.cabecalho && s.nome === 'Authorization' ? 'Bearer seu-token' : 'valor'} />
              <button type="button" className="link small" onClick={() => setSegredos(segredos.filter((_, j) => j !== i))}>remover</button>
            </div>
          ))}
          <button type="button" className="link small" onClick={() => setSegredos([...segredos, { nome: '', valor: '', definido: false, cabecalho: tipo === 'http' }])}>+ adicionar</button>
        </div>
        <div className="campo">
          <b className="small">Quais projetos usam</b>
          <label style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}><input type="radio" style={{ width: 'auto' }} checked={todos} onChange={() => setTodos(true)} /> Todos os projetos</label>
          <label style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}><input type="radio" style={{ width: 'auto' }} checked={!todos} onChange={() => setTodos(false)} /> Só estes:</label>
          {!todos && (
            <div className="escolha-projetos">
              {projetos.map((p) => (
                <label key={p.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <input type="checkbox" style={{ width: 'auto' }} checked={escolhidos.includes(p.id)} onChange={(e) => setEscolhidos(e.target.checked ? [...escolhidos, p.id] : escolhidos.filter((x) => x !== p.id))} /> {p.name}
                </label>
              ))}
            </div>
          )}
        </div>
        {erro && <div className="error">{erro}</div>}
        <div className="row">
          <button disabled={ocupado || !nome.trim() || (!todos && !escolhidos.length)}>{ocupado ? 'Salvando…' : atual ? 'Salvar' : 'Criar ferramenta'}</button>
          <button type="button" className="secondary" onClick={onFechar}>Cancelar</button>
        </div>
        <span className="muted small">Depois de criar, use “Testar” na lista para ver se ela liga e quais ferramentas oferece.</span>
      </form>
    </div>
  );
}
