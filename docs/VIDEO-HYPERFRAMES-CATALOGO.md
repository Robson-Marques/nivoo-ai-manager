# Descoberta do catálogo HyperFrames (modo somente leitura)

A documentação oficial orienta usar **hyperframes catalog --query "<efeito em inglês>" --json** para procurar itens, **hyperframes add <nome>** para instalar e nunca tratar a consulta como aprovação de código externo.

O Nivoo expõe GET /motion/catalog?query=... nos dois editores. A busca valida um texto em inglês com no máximo 90 caracteres, chama apenas a CLI oficial do servidor com telemetria e auto-instalação de skills desabilitadas, lê o envelope JSON limitado, e retorna até 24 resultados normalizados por resposta. Não instala, baixa nem executa o bloco descoberto.

Na interface, a seção "Explorar catálogo oficial HyperFrames" abre categorias rápidas de transições, tipografia, neon, glitch, partículas e 3D. As descrições e identificadores são mostrados como **referência**, sem botão enganoso para gerar material ainda não validado. Os seis modelos locais revisados permanecem a opção executável nesta branch.

## Próxima fronteira para blocos executáveis

O comando `hyperframes add` importa HTML/JS editável e dependências transitivas. Para usar esses blocos no worker real, ainda é obrigatório manter um manifesto versionado com proveniência e hashes, uma área de execução isolada (acesso à rede bloqueado ou restrito, sem segredos de usuário), revisão das dependências e inspeção audiovisual da saída. Catálogo disponível não equivale a ferramenta instalada nem a efeito aprovado.

Fonte de comando oficial: https://github.com/heygen-com/hyperframes/blob/main/skills/hyperframes-registry/SKILL.md

Nenhuma alteração na main ou instalação atual é feita por este PR.

## Próxima etapa implementada: prévias oficiais e fila de curadoria

A consulta retorna `preview.video` e `preview.poster` somente quando a URL corresponde exatamente ao CDN oficial `static.heygen.ai`, em `/hyperframes-oss/docs/images/catalog/(blocks|components)/`, com extensão MP4/PNG. Não há script nem HTML incorporado de terceiros. O usuário inicia o carregamento do vídeo da prévia ao clicar em **Ver prévia original**.

Ao clicar **Solicitar curadoria**, o backend executa novamente a busca `catalog --query --json` e confirma que o identificador aparece no resultado oficial. A solicitação é persistida em `midia/studio/hyperframes-review/<nome>.json`, com `state: needs-review`, `executable: false`, data, nome, tipo e origem. A API de leitura permite reabrir o editor e recuperar a fila; solicitações repetidas não duplicam registros.

APIs em ambos os prefixos do Studio:
- `GET /motion/reviews` lista as solicitações do projeto.
- `POST /motion/reviews` aceita somente `{query,name}`, sem corpo HTML, fonte, caminho, variável de execução nem flag `approved`.

**Critério de segurança:** nenhuma rota transforma `needs-review` em aprovado. Uma curadoria completa exige inspeção do arquivo `registry-item.json`, suas dependências transitivas, lista de arquivos baixados, verificação de integridade e isolamento comprovado antes de qualquer execução. O vídeo oficial é uma prévia de referência, não evidência de que o código já esteja seguro para renderizar no servidor.

## Validação

Os testes `video-hyperframes-curation.spec.ts` cobrem sanitização de URLs, isolamento de projeto, deduplicação, persistência e rejeição de registros manipulados. A execução dos testes, build e smoke test real ainda depende de CI/ambiente com dependências; não deve ser reportada como aprovada sem evidência.
