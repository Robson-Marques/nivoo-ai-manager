import { Injectable } from '@nestjs/common';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  AiProvider,
  buildPrompt,
  ExecutionRequest,
  ExecutionResult,
  looksLikeResourceProblem,
  ProviderStatus,
} from './provider.interface';

/** Base para conectores de API opcionais: geram texto e o gravam como artefato em NIVOO_OUTPUT_DIR. */
abstract class HttpApiProvider implements AiProvider {
  abstract readonly id: string;
  abstract readonly label: string;
  readonly kind = 'api' as const;
  protected abstract readonly keyEnv: string;
  protected abstract readonly model: string;
  protected abstract call(prompt: string, signal: AbortSignal): Promise<{ status: number; body: any }>;
  protected abstract extract(body: any): { text: string; inputTokens?: number; outputTokens?: number };

  async checkAvailability(): Promise<ProviderStatus> {
    const hasKey = !!process.env[this.keyEnv];
    return {
      id: this.id,
      label: this.label,
      kind: this.kind,
      available: hasKey,
      installed: true,
      authenticated: hasKey ? 'desconhecido' : false,
      version: this.model,
      limits: { observacao: 'limites de taxa/orçamento da organização na API; erros 429/529 causam reagendamento' },
      capabilities: ['gerar-texto', 'analise', 'sem-acesso-a-arquivos'],
      errors: hasKey ? [] : [`${this.keyEnv} não configurada (opcional)`],
      checkedAt: new Date().toISOString(),
      isAi: true,
    };
  }

  async execute(req: ExecutionRequest): Promise<ExecutionResult> {
    if (!process.env[this.keyEnv]) {
      return { exitCode: 1, output: '', error: `${this.keyEnv} ausente`, resourceUnavailable: true };
    }
    const timeout = AbortSignal.timeout(req.timeoutMs);
    const signal = AbortSignal.any([req.signal, timeout]);
    try {
      req.onLog(`${this.id}: chamando modelo ${this.model}`);
      const { status, body } = await this.call(buildPrompt(req), signal);
      if (status >= 400) {
        const msg = `HTTP ${status}: ${JSON.stringify(body).slice(0, 500)}`;
        return { exitCode: 1, output: '', error: msg, resourceUnavailable: status === 429 || status >= 500 || looksLikeResourceProblem(msg) };
      }
      const { text, inputTokens, outputTokens } = this.extract(body);
      const file = path.join(req.outputDir, `${req.stepId}.${this.id}.md`);
      fs.mkdirSync(req.outputDir, { recursive: true });
      fs.writeFileSync(file, text);
      req.onLog(text.slice(0, 4000));
      return { exitCode: 0, output: text, inputTokens, outputTokens };
    } catch (e: any) {
      if (req.signal.aborted) return { exitCode: -1, output: '', interrupted: true, error: 'interrompido' };
      return { exitCode: -1, output: '', error: String(e?.message ?? e), resourceUnavailable: true };
    }
  }
}

@Injectable()
export class AnthropicApiProvider extends HttpApiProvider {
  readonly id = 'anthropic-api';
  readonly label = 'Anthropic API (opcional)';
  protected readonly keyEnv = 'ANTHROPIC_API_KEY';
  protected readonly model = process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-5-5';

  protected async call(prompt: string, signal: AbortSignal) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal,
      headers: {
        'content-type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY!,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({ model: this.model, max_tokens: 8000, messages: [{ role: 'user', content: prompt }] }),
    });
    return { status: res.status, body: await res.json().catch(() => ({})) };
  }

  protected extract(body: any) {
    const text = (body.content ?? []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n');
    return { text, inputTokens: body.usage?.input_tokens, outputTokens: body.usage?.output_tokens };
  }
}

@Injectable()
export class OpenAiApiProvider extends HttpApiProvider {
  readonly id = 'openai-api';
  readonly label = 'OpenAI API (opcional)';
  protected readonly keyEnv = 'OPENAI_API_KEY';
  protected readonly model = process.env.OPENAI_MODEL ?? 'gpt-5';

  protected async call(prompt: string, signal: AbortSignal) {
    const res = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      signal,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: JSON.stringify({ model: this.model, input: prompt }),
    });
    return { status: res.status, body: await res.json().catch(() => ({})) };
  }

  protected extract(body: any) {
    let text = body.output_text ?? '';
    if (!text && Array.isArray(body.output)) {
      text = body.output
        .flatMap((o: any) => o.content ?? [])
        .filter((c: any) => c.type === 'output_text')
        .map((c: any) => c.text)
        .join('\n');
    }
    return { text, inputTokens: body.usage?.input_tokens, outputTokens: body.usage?.output_tokens };
  }
}
