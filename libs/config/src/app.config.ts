import { registerAs } from '@nestjs/config';

/**
 * 기본 서버 애플리케이션 네임스페이스 설정 ('app')
 *
 * 사용 예:
 * - @Inject(appConfig.KEY) private readonly config: ConfigType<typeof appConfig>
 * - configService.get<number>('app.port')
 */
export const appConfig = registerAs('app', () => {
  const isLocal = process.env.IS_LOCAL === 'true';
  const defaultLogLevel = isLocal ? 'debug' : 'info';

  const resolveSwaggerEnabled = (): boolean => {
    const rawSwagger = process.env.SWAGGER_ENABLED?.trim().toLowerCase();
    if (rawSwagger === 'true') return true;
    if (rawSwagger === 'false') return false;

    const rawLegacySwagger = process.env.ENABLE_SWAGGER?.trim().toLowerCase();
    if (rawLegacySwagger === 'true') return true;
    if (rawLegacySwagger === 'false') return false;

    return isLocal;
  };

  return {
    port: Number(process.env.PORT) || 3000,
    nodeEnv: process.env.NODE_ENV || 'development',
    isLocal,
    logLevel: process.env.LOG_LEVEL || defaultLogLevel,
    corsOrigins: (process.env.CORS_ORIGINS || process.env.CORS_ORIGIN || '')
      .split(',')
      .map((origin) => origin.trim())
      .filter((origin) => origin.length > 0),
    proxySharedSecret: process.env.AUTH_FORWARDED_SECRET || undefined,
    swaggerEnabled: resolveSwaggerEnabled(),
  };
});
