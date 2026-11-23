# Integrações de IA gratuita — referência Free Claude Code (novembro/2026)

Fonte consultada: https://github.com/Alishahryar1/free-claude-code/blob/main/README.md

O Free Claude Code anuncia dezenas de **provedores**, mas a lista NÃO equivale a dezenas
de modelos grátis garantidos. Mistura APIs pagas, serviços OAuth/assinatura,
créditos temporários, download/local e planos free com cotas. Seu código é AGPL-3.0-only:
este módulo Nivoo foi escrito de modo independente, usando somente endpoints e
informações públicas dos provedores, sem copiar seu código.

## Integrado diretamente ao Studio Workflow (sem instalar gateway FCC)

| Provedor | ID da conexão | Proteção de custo | Autenticação | Modelos |
| --- | --- | --- | --- | --- |
| NVIDIA NIM | `nvidia-api` | Cotas de avaliação; autorização variável | chave NVIDIA | somente agentes compatíveis com ferramentas retornados pela conta |
| OpenRouter Free | `openrouter-free-api` | **Bloqueia qualquer modelo que não seja `openrouter/free` ou termine em `:free`** | chave OpenRouter | descoberta dinâmica e filtragem por `tools` quando informada pela API |
| GroqCloud Free | `groq-free-api` | Depende da conta estar no **plano Free**; não usar chave de plano pago se quiser custo zero | chave GroqCloud | descoberta dinâmica de modelos de texto |
| Gemini API | `gemini-api` | depende do plano/modelo/cota da conta Google | chave Gemini | CLI/API existente no Nivoo |

Observação: a conexão GroqCloud NÃO consegue provar se a organização foi migrada para
um plano pago. O usuário deve verificar seu plano antes de conectar. Listar um modelo
pela API não assegura que ele esteja habilitado para tools ou dentro da cota diária.

### Como usar

1. Conexões → Nova conexão → OpenRouter Free ou GroqCloud.
2. Cole a chave oficial do provedor. O Nivoo armazena-a no cofre local do servidor,
   não no código nem nos prompts enviados a outros modelos.
3. Abra o projeto → Studio Workflow → selecione a conexão e um modelo do catálogo
   retornado pela API. A IA executa a mesma lista restrita de ferramentas de arquivo
   usada no conector NVIDIA; não recebe terminal/credenciais.
4. Erros de cota 429/503 são reportados como indisponibilidade, para que o
   orquestrador existente recupere/continue sem inventar resultados.

O envio de tarefas inclui partes do código e contexto do projeto ao provedor de
IA escolhido. Não conecte projetos com conteúdo sensível sem revisar suas políticas
de dados e retenção.

## Provedores identificados no Free Claude Code, mas NÃO classificados como grátis sem análise

- **Cloudflare Workers AI:** possui 10.000 Neurons/dia inclusos, porém alguns modelos
  passaram a exigir Workers Paid em julho/2026; requer token e account ID. Próximo
  candidato para integração com medição de cota.
- **Cerebras:** oferta atual de créditos de teste/avaliação; não presumir uma cota
  gratuitamente renovável.
- **SambaNova:** fontes oficiais de planos e documentação de rate limits divergem
  sobre necessidade de pagamento. Sem confirmar no cadastro real, não marcar grátis.
- **Kilo.ai / `kilo-auto/free`, ZenMux, TokenRouter, NaraRoute, OrcaRouter, xKiro:**
  nomes/IDs com indicação de gratuidade no catálogo FCC não provam uso gratuito,
  estabilidade, privacidade, limites ou permissão de automação.
- **Hugging Face, W&B, Together, DeepInfra, SiliconFlow, Nebius, Mistral, DeepSeek,
  Kimi e outros:** planos promocionais ou cobrados, dependem do usuário e da região.
- **Anthropic API / OpenAI API / modelos pagos do OpenRouter:** NÃO são grátis.
- **Ollama, llama.cpp, LM Studio:** modelos locais podem ser livres, mas requerem
  recursos próprios; o servidor POCOU não dispõe de GPU.

Referências principais:
- https://openrouter.ai/collections/free-models
- https://openrouter.ai/pricing
- https://console.groq.com/docs/rate-limits
- https://console.groq.com/docs/tool-use/overview
- https://developers.cloudflare.com/workers-ai/platform/pricing/
- https://www.cerebras.ai/pricing
- https://cloud.sambanova.ai/plans

**Princípio de produto:** não criar catálogo enorme na tela nem marcar modelo como
"disponível" só porque aparece no GitHub FCC. Novos conectores entram somente
quando houver API confiável, autenticação testável, limite documentado e executor
compatível com o Nivoo.
