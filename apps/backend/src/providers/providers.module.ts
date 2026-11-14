import { Global, Module } from '@nestjs/common';
import { ClaudeApiProvider, ClaudeCodeCliProvider } from './claude-code-cli.provider';
import { CodexApiProvider, CodexCliProvider } from './codex-cli.provider';
import { GeminiApiProvider, GeminiCliProvider } from './gemini-cli.provider';
import { LocalShellProvider } from './local-shell.provider';
import { ProviderRegistry } from './provider-registry.service';

@Global()
@Module({
  providers: [ClaudeCodeCliProvider, ClaudeApiProvider, CodexCliProvider, CodexApiProvider, GeminiCliProvider, GeminiApiProvider, LocalShellProvider, ProviderRegistry],
  exports: [ProviderRegistry],
})
export class ProvidersModule {}
