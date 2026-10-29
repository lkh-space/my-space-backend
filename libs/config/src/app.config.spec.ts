import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { appConfig } from './app.config.js';

describe('appConfig (CORS 설정 단위 테스트)', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('CORS_ORIGINS에 쉼표로 구분된 도메인이 주어지면 trim된 배열로 파싱해야 한다', () => {
    // given
    process.env.CORS_ORIGINS = 'http://localhost:5173, https://app.example.com , http://localhost:3000';

    // when
    const config = appConfig();

    // then
    expect(config.corsOrigins).toEqual([
      'http://localhost:5173',
      'https://app.example.com',
      'http://localhost:3000',
    ]);
  });

  it('CORS_ORIGINS가 비어있을 때는 빈 배열을 반환해야 한다', () => {
    // given
    delete process.env.CORS_ORIGINS;
    delete process.env.CORS_ORIGIN;

    // when
    const config = appConfig();

    // then
    expect(config.corsOrigins).toEqual([]);
  });

  it('CORS_ORIGINS가 없고 기존 CORS_ORIGIN이 있을 때도 하위 호환성을 유지해야 한다', () => {
    // given
    delete process.env.CORS_ORIGINS;
    process.env.CORS_ORIGIN = 'https://legacy.example.com';

    // when
    const config = appConfig();

    // then
    expect(config.corsOrigins).toEqual(['https://legacy.example.com']);
  });

  describe('Swagger 활성화 (swaggerEnabled) 우선순위 및 불리언 파싱', () => {
    it('SWAGGER_ENABLED=true 설정 시 swaggerEnabled는 true여야 한다', () => {
      // given
      process.env.SWAGGER_ENABLED = 'true';
      delete process.env.ENABLE_SWAGGER;
      delete process.env.IS_LOCAL;

      // when
      const config = appConfig();

      // then
      expect(config.swaggerEnabled).toBe(true);
    });

    it('SWAGGER_ENABLED=false 설정 시 IS_LOCAL=true여도 swaggerEnabled는 false여야 한다 (문자열 "false"의 안전한 평가)', () => {
      // given
      process.env.SWAGGER_ENABLED = 'false';
      process.env.IS_LOCAL = 'true';

      // when
      const config = appConfig();

      // then
      expect(config.swaggerEnabled).toBe(false);
    });

    it('SWAGGER_ENABLED가 없을 때 레거시 ENABLE_SWAGGER=true를 하위 호환해야 한다', () => {
      // given
      delete process.env.SWAGGER_ENABLED;
      process.env.ENABLE_SWAGGER = 'true';
      delete process.env.IS_LOCAL;

      // when
      const config = appConfig();

      // then
      expect(config.swaggerEnabled).toBe(true);
    });

    it('SWAGGER_ENABLED 및 ENABLE_SWAGGER가 모두 없을 때 IS_LOCAL=true이면 swaggerEnabled는 true여야 한다', () => {
      // given
      delete process.env.SWAGGER_ENABLED;
      delete process.env.ENABLE_SWAGGER;
      process.env.IS_LOCAL = 'true';

      // when
      const config = appConfig();

      // then
      expect(config.swaggerEnabled).toBe(true);
    });

    it('모든 Swagger/Local 플래그가 없을 때 swaggerEnabled는 기본값 false여야 한다', () => {
      // given
      delete process.env.SWAGGER_ENABLED;
      delete process.env.ENABLE_SWAGGER;
      delete process.env.IS_LOCAL;

      // when
      const config = appConfig();

      // then
      expect(config.swaggerEnabled).toBe(false);
    });
  });
});
