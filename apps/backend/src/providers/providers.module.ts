import { Global, Module } from '@nestjs/common';
import { ClaudeApiProvider, ClaudeCodeCliProvider } from './claude-code-cli.provider';
import { CodexApiProvider, CodexCliProvider } from './codex-cli.provider';
import { GeminiApiProvider } from './gemini-api.provider';
import { ArquivosProjetoProvider } from './arquivos-projeto.provider';
import { GeminiVideoProvider } from './gemini-video.provider';
import { JuntarVideosProvider } from './juntar-videos.provider';
import { GerarNarracaoProvider } from './gerar-narracao.provider';
import { LocalShellProvider } from './local-shell.provider';
import { ModelCatalogService } from './model-catalog.service';
import { ProviderRegistry } from './provider-registry.service';
import { KokoroTtsService } from './kokoro-tts.service';

@Global()
@Module({
  providers: [ClaudeCodeCliProvider, ClaudeApiProvider, CodexCliProvider, CodexApiProvider, GeminiApiProvider, GeminiVideoProvider, KokoroTtsService, JuntarVideosProvider, GerarNarracaoProvider, ArquivosProjetoProvider, LocalShellProvider, ProviderRegistry, ModelCatalogService],
  exports: [ProviderRegistry, ModelCatalogService, GeminiVideoProvider, KokoroTtsService],
})
export class ProvidersModule {}
