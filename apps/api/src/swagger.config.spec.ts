import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SwaggerModule } from '@nestjs/swagger';
import { VersionService } from '@app/common';
import { setupSwagger } from './swagger.config.js';

describe('API Swagger 설정 함수 (setupSwagger 단위 테스트)', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  it('Swagger가 비활성화된 경우(swaggerEnabled: false), 문서를 초기화하지 않고 false를 반환해야 한다', () => {
    // given
    process.env.SWAGGER_ENABLED = 'false';
    process.env.ENABLE_SWAGGER = 'false';
    process.env.IS_LOCAL = 'false';

    const mockApp = {
      get: vi.fn().mockImplementation((token: unknown) => {
        if (token === ConfigService) {
          return {
            get: vi.fn((key: string) => {
              if (key === 'app.swaggerEnabled') return false;
              return undefined;
            }),
          };
        }
        return undefined;
      }),
    } as unknown as INestApplication;

    const createDocumentSpy = vi.spyOn(SwaggerModule, 'createDocument');
    const setupSpy = vi.spyOn(SwaggerModule, 'setup');

    // when
    const result = setupSwagger(mockApp);

    // then
    expect(result).toBe(false);
    expect(createDocumentSpy).not.toHaveBeenCalled();
    expect(setupSpy).not.toHaveBeenCalled();
  });

  it('Swagger가 활성화된 경우, 올바른 메타데이터와 옵션으로 SwaggerModule.setup을 호출하고 true를 반환해야 한다', () => {
    // given
    process.env.SWAGGER_ENABLED = 'true';

    const mockVersionService = {
      getVersionInfo: vi.fn().mockReturnValue({
        name: '@my-space/api',
        version: '0.1.0',
        gitBranch: 'main',
        gitCommit: 'abcdef1',
        env: 'development',
      }),
    };

    const mockApp = {
      get: vi.fn().mockImplementation((token: unknown) => {
        if (token === ConfigService) {
          return {
            get: vi.fn((key: string) => {
              if (key === 'app.swaggerEnabled') return true;
              return undefined;
            }),
          };
        }
        if (token === VersionService) {
          return mockVersionService;
        }
        return undefined;
      }),
    } as unknown as INestApplication;

    const dummyDocument = { openapi: '3.0.0', info: { title: 'dummy' }, paths: {} };
    const createDocumentSpy = vi
      .spyOn(SwaggerModule, 'createDocument')
      // @ts-expect-error Mocking OpenAPIObject
      .mockReturnValue(dummyDocument);
    const setupSpy = vi.spyOn(SwaggerModule, 'setup').mockImplementation(() => {});

    // when
    const result = setupSwagger(mockApp);

    // then
    expect(result).toBe(true);
    expect(createDocumentSpy).toHaveBeenCalledTimes(1);

    const passedConfig = createDocumentSpy.mock.calls[0][1];
    expect(passedConfig.info.title).toBe('My Space Backend API');
    expect(passedConfig.info.version).toBe('0.1.0');
    expect(passedConfig.tags?.map((t) => t.name)).toEqual([
      'System',
      'PDF',
      'Auth',
      'Markdown Documents',
      'Markdown Folders',
      'Markdown Tags',
      'Markdown Revisions',
      'Markdown Search',
      'Markdown Assets',
    ]);

    expect(setupSpy).toHaveBeenCalledWith(
      'docs',
      mockApp,
      dummyDocument,
      expect.objectContaining({
        swaggerOptions: {
          persistAuthorization: true,
        },
      }),
    );
  });
});
