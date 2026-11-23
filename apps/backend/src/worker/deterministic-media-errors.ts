/** Falhas determinísticas: repetir o mesmo shell não muda um script ou filtro inválido. */
export function diagnosticoRenderDeterministico(saida: string): string | null {
  if (/Error while parsing expression[^\n]*eq\(n,|\[Parsed_select_\d+[^\n]*Error while parsing expression|Error initializing filters[^\n]*\n[^\n]*Cannot allocate memory/i.test(saida)) {
    return 'FFmpeg rejeitou uma expressão select gigantesca de quadros. Não repita este script. Use nivoo-extrair-quadros para extrair os quadros sequencialmente (sem select=eq(n,...)) e altere o script de montagem para consumir os PNGs preparados.';
  }
  if (/the following arguments are required:\s*mode|the following arguments are required:\s*\{quadros,video\}/i.test(saida)) {
    return 'O script Python foi chamado sem o modo obrigatório. Consulte --help e use os subcomandos quadros e video corretamente antes de executar de novo.';
  }
  if (/cp:.*(?:cannot stat|não foi possível obter estado|No such file)/i.test(saida)) {
    return 'Arquivo de trabalho anterior não encontrado no caminho informado. Liste contexto/resultados/<id>/ e confira o caminho real antes de copiar; não repita o mesmo comando.';
  }
  return null;
}

/** Scripts falhos são reparáveis por edição do worktree, mesmo que o
 * executor seja determinístico. Não confundir com ausência de Bash/GPU,
 * crédito de API ou recurso físico que a IA não consegue inventar. */
export function falhaLocalCorrigivel(saida: string): boolean {
  if (/command not found|comando não encontrado|sem conexão|falta de token|credencial ausente|permission denied/i.test(saida)) {
    return false;
  }
  return !!diagnosticoRenderDeterministico(saida) ||
    /SyntaxError|AssertionError|Cannot find module|ERR_MODULE_NOT_FOUND|Module not found|ReferenceError|TypeError|script\b[^\n]{0,120}\.cjs|\.tsx?:\d+:\d+: error/i.test(saida);
}
