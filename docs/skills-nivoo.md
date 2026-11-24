# Skills Nivoo — primeira implantação

Banco interno versionado e integrado ao planejador e ao contexto do executor. As competências são selecionadas pela solicitação atual ou pela etapa atual; executores determinísticos não recebem prompt. As orientações detalhadas ficam em contexto/skills-nivoo/<id>/SKILL.md, no diretório descartável da sessão. O backend não instala scripts, hooks, modelos, pacotes ou APIs externas. Não é uma instalação nativa de skills no CODEX_HOME ou Claude Code.

Retomada usa dados do banco, worktree, checkpoints e notas existentes. contexto/estado-etapa.md é uma projeção por sessão, não uma nova memória autoritativa. O histórico exclui a tentativa corrente. O registro do prompt e dos logs permite avaliar seleção e consumo; não há redução medida ainda.

## Referências

Orientações originais do Nivoo inspiradas em NVIDIA Agent Skills (Apache-2.0 nos cabeçalhos consultados), versão 71e61c7209cb4ca64cba247a7d20a5438b30aef5, NVIDIA Corporation e colaboradores:
- https://github.com/NVIDIA/skills/tree/71e61c7209cb4ca64cba247a7d20a5438b30aef5/skills/nemo-rl-session-memory
- https://github.com/NVIDIA/skills/tree/71e61c7209cb4ca64cba247a7d20a5438b30aef5/skills/tao-token-efficient-execution
- https://github.com/NVIDIA/skills/tree/71e61c7209cb4ca64cba247a7d20a5438b30aef5/skills/nemo-relay-debug-runtime-integration

Não importamos código ou scripts upstream. O catálogo completo continua externo. As competências de arte, motion, locução e código são próprias, adequadas aos contratos Nivoo. Não prometemos os resultados de benchmarks TAO para o Nivoo. APIs de trial não são autorizadas para produção por esta mudança.

## Implantação por frentes

1. Catálogo, seleção por etapa, materialização protegida, metadados e logs (esta versão).
2. Continuidade: estado real, checkpoints, notas, recuperação e contexto de trabalho.
3. Código e arquivos: contratos de ferramentas, leitura, escrita e edição, binários, publicação, isolamento.
4. Ferramentas e executores: parâmetros reais, dependências, roteamento, responsabilidades.
5. Diagnóstico e recuperação: causa comprovada, evitar repetir falhas, preservar resultado.
6. Contexto e tokens: carregar apenas instruções necessárias, medir por tipo de etapa; não multiplicar sessões.
7. Mídia: autoria, geração visual, Motion, áudio e entrega, com motores existentes.
8. Integração: compatibilidade dos provedores, testes focados e atualização pelo fluxo normal do servidor.

Cada frente é uma alteração verificável no mesmo branch. Não abrir CI/PR adicional ou instalar novas APIs. Não confundir seleção de skills com suporte nativo de uma ferramenta; a skill não concede recursos ou permissões. A frente 1 inclui a orientação inicial de arquivos; a auditoria da implementação de gravação vem na frente 3. Nenhuma economia de tokens ou qualidade artística foi medida ainda.
