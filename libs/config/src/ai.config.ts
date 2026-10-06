import { registerAs } from '@nestjs/config';

/**
 * AI Provider 및 모델 네임스페이스 설정 ('ai')
 */
export const aiConfig = registerAs('ai', () => ({
  gemini: {
    apiKey: process.env.GEMINI_API_KEY || '',
    model: process.env.GEMINI_MODEL || 'gemini-3.8-flash',
    embeddingModel: process.env.GEMINI_EMBEDDING_MODEL || 'text-embedding-004',
  },
  ollama: {
    baseUrl: process.env.OLLAMA_BASE_URL || 'http://localhost:11434',
    model: process.env.OLLAMA_MODEL || 'qwen3.5:0.8b',
    embeddingModel: process.env.OLLAMA_EMBEDDING_MODEL || 'nomic-embed-text',
  },
}));
