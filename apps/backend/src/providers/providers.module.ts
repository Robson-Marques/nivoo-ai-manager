import { Global, Module } from '@nestjs/common';
import { ClaudeCodeCliProvider } from './claude-code-cli.provider';
import { CodexCliProvider } from './codex-cli.provider';
import { GeminiCliProvider } from './gemini-cli.provider';
import { LocalShellProvider } from './local-shell.provider';
import { ProviderRegistry } from './provider-registry.service';

@Global()
@Module({
  providers: [ClaudeCodeCliProvider, CodexCliProvider, GeminiCliProvider, LocalShellProvider, ProviderRegistry],
  exports: [ProviderRegistry],
})
export class ProvidersModule {}
