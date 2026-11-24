import { tipoDe } from '../accounts/connections';

/**
 * O que cada IA tem para ler e editar — dito de forma explícita em toda sessão. Regras de projeto do tipo
 * "não use terminal" foram escritas pensando em quem tem ferramentas de arquivo (Claude); o ChatGPT (Codex) só
 * lê arquivos com comandos e, obedecendo à regra ao pé da letra, ficava sem ler nada.
 */
export function ferramentasDaIa(providerId: string, mcp: string[] = []): string[] {
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
  extras.push(
    '- APAGAR OU MOVER arquivos do projeto (código morto, arquivo esquecido, reorganização): escreva em .nivoo/remover.txt uma',
    '  linha por item — "caminho/do/arquivo-ou-pasta" para apagar, ou "mover antigo/caminho -> novo/caminho". O SISTEMA executa ao',
    '  fim desta sessão (o git guarda tudo, dá para voltar) e a conferência roda depois. Caminhos midia/... apontam para a mídia durável',
    '  do projeto e podem ser origem ou destino. Ajuste as referências (imports, índices) você mesmo.',
  );
  const tipo = tipoDe(providerId);
  const titulo = '## Suas ferramentas nesta sessão (vale sobre qualquer regra do perfil ou instrução da etapa que proíba "terminal" ou "comandos")';
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
  if (tipo === 'nvidia-api') {
    return [
      titulo,
      '- NVIDIA NIM: ferramentas listar_arquivos, ler_arquivo, escrever_arquivo e substituir_texto no worktree.',
      '- Sem terminal ou MCP nesta primeira versão. Testes/builds são executados pelo Nivoo na conferência.',
      '- A API NVIDIA pode ter limite de créditos e modelos sem suporte a ferramentas: use modelo compatível.',
      '- Integrações MCP do projeto não estão disponíveis para o provedor NVIDIA nesta versão.',
    ];
  }
  if (tipo === 'gemini-api') {
    return [
      titulo,
      '- Você (Gemini) lê com read_file/read_many_files, lista com list_directory/glob, procura com search_file_content e edita',
      '  com write_file/replace. Não tem terminal e não precisa dele.',
      ...extras,
    ];
  }
  return [];
}
