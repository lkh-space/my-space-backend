import { Injectable } from '@nestjs/common';
import { GeminiProvider } from './gemini.provider.js';
import { OllamaProvider } from './ollama.provider.js';
import type { LlmProvider, EmbeddingProvider } from './llm.provider.interface.js';

@Injectable()
export class ProviderFactory {
  constructor(
    private readonly geminiProvider: GeminiProvider,
    private readonly ollamaProvider: OllamaProvider,
  ) {}

  getLlmProvider(providerName?: string): LlmProvider {
    if (providerName?.toLowerCase() === 'ollama') {
      return this.ollamaProvider;
    }
    // 기본은 Gemini
    return this.geminiProvider;
  }

  getEmbeddingProvider(providerName?: string): EmbeddingProvider {
    if (providerName?.toLowerCase() === 'ollama') {
      return this.ollamaProvider;
    }
    return this.geminiProvider;
  }
}
