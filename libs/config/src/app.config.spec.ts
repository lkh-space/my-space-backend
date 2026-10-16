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
});
