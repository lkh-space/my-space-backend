import type { INestApplication } from '@nestjs/common';
import type { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface.js';
import { ConfigService } from '@nestjs/config';
import { Logger } from 'nestjs-pino';

export const DEFAULT_CORS_METHODS = 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS';
export const DEFAULT_CORS_ALLOWED_HEADERS =
  'Content-Type, Accept, Authorization, X-Requested-With';

export type SetupCorsOptions = Partial<CorsOptions>;

/**
 * 모노레포 공통 CORS(교차 출처 리소스 공유) 보안 정책 초기화
 *
 * - 도메인 하드코딩을 배제하고 각 애플리케이션 환경변수(CORS_ORIGINS / app.corsOrigins)로부터 화이트리스트를 주입받음
 * - 애플리케이션별 커스텀 옵션(customOptions) 오버라이드 지원
 * - 브라우저 요청 헤더에서 Remote-* 프록시 인증 헤더 배제 (BR-A06 준수)
 * - CORS_ORIGINS 미설정 시 빈 배열([])로 Fail-Closed 차단 및 경고 로깅
 *
 * @param app NestJS 애플리케이션 인스턴스
 * @param customOptions 서버별 커스텀 CORS 옵션 오버라이드 (선택)
 * @returns 최종 적용된 허용 Origin 화이트리스트 배열
 */
export function setupCors(
  app: INestApplication,
  customOptions?: SetupCorsOptions,
): string[] {
  const configService = app.get(ConfigService, { strict: false });
  const logger = app.get(Logger, { strict: false });

  const namespaceOrigins = configService?.get<string[]>('app.corsOrigins');
  const rawCorsOrigins =
    configService?.get<string>('CORS_ORIGINS') ??
    configService?.get<string>('CORS_ORIGIN') ??
    process.env.CORS_ORIGINS ??
    process.env.CORS_ORIGIN;

  const configuredOrigins = Array.isArray(customOptions?.origin)
    ? (customOptions.origin as string[])
    : namespaceOrigins && namespaceOrigins.length > 0
      ? namespaceOrigins
      : rawCorsOrigins
        ? rawCorsOrigins
            .split(',')
            .map((origin) => origin.trim())
            .filter((origin) => origin.length > 0)
        : [];

  const allowedOrigins = Array.from(new Set(configuredOrigins));

  if (allowedOrigins.length === 0 && !customOptions?.origin) {
    logger?.warn(
      'CORS_ORIGINS 환경변수가 설정되지 않아 교차 출처(CORS) 요청이 모두 차단됩니다.',
      'Bootstrap',
    );
  }

  app.enableCors({
    methods: DEFAULT_CORS_METHODS,
    credentials: true,
    allowedHeaders: DEFAULT_CORS_ALLOWED_HEADERS,
    ...customOptions,
    origin: customOptions?.origin && !Array.isArray(customOptions.origin)
      ? customOptions.origin
      : allowedOrigins,
  });

  return allowedOrigins;
}
