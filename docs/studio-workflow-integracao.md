# Studio Workflow no Nivoo — restauração
Os 19 documentos em apps/backend/modelos-prontos/studio-workflow são os blobs exatos do commit c6f13779fe7eec8d211f5efde3faf9c03150fda2, anterior à remoção. Não são o repositório STUDIO-UX, nem um novo workflow de execução. O método é uma base selecionável ao lado da base Software nativa. Áreas efetivamente aposentadas são reativadas, com suas associações de projetos e histórico intactos; a migração restaura a regra anterior somente quando a regra de aposentadoria ainda é a vigente. Edições posteriores são preservadas. O seed repõe materiais faltantes, sem sobrescrever os existentes.

O planejador aplica o alinhamento pré-gate e não injeta orientações executoras de Skills nessa fase. Na execução aprovada, o contexto e seleção de Skills já existentes continuam funcionando. Não criar novo executor, fila, revisão, CI ou etapa genérica de teste. Os critérios e comandos usam o mecanismo de conclusão já existente. A metodologia distingue validação mínima de slice e aceitação integrada, não prova automaticamente que um software atende a um contrato.

Projetos na base Geral ou Software nativa não são movidos automaticamente. Para usar o método em um projeto existente, selecione a base Software — Studio Workflow em seus ajustes. Não se modifica o projeto de teste, o renderer nem o design system neste trabalho.

Validação: verificar a instalação da base, contexto real de um projeto e um plano de software com Capability relevante, execução, evidência de integração e aceite. Testes adicionados; resultado no POCOU ainda precisa ser comprovado.
