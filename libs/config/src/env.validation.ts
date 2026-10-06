import { z } from 'zod';

/**
 * 환경변수 유효성 검증을 위한 Zod 스키마
 */
export const envSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  NODE_ENV: z
    .enum(['development', 'production', 'test'])
    .default('development'),
  IS_LOCAL: z
    .string()
    .optional()
    .transform((val) => val === 'true'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).optional(),
  CORS_ORIGIN: z.string().optional(),

  // Database (PostgreSQL)
  DATABASE_URL: z.string().optional(),
  DATABASE_HOST: z.string().optional(),
  DATABASE_PORT: z.coerce.number().int().optional(),
  DATABASE_USER: z.string().optional(),
  DATABASE_PASSWORD: z.string().optional(),
  DATABASE_NAME: z.string().optional(),

  // MinIO
  MINIO_ENDPOINT: z.string().optional(),
  MINIO_PORT: z.coerce.number().int().optional(),
  MINIO_USE_SSL: z
    .string()
    .optional()
    .transform((val) => val === 'true'),
  MINIO_ACCESS_KEY: z.string().optional(),
  MINIO_SECRET_KEY: z.string().optional(),
  MINIO_BUCKET_DOCS: z.string().default('my-space-markdown'),
  MINIO_BUCKET_ASSETS: z.string().default('my-space-assets'),
  MINIO_REGION: z.string().default('us-east-1'),
  MINIO_FORCE_PATH_STYLE: z
    .string()
    .optional()
    .transform((val) => val !== 'false'),

  // OpenSearch
  OPENSEARCH_NODE: z.string().optional(),
  OPENSEARCH_USERNAME: z.string().optional(),
  OPENSEARCH_PASSWORD: z.string().optional(),
  OPENSEARCH_REJECT_UNAUTHORIZED: z
    .string()
    .optional()
    .transform((val) => val === 'true'),
  OPENSEARCH_INDEX_DOCS: z.string().default('markdown-documents'),

  // Google Gemini
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().default('gemini-3.8-flash'),
  GEMINI_EMBEDDING_MODEL: z.string().default('text-embedding-004'),

  // Ollama
  OLLAMA_BASE_URL: z.string().default('http://localhost:11434'),
  OLLAMA_MODEL: z.string().default('qwen3.5:0.8b'),
  OLLAMA_EMBEDDING_MODEL: z.string().default('nomic-embed-text'),

  // Qdrant
  QDRANT_URL: z.string().default('http://localhost:6333'),
  QDRANT_API_KEY: z.string().optional(),
  QDRANT_COLLECTION: z.string().default('personal-documents'),

  // RabbitMQ
  RABBITMQ_URL: z.string().optional(),
  RABBITMQ_INDEXING_QUEUE: z.string().default('markdown-indexing-queue'),
});

export type EnvConfig = z.infer<typeof envSchema>;

/**
 * ConfigModule.forRoot()의 validate 옵션에 전달되는 검증 함수
 * 올바르지 않은 환경변수 주입 시 명확한 에러를 발생시키며 앱 기동을 중단합니다 (Fail-fast).
 */
export function validateEnv(config: Record<string, unknown>): EnvConfig {
  const result = envSchema.safeParse(config);

  if (!result.success) {
    const errorMessages = result.error.issues
      .map((issue) => `[${issue.path.join('.')}] ${issue.message}`)
      .join('; ');
    throw new Error(
      `환경변수 검증 실패 (Invalid Environment Variables): ${errorMessages}`,
    );
  }

  return result.data;
}
