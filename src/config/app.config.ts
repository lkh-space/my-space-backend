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

  return {
    port: Number(process.env.PORT) || 3000,
    nodeEnv: process.env.NODE_ENV || 'development',
    isLocal,
    logLevel: process.env.LOG_LEVEL || defaultLogLevel,
    corsOrigins: (process.env.CORS_ORIGIN || '')
      .split(',')
      .map((origin) => origin.trim())
      .filter((origin) => origin.length > 0),
  };
});
