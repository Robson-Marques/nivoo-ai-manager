import { Global, Module } from '@nestjs/common';
import { ClaudeApiProvider, ClaudeCodeCliProvider } from './claude-code-cli.provider';
import { CodexApiProvider, CodexCliProvider } from './codex-cli.provider';
import { GeminiApiProvider } from './gemini-api.provider';
import { ArquivosProjetoProvider } from './arquivos-projeto.provider';
import { GeminiVideoProvider } from './gemini-video.provider';
import { JuntarVideosProvider } from './juntar-videos.provider';
import { LocalShellProvider } from './local-shell.provider';
import { ModelCatalogService } from './model-catalog.service';
import { ProviderRegistry } from './provider-registry.service';

@Global()
@Module({
  providers: [ClaudeCodeCliProvider, ClaudeApiProvider, CodexCliProvider, CodexApiProvider, GeminiApiProvider, GeminiVideoProvider, JuntarVideosProvider, ArquivosProjetoProvider, LocalShellProvider, ProviderRegistry, ModelCatalogService],
  exports: [ProviderRegistry, ModelCatalogService, GeminiVideoProvider],
})
export class ProvidersModule {}
