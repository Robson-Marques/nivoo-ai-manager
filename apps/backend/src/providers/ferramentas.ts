import { tipoDe } from '../accounts/connections';

/**
 * O que cada IA tem para ler e editar — dito de forma explícita em toda sessão. Regras de projeto do tipo
 * "não use terminal" foram escritas pensando em quem tem ferramentas de arquivo (Claude); o ChatGPT (Codex) só
 * lê arquivos com comandos e, obedecendo à regra ao pé da letra, ficava sem ler nada.
 */
export function ferramentasDaIa(providerId: string, mcp: string[] = [], readOnly=false): string[] {
  const extras = mcp.length ? [`- Ferramentas MCP liberadas para este projeto: ${mcp.join(', ')}. Use-as quando ajudarem (ex.: GitHub, documentação de uma biblioteca).`] : [];
  if (mcp.includes('servidores-ssh')) {
    extras.push(
      '- servidores-ssh: roda comandos nos servidores do projeto (listar_servidores, executar_no_servidor). O USUÁRIO PRECISA PERMITIR CADA',
      '  COMANDO na tela antes de ele rodar: explique o motivo, agrupe passos num comando só e não repita um comando recusado.',
      '  Antes de mudar algo em produção, leia o estado (logs, status, versão) e diga o que vai fazer.',
    );
  }
  // Apagar/mover: nenhuma IA tem um comando seguro para isso (Claude e Gemini sem terminal; Codex orientado a não
  // apagar). O sistema faz por elas, ao fim da sessão, o que estiver pedido em .nivoo/remover.txt.
  if(!readOnly)extras.push(
    '- APAGAR OU MOVER arquivos do projeto (código morto, arquivo esquecido, reorganização): escreva em .nivoo/remover.txt uma',
    '  linha por item — "caminho/do/arquivo-ou-pasta" para apagar, ou "mover antigo/caminho -> novo/caminho". O SISTEMA executa ao',
    '  fim desta sessão apenas para arquivos normais do código. Não use esse diário para out/, midia/ ou caminhos protegidos: precisam de etapa explícita e aprovação quando fora do Git.',
    '  O Git preserva apenas arquivos versionados. Ajuste as referências (imports, índices) você mesmo.',
  );
  const tipo = tipoDe(providerId);
  const titulo = '## Suas ferramentas nesta sessão (respeite a política de segurança e o escopo autorizado)';
  if(readOnly){
    const policy='- Sessão de planejamento: somente leitura local. Proponha alterações no plano; não edite, mova, remova ou rode testes/builds.';
    if(tipo==='codex-cli'||tipo==='codex-api')return [titulo,policy,'- Use ls, rg, grep, cat, sed -n, git log/show/diff e outros comandos de leitura no workspace; não use apply_patch.',...extras];
    if(tipo==='claude-code-cli'||tipo==='claude-api')return [titulo,policy,'- Read, Glob e Grep; sem Bash ou Edit/Write.',...extras];
    if(tipo==='gemini-api')return [titulo,policy,'- read_file, read_many_files, list_directory, glob e grep_search (alias search_file_content); sem terminal, replace ou write_file.',...extras];
    if(['nvidia-api','openrouter-free-api','groq-free-api'].includes(tipo??''))return [titulo,policy,'- listar_arquivos e ler_arquivo (paginação com proximo). Sem MCP, terminal, escrita ou notas nesta sessão.'];
    return [];
  }
  if (tipo === 'codex-cli' || tipo === 'codex-api') {
    return [
      titulo,
      '- Você (ChatGPT/Codex) lê e lista arquivos SÓ pelo terminal: use à vontade comandos de LEITURA na pasta do trabalho —',
      '  ls, find, cat, sed -n, head, tail, wc, rg/grep, tree, git log, git show, git diff. Isso NÃO é "executar terminal" no',
      '  sentido proibido pelas regras: é a sua forma de ler. Para escrever arquivos, use o seu editor de patch (apply_patch).',
      '- Continuam proibidos: rodar testes, build, lint, instalar pacotes, commit, tag, push, deploy, apagar arquivos pelo terminal',
      '  (use .nivoo/remover.txt, abaixo) e qualquer comando que altere o sistema ou acesse a rede. As conferências (testes, build)',
      '  são executadas pelo sistema ao fim da sessão; a saída completa da última fica em .nivoo/ultima-conferencia.txt.',
      '- Se um comando de leitura falhar, tente outro (ex.: grep no lugar de rg); nunca diga que não consegue ler sem tentar.',
      '- Geração de IMAGEM nativa em uma etapa visualAsset: use image_gen integrado à conta, uma imagem por etapa. O Nivoo importa o PNG da sessão para o caminho contratado. Não tente acessar CODEX_HOME, recriar fotografia por código ou chamar outra API. Se a ferramenta falhar, reporte o erro real sem repetir.', 
      '- Notas, lições ou tentativas anteriores que digam que você "não tem leitor", que "terminal é proibido" ou que precisa de',
      '  "leitura local disponibilizada" estão ERRADAS (a regra foi corrigida): ignore-as e leia os arquivos com os comandos acima.',
      ...extras,
    ];
  }
  if (tipo === 'claude-code-cli' || tipo === 'claude-api') {
    return [
      titulo,
      '- Você (Claude) lê com Read, procura com Grep e Glob e edita com Edit/Write. Não tem terminal (Bash) e não precisa dele.',
      '- Bash está DESABILITADO inclusive para head/cat; chame Read no arquivo inteiro ou por trechos. Nunca tente Bash, nem em subagentes.',
      '- Para executar comandos reais (render, ffmpeg, teste, build), a etapa seguinte deve usar local-shell com um comando concreto; não tente executá-los aqui.',
      ...extras,
    ];
  }
  if (tipo === 'nvidia-api'||tipo==='openrouter-free-api'||tipo==='groq-free-api') {
    return [
      titulo,
      '- Ferramentas de texto: listar_arquivos, ler_arquivo, escrever_arquivo, substituir_texto e registrar_progresso. Leia os arquivos de contexto autorizados, inclusive SKILL.md; use proximo para paginar e sha256 para edições seguras.',
      '- Sem terminal ou MCP nesta primeira versão. Testes/builds são executados pelo Nivoo na conferência.',
      '- A API pode ter cotas e modelos sem suporte a ferramentas: use modelo compatível. Não escreva binários com ferramentas de texto.',
      '- MCP e terminal não estão disponíveis nesta conexão. Para notas use registrar_progresso; para entregar resultados use out/ ou o destino contratado. Não invente um comando executado.',
    ];
  }
  if (tipo === 'gemini-api') {
    return [
      titulo,
      '- Você (Gemini) lê com read_file/read_many_files, lista com list_directory/glob, procura com grep_search (alias search_file_content) e edita',
      '  com write_file/replace. Não tem terminal e não precisa dele.',
      ...extras,
    ];
  }
  return [];
}
