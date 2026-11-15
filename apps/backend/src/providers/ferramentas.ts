import { tipoDe } from '../accounts/connections';

/**
 * O que cada IA tem para ler e editar — dito de forma explícita em toda sessão. Regras de projeto do tipo
 * "não use terminal" foram escritas pensando em quem tem ferramentas de arquivo (Claude); o ChatGPT (Codex) só
 * lê arquivos com comandos e, obedecendo à regra ao pé da letra, ficava sem ler nada.
 */
export function ferramentasDaIa(providerId: string, mcp: string[] = []): string[] {
  const extras = mcp.length ? [`- Ferramentas MCP liberadas para este projeto: ${mcp.join(', ')}. Use-as quando ajudarem (ex.: GitHub, documentação de uma biblioteca).`] : [];
  const tipo = tipoDe(providerId);
  const titulo = '## Suas ferramentas nesta sessão (vale sobre qualquer regra do perfil ou instrução da etapa que proíba "terminal" ou "comandos")';
  if (tipo === 'codex-cli' || tipo === 'codex-api') {
    return [
      titulo,
      '- Você (ChatGPT/Codex) lê e lista arquivos SÓ pelo terminal: use à vontade comandos de LEITURA na pasta do trabalho —',
      '  ls, find, cat, sed -n, head, tail, wc, rg/grep, tree, git log, git show, git diff. Isso NÃO é "executar terminal" no',
      '  sentido proibido pelas regras: é a sua forma de ler. Para escrever arquivos, use o seu editor de patch (apply_patch).',
      '- Continuam proibidos: rodar testes, build, lint, instalar pacotes, commit, tag, push, deploy, apagar arquivos e',
      '  qualquer comando que altere o sistema ou acesse a rede. As conferências são executadas pelo sistema.',
      '- Se um comando de leitura falhar, tente outro (ex.: grep no lugar de rg); nunca diga que não consegue ler sem tentar.',
      ...extras,
    ];
  }
  if (tipo === 'claude-code-cli' || tipo === 'claude-api') {
    return [
      titulo,
      '- Você (Claude) lê com Read, procura com Grep e Glob e edita com Edit/Write. Não tem terminal (Bash) e não precisa dele.',
      ...extras,
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
