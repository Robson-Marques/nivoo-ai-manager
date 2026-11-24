import { Global, Module } from '@nestjs/common';
import { ClaudeApiProvider, ClaudeCodeCliProvider } from './claude-code-cli.provider';
import { CodexApiProvider, CodexCliProvider } from './codex-cli.provider';
import { GeminiApiProvider } from './gemini-api.provider';
import { NvidiaApiProvider } from './nvidia-api.provider';
import { GroqFreeProvider, OpenRouterFreeProvider } from './free-cloud-api.provider';
import { NvidiaMediaProvider } from './nvidia-media.provider';
import { NvidiaSpecializedService } from './nvidia-specialized.service';
import { ArquivosProjetoProvider } from './arquivos-projeto.provider';
import { GeminiImageProvider } from './gemini-image.provider';
import { GeminiVideoProvider } from './gemini-video.provider';
import { JuntarVideosProvider } from './juntar-videos.provider';
import { GerarNarracaoProvider } from './gerar-narracao.provider';
import { LocalShellProvider } from './local-shell.provider';
import { ModelCatalogService } from './model-catalog.service';
import { ProviderRegistry } from './provider-registry.service';
import { KokoroTtsService } from './kokoro-tts.service';

@Global()
@Module({
  providers: [ClaudeCodeCliProvider, ClaudeApiProvider, CodexCliProvider, CodexApiProvider, GeminiApiProvider, NvidiaApiProvider, OpenRouterFreeProvider, GroqFreeProvider, NvidiaSpecializedService, NvidiaMediaProvider, GeminiVideoProvider, GeminiImageProvider, KokoroTtsService, JuntarVideosProvider, GerarNarracaoProvider, ArquivosProjetoProvider, LocalShellProvider, ProviderRegistry, ModelCatalogService],
  exports: [ProviderRegistry, ModelCatalogService, NvidiaSpecializedService, GeminiVideoProvider, KokoroTtsService],
})
export class ProvidersModule {}
