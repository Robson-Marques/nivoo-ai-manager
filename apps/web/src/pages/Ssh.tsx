import { FormEvent, useCallback, useEffect, useState } from 'react';
import { api, copiarTexto, nomeUsuario } from '../api';
import { BotaoIcone, Estado, Icone, Linha } from './Contas';

/**
 * Servidores SSH que as IAs podem usar — cada comando só roda com o "Permitir" do usuário. O Nivoo gera a chave:
 * aqui aparece só a parte pública, para colar no authorized_keys do servidor.
 */
export function ServidoresSsh() {
  const [lista, setLista] = useState<any[] | null>(null);
  const [projetos, setProjetos] = useState<any[]>([]);
  const [editando, setEditando] = useState<any | 'novo' | null>(null);
  const [abrir, setAbrir] = useState<string | null>(null);
  const carregar = useCallback(async () => {
    const [s, p] = await Promise.all([api<any[]>('/ssh/servidores'), api<any[]>('/projects')]);
    setLista(s);
    setProjetos(p);
  }, []);
  useEffect(() => {
    carregar().catch(() => setLista([]));
  }, [carregar]);
  return (
    <div className="conexoes" style={{ marginTop: 28 }}>
      <div className="conexoes-topo">
        <h2>Servidores SSH ({lista?.length ?? 0})</h2>
        <button className="botao-nova" onClick={() => setEditando('novo')}>
          <Icone nome="mais" /> Novo servidor
        </button>
      </div>
      <p className="muted small">
        A IA dos projetos liberados pode pedir para rodar comandos nestes servidores (ver logs, atualizar, reiniciar…). <b>Cada comando só roda depois que você
        clica em Permitir</b> na conversa. O Nivoo gera uma chave só para isso; coloque a chave pública no servidor.
      </p>
      {lista?.length === 0 && <p className="muted small">Nenhum servidor ainda.</p>}
      {lista?.map((s) => <LinhaSsh key={s.id} s={s} projetos={projetos} aberto={abrir === s.id} onEditar={() => setEditando(s)} onMudou={carregar} />)}
      {editando && (
        <FormSsh
          atual={editando === 'novo' ? null : editando}
          projetos={projetos}
          onFechar={() => setEditando(null)}
          onSalvo={async (id) => {
            setEditando(null);
            setAbrir(id); // recém-criado: já mostra a chave para colar no servidor
            await carregar();
          }}
        />
      )}
    </div>
  );
}

function LinhaSsh({ s, projetos, aberto, onEditar, onMudou }: { s: any; projetos: any[]; aberto: boolean; onEditar: () => void; onMudou: () => void }) {
  const [verChave, setVerChave] = useState(aberto);
  const [teste, setTeste] = useState<any | null>(null);
  const [testando, setTestando] = useState(false);
  const [copiado, setCopiado] = useState(false);
  useEffect(() => setVerChave(aberto), [aberto]);
  const onde = s.projetos === 'todos' ? 'todos os projetos' : `${s.projetos.length} projeto(s): ${s.projetos.map((id: string) => projetos.find((p) => p.id === id)?.name ?? '?').join(', ')}`;
  const comandoChave = `mkdir -p ~/.ssh && echo '${s.chavePublica}' >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys`;
  const testar = async () => {
    setTestando(true);
    setTeste(null);
    try {
      setTeste(await api(`/ssh/servidores/${s.id}/testar`, 'POST'));
    } catch (e: any) {
      setTeste({ ok: false, saida: e.message });
    } finally {
      setTestando(false);
    }
  };
  return (
    <Linha
      icone={<span className="marca marca-git"><Icone nome="chave" /></span>}
      nome={s.nome}
      selos={<span className="selo-tipo">SSH</span>}
      detalhe={<><code className="small">{s.usuario}@{s.host}{s.porta !== 22 ? `:${s.porta}` : ''}</code><span> · para {onde}</span></>}
      estado={teste ? <Estado ok={teste.ok} texto={teste.ok ? 'Acesso funcionando' : 'Sem acesso'} /> : <Estado ok={'andamento'} texto="Cada comando pede a sua permissão" />}
      acoes={
        <>
          <BotaoIcone nome="plugue" titulo="Testar o acesso" onClick={testar} disabled={testando} />
          <BotaoIcone nome="chave" titulo="Ver a chave pública" onClick={() => setVerChave(!verChave)} />
          <BotaoIcone nome="lapis" titulo="Editar" onClick={onEditar} />
          <BotaoIcone nome="lixeira" titulo="Excluir" perigo onClick={async () => { if (window.confirm(`Excluir o servidor "${s.nome}"? A chave do Nivoo é apagada; tire-a também do authorized_keys do servidor.`)) { await api(`/ssh/servidores/${s.id}`, 'DELETE'); onMudou(); } }} />
        </>
      }
    >
      {testando && <p className="muted small">Conectando…</p>}
      {teste && (teste.ok ? <div className="small">Conectou: <code>{teste.saida}</code></div> : <div className="error small">Não conectou: {teste.dica ?? ''} <code>{teste.saida}</code></div>)}
      {verChave && (
        <div className="chave-ssh small">
          <span><b>Coloque esta chave no servidor</b> (entre nele como <code>{s.usuario}</code> e rode):</span>
          <pre className="texto-arquivo">{comandoChave}</pre>
          <div className="row">
            <button type="button" className="secondary" onClick={async () => { await copiarTexto(comandoChave); setCopiado(true); setTimeout(() => setCopiado(false), 2000); }}>{copiado ? 'Copiado' : 'Copiar comando'}</button>
            <button type="button" className="link small" onClick={async () => { if (window.confirm('Gerar uma chave nova? A atual deixa de ser usada pelo Nivoo; troque também no servidor.')) { await api(`/ssh/servidores/${s.id}/nova-chave`, 'POST'); onMudou(); } }}>gerar nova chave</button>
          </div>
          <span className="muted">Depois clique em “Testar o acesso”.</span>
        </div>
      )}
    </Linha>
  );
}

function FormSsh({ atual, projetos, onFechar, onSalvo }: { atual: any | null; projetos: any[]; onFechar: () => void; onSalvo: (id: string) => void }) {
  const [nome, setNome] = useState(atual?.nome ?? '');
  const [host, setHost] = useState(atual?.host ?? '');
  const [porta, setPorta] = useState(String(atual?.porta ?? 22));
  const [usuario, setUsuario] = useState(atual?.usuario ?? 'root');
  const [todos, setTodos] = useState(atual ? atual.projetos === 'todos' : false);
  const [escolhidos, setEscolhidos] = useState<string[]>(atual && atual.projetos !== 'todos' ? atual.projetos : []);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const salvar = async (e: FormEvent) => {
    e.preventDefault();
    setErro(null);
    setOcupado(true);
    try {
      const corpo = { nome, host: host.trim(), porta: Number(porta), usuario: usuario.trim(), projetos: todos ? 'todos' : escolhidos };
      const s = atual ? await api(`/ssh/servidores/${atual.id}`, 'PATCH', corpo) : await api('/ssh/servidores', 'POST', corpo);
      onSalvo(s.id);
    } catch (err: any) {
      setErro(err.message);
    } finally {
      setOcupado(false);
    }
  };
  return (
    <div className="modal-fundo" onClick={onFechar}>
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={salvar}>
        <h2>{atual ? `Editar ${atual.nome}` : 'Novo servidor SSH'}</h2>
        <label>Nome<input value={nome} onChange={(e) => setNome(e.target.value)} required maxLength={60} placeholder="Ex.: Produção ConnectChat" /></label>
        <div className="row">
          <label style={{ flex: 3 }}>Endereço<input value={host} onChange={(e) => setHost(e.target.value)} required placeholder="131.161.180.35 ou servidor.empresa.com.br" /></label>
          <label style={{ flex: 1 }}>Porta<input value={porta} onChange={(e) => setPorta(e.target.value)} inputMode="numeric" /></label>
        </div>
        <label>Usuário<input value={usuario} onChange={(e) => setUsuario(e.target.value)} required placeholder="root, deploy…" /></label>
        <div className="campo">
          <b className="small">Quais projetos podem pedir comandos neste servidor</b>
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
          <label style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}><input type="radio" style={{ width: 'auto' }} checked={todos} onChange={() => setTodos(true)} /> Todos os projetos</label>
        </div>
        {!atual && <span className="muted small">Ao criar, o Nivoo gera a chave e mostra o comando para colar no servidor.</span>}
        {erro && <div className="error">{erro}</div>}
        <div className="row">
          <button disabled={ocupado || !nome.trim() || !host.trim() || (!todos && !escolhidos.length)}>{ocupado ? 'Salvando…' : atual ? 'Salvar' : 'Criar e gerar a chave'}</button>
          <button type="button" className="secondary" onClick={onFechar}>Cancelar</button>
        </div>
      </form>
    </div>
  );
}

/**
 * Pedidos de comando da IA esperando a sua decisão (na conversa do projeto). Nada roda sem o "Permitir".
 */
export function PedidosSsh({ projetoId }: { projetoId: string }) {
  const [pendentes, setPendentes] = useState<any[]>([]);
  const [decidindo, setDecidindo] = useState<string | null>(null);
  const carregar = useCallback(async () => setPendentes(await api<any[]>(`/projects/${projetoId}/ssh/pedidos?status=PENDENTE`)), [projetoId]);
  useEffect(() => {
    carregar().catch(() => undefined);
    const t = setInterval(() => carregar().catch(() => undefined), 2500);
    return () => clearInterval(t);
  }, [carregar]);
  if (!pendentes.length) return null;
  const decidir = async (id: string, permitir: boolean) => {
    setDecidindo(id);
    try {
      await api(`/projects/${projetoId}/ssh/pedidos/${id}/decidir`, 'POST', { permitir, por: nomeUsuario() });
      await carregar();
    } catch {
      await carregar();
    } finally {
      setDecidindo(null);
    }
  };
  return (
    <div className="pedidos-ssh">
      {[...pendentes].reverse().map((p) => (
        <div key={p.id} className="pedido-ssh">
          <div className="small"><Icone nome="chave" /> <b>A IA quer rodar no servidor {p.servidorNome}</b>{p.motivo ? ` — ${p.motivo}` : ''}</div>
          <pre className="texto-arquivo">{p.comando}</pre>
          <div className="row">
            <button disabled={decidindo === p.id} onClick={() => decidir(p.id, true)}>Permitir</button>
            <button className="secondary" disabled={decidindo === p.id} onClick={() => decidir(p.id, false)}>Recusar</button>
            <span className="muted small">Só este comando. A IA está esperando a sua resposta.</span>
          </div>
        </div>
      ))}
    </div>
  );
}
