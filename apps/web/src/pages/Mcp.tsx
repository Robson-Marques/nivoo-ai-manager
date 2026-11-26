import { FormEvent, useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { BotaoIcone, Estado, Icone, Linha } from './Contas';

/**
 * Ferramentas MCP das IAs (GitHub, documentação, banco…): cada uma é um programa no servidor ou um
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
        Dão às IAs dos projetos acesso a mais coisas: GitHub, documentação de bibliotecas, banco de dados… Cada ferramenta roda no
        servidor com o que você liberar; use só as que você confia. Tokens e senhas ficam guardados no servidor e nunca vão para o texto da IA.
      </p>
      {dados === null && <p className="muted small">Carregando…</p>}
      {dados?.ferramentas.length === 0 && <p className="muted small">Nenhuma ferramenta ainda. Comece por um exemplo pronto em “Nova ferramenta”.</p>}
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
          {m.tipo==='http'&&<span className="small muted"> · Planejamento: {(m.ferramentasPlanejamentoEfetivas??[]).join(', ')||'nenhuma'} · Execução: {Array.isArray(m.ferramentasExecucao)?m.ferramentasExecucao.join(', ')||'nenhuma':'todas autorizadas pelo servidor'}</span>}
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
          <b>Descoberta concluída.</b> {teste.ferramentas.length} ferramenta(s): {teste.ferramentas.map((f: any) => f.nome).join(', ') || '—'}
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
  const [planCustom,setPlanCustom]=useState(Array.isArray(atual?.ferramentasPlanejamento));
  const [execCustom,setExecCustom]=useState(Array.isArray(atual?.ferramentasExecucao));
  const [planNames,setPlanNames]=useState<string>((atual?.ferramentasPlanejamento??[]).join('\n'));
  const [execNames,setExecNames]=useState<string>((atual?.ferramentasExecucao??[]).join('\n'));
  const [discovered,setDiscovered]=useState<string[]>([]);
  const [discoveryBusy,setDiscoveryBusy]=useState(false);
  const names=(text:string)=>[...new Set(text.split(/[\s,]+/).filter(Boolean))];
  const mudarUrl=(value:string)=>{
    setUrl(value);setDiscovered([]);
    if(value.trim()!==String(atual?.url??'').trim()){setPlanNames('');setExecNames('');}
  };
  const discover=async()=>{
    if(!atual||tipo!=='http'||url.trim()!==atual.url)return;
    setDiscoveryBusy(true);setErro(null);
    try{
      const data=await api<any>('/mcp/'+atual.id+'/testar','POST');
      if(!data.ok)throw Error(data.erro??'Não foi possível descobrir ferramentas.');
      setDiscovered(data.ferramentas.map((f:any)=>String(f.nome)));
    }catch(e:any){setErro(e.message);}
    finally{setDiscoveryBusy(false);}
  };
  const [variaveis, setVariaveis] = useState(paraLinhas(atual?.variaveis));
  // Segredos: nome → valor digitado ('' = manter o atual).
  const [segredos, setSegredos] = useState<Array<{ nome: string; valor: string; definido: boolean; cabecalho: boolean }>>(
    (atual?.segredos ?? []).map((s: any) => ({ nome: s.nome, valor: '', definido: s.definido, cabecalho: (atual?.cabecalhosSecretos ?? []).includes(s.nome) })),
  );
  const [todos, setTodos] = useState(atual ? atual.projetos === 'todos' : true);
  const [escolhidos, setEscolhidos] = useState<string[]>(atual && atual.projetos !== 'todos' ? atual.projetos : []);
  const [erro, setErro] = useState<string | null>(null);
  const [prontoEscolhido, setProntoEscolhido] = useState<any>(null);
  const [ocupado, setOcupado] = useState(false);
  const usarPronto = (p: any) => {
    setProntoEscolhido(p);
    if(p.somenteProjetosEscolhidos){setTodos(false);setEscolhidos([]);}
    setNome(p.nome);
    setTipo(p.tipo);
    setComando(p.tipo === 'comando' ? [p.comando, ...(p.args ?? [])].join(' ') : '');
    setUrl(p.url ?? '');
    setPlanCustom(false);setExecCustom(false);setPlanNames('');setExecNames('');setDiscovered([]);
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
      else Object.assign(corpo,{url:url.trim(),ferramentasPlanejamento:planCustom?names(planNames):null,ferramentasExecucao:execCustom?names(execNames):null});
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
            <span className="muted small">Exemplos prontos (ou preencha à mão abaixo):</span>
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
        {prontoEscolhido?.dica && <p className="muted small">{prontoEscolhido.dica} {prontoEscolhido.ajudaUrl && <a href={prontoEscolhido.ajudaUrl} target="_blank" rel="noopener noreferrer">Obter chave</a>}</p>}
        <label>Nome<input value={nome} onChange={(e) => setNome(e.target.value)} required maxLength={60} placeholder="Ex.: GitHub da empresa" /></label>
        <div className="row small">
          <label style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}><input type="radio" style={{ width: 'auto' }} checked={tipo === 'comando'} onChange={() => setTipo('comando')} /> Programa no servidor</label>
          <label style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}><input type="radio" style={{ width: 'auto' }} checked={tipo === 'http'} onChange={() => setTipo('http')} /> Endereço na internet</label>
        </div>
        {tipo === 'comando' ? (
          <label>
            Comando
            <input value={comando} onChange={(e) => setComando(e.target.value)} required placeholder="npx -y nome-do-pacote-mcp" />
            <span className="muted small">O programa é instalado e roda no servidor (ex.: npx baixa na primeira vez).</span>
          </label>
        ) : (
          <label>Endereço<input value={url} onChange={(e) => mudarUrl(e.target.value)} required placeholder="https://mcp.exemplo.com/mcp" /></label>
        )}
        {tipo==='http'&&<div className="campo">
          <b className="small">Permissões por ferramenta</b>
          <label>Planejamento<select value={planCustom?'custom':'default'} onChange={e=>setPlanCustom(e.target.value==='custom')}>
            <option value="default">Consultas oficiais conhecidas (demais bloqueadas)</option>
            <option value="custom">Somente nomes escolhidos</option>
          </select></label>
          {planCustom&&<label>Nomes autorizados antes de Fazer<textarea rows={3} value={planNames} onChange={e=>setPlanNames(e.target.value)} placeholder="resolve-library-id&#10;query-docs"/><span className="muted small">Vazio bloqueia todas. Autorize apenas consultas que você confia; nomes não garantem ausência de efeitos.</span></label>}
          <label>Execução aprovada<select value={execCustom?'custom':'default'} onChange={e=>setExecCustom(e.target.value==='custom')}>
            <option value="default">Todas as ferramentas do servidor autorizado</option>
            <option value="custom">Somente nomes escolhidos</option>
          </select></label>
          {execCustom&&<label>Nomes autorizados na execução<textarea rows={3} value={execNames} onChange={e=>setExecNames(e.target.value)} placeholder="search&#10;get_component"/><span className="muted small">Vazio bloqueia todas. Revisões independentes não recebem MCP.</span></label>}
          {atual&&url.trim()===atual.url&&<button type="button" className="secondary" disabled={discoveryBusy} onClick={discover}>{discoveryBusy?'Consultando…':'Descobrir nomes disponíveis'}</button>}
          {discovered.length>0&&<div className="small">{discovered.map(n=><div key={n} className="row"><code>{n}</code>{planCustom&&<label><input type="checkbox" checked={names(planNames).includes(n)} onChange={e=>setPlanNames((e.target.checked?[...names(planNames),n]:names(planNames).filter(x=>x!==n)).join('\n'))}/> Planejar</label>}{execCustom&&<label><input type="checkbox" checked={names(execNames).includes(n)} onChange={e=>setExecNames((e.target.checked?[...names(execNames),n]:names(execNames).filter(x=>x!==n)).join('\n'))}/> Executar</label>}</div>)}</div>}
          <span className="muted small">A descoberta consulta a configuração salva; não executa ferramentas. O filtro valida novamente a lista quando o CLI conecta.</span>
        </div>}
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
