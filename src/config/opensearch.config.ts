import { registerAs } from '@nestjs/config';

/**
 * OpenSearch 검색 엔진 네임스페이스 설정 ('opensearch')
 */
export const opensearchConfig = registerAs('opensearch', () => ({
  node: process.env.OPENSEARCH_NODE || 'http://localhost:9200',
  username: process.env.OPENSEARCH_USERNAME || '',
  password: process.env.OPENSEARCH_PASSWORD || '',
  rejectUnauthorized: process.env.OPENSEARCH_REJECT_UNAUTHORIZED === 'true',
  indexDocuments: process.env.OPENSEARCH_INDEX_DOCS || 'markdown-documents',
}));
