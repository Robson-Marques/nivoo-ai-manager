import { Global, Module } from '@nestjs/common';
import { ClaudeCodeCliProvider } from './claude-code-cli.provider';
import { CodexCliProvider } from './codex-cli.provider';
import { AnthropicApiProvider, OpenAiApiProvider } from './http-api.providers';
import { LocalShellProvider } from './local-shell.provider';
import { ProviderRegistry } from './provider-registry.service';

@Global()
@Module({
  providers: [ClaudeCodeCliProvider, CodexCliProvider, AnthropicApiProvider, OpenAiApiProvider, LocalShellProvider, ProviderRegistry],
  exports: [ProviderRegistry],
})
export class ProvidersModule {}
