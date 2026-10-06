import { registerAs } from '@nestjs/config';

/**
 * Qdrant 벡터 데이터베이스 네임스페이스 설정 ('qdrant')
 */
export const qdrantConfig = registerAs('qdrant', () => ({
  url: process.env.QDRANT_URL || 'http://localhost:6333',
  apiKey: process.env.QDRANT_API_KEY || '',
  collection: process.env.QDRANT_COLLECTION || 'personal-documents',
}));
