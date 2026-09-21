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
