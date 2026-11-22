# Descoberta do catálogo HyperFrames (modo somente leitura)

A documentação oficial orienta usar **hyperframes catalog --query "<efeito em inglês>" --json** para procurar itens, **hyperframes add <nome>** para instalar e nunca tratar a consulta como aprovação de código externo.

O Nivoo expõe GET /motion/catalog?query=... nos dois editores. A busca valida um texto em inglês com no máximo 90 caracteres, chama apenas a CLI oficial do servidor com telemetria e auto-instalação de skills desabilitadas, lê o envelope JSON limitado, e retorna até 24 resultados normalizados por resposta. Não instala, baixa nem executa o bloco descoberto.

Na interface, a seção "Explorar catálogo oficial HyperFrames" abre categorias rápidas de transições, tipografia, neon, glitch, partículas e 3D. As descrições e identificadores são mostrados como **referência**, sem botão enganoso para gerar material ainda não validado. Os seis modelos locais revisados permanecem a opção executável nesta branch.

## Próxima fronteira para blocos executáveis

O comando `hyperframes add` importa HTML/JS editável e dependências transitivas. Para usar esses blocos no worker real, ainda é obrigatório manter um manifesto versionado com proveniência e hashes, uma área de execução isolada (acesso à rede bloqueado ou restrito, sem segredos de usuário), revisão das dependências e inspeção audiovisual da saída. Catálogo disponível não equivale a ferramenta instalada nem a efeito aprovado.

Fonte de comando oficial: https://github.com/heygen-com/hyperframes/blob/main/skills/hyperframes-registry/SKILL.md

Nenhuma alteração na main ou instalação atual é feita por este PR.
