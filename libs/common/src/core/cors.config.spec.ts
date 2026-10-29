import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Logger } from 'nestjs-pino';
import {
  setupCors,
  DEFAULT_CORS_METHODS,
  DEFAULT_CORS_ALLOWED_HEADERS,
} from './cors.config.js';

describe('공통 CORS 설정 함수 (setupCors 단위 테스트)', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  it('환경변수(app.corsOrigins)가 설정된 경우 중복을 제거한 화이트리스트로 app.enableCors를 호출해야 한다', () => {
    // given
    const enableCorsSpy = vi.fn();
    const mockApp = {
      get: vi.fn().mockImplementation((token: unknown) => {
        if (token === ConfigService) {
          return {
            get: vi.fn((key: string) => {
              if (key === 'app.corsOrigins') {
                return [
                  'https://app.myspace.local',
                  'http://localhost:5173',
                  'https://app.myspace.local',
                ];
              }
              return undefined;
            }),
          };
        }
        return undefined;
      }),
      enableCors: enableCorsSpy,
    } as unknown as INestApplication;

    // when
    const allowedOrigins = setupCors(mockApp);

    // then
    expect(allowedOrigins).toEqual([
      'https://app.myspace.local',
      'http://localhost:5173',
    ]);
    expect(enableCorsSpy).toHaveBeenCalledWith({
      origin: ['https://app.myspace.local', 'http://localhost:5173'],
      methods: DEFAULT_CORS_METHODS,
      credentials: true,
      allowedHeaders: DEFAULT_CORS_ALLOWED_HEADERS,
    });
  });

  it('CORS_ORIGINS가 미설정된 경우 하드코딩된 폴백 없이 빈 배열([])로 차단(Fail-Closed)하고 경고 로그를 남겨야 한다', () => {
    // given
    delete process.env.CORS_ORIGINS;
    delete process.env.CORS_ORIGIN;

    const enableCorsSpy = vi.fn();
    const warnSpy = vi.fn();

    const mockApp = {
      get: vi.fn().mockImplementation((token: unknown) => {
        if (token === ConfigService) {
          return {
            get: vi.fn((key: string) => {
              if (key === 'app.corsOrigins') return [];
              return undefined;
            }),
          };
        }
        if (token === Logger) {
          return { warn: warnSpy };
        }
        return undefined;
      }),
      enableCors: enableCorsSpy,
    } as unknown as INestApplication;

    // when
    const allowedOrigins = setupCors(mockApp);

    // then
    expect(allowedOrigins).toEqual([]);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('CORS_ORIGINS 환경변수가 설정되지 않아'),
      'Bootstrap',
    );
    expect(enableCorsSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        origin: [],
      }),
    );
  });

  it('서버별 customOptions가 전달되면 기본 옵션을 오버라이드하여 적용해야 한다', () => {
    // given
    const enableCorsSpy = vi.fn();
    const mockApp = {
      get: vi.fn().mockReturnValue(undefined),
      enableCors: enableCorsSpy,
    } as unknown as INestApplication;

    // when
    const allowedOrigins = setupCors(mockApp, {
      origin: ['https://ai-only.myspace.local'],
      methods: 'GET,POST',
    });

    // then
    expect(allowedOrigins).toEqual(['https://ai-only.myspace.local']);
    expect(enableCorsSpy).toHaveBeenCalledWith({
      origin: ['https://ai-only.myspace.local'],
      methods: 'GET,POST',
      credentials: true,
      allowedHeaders: DEFAULT_CORS_ALLOWED_HEADERS,
    });
  });
});
