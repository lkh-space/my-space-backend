import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { VersionService } from './version.service.js';

describe('VersionService', () => {
  let service: VersionService;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // given: 환경변수 초기화
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  it('환경변수가 설정되어 있을 경우 환경변수의 메타데이터를 우선 반환해야 한다', () => {
    // given
    process.env.APP_NAME = 'custom-backend';
    process.env.APP_VERSION = '1.2.3';
    process.env.GIT_BRANCH = 'feature/version-test';
    process.env.GIT_COMMIT = '1234567890abcdef';
    process.env.BUILD_TIME = '2026-10-03T12:00:00.000Z';
    process.env.NODE_ENV = 'production';

    service = new VersionService();

    // when
    const info = service.getVersionInfo();

    // then
    expect(info.name).toBe('custom-backend');
    expect(info.version).toBe('1.2.3');
    expect(info.gitBranch).toBe('feature/version-test');
    expect(info.gitCommit).toBe('1234567'); // 7글자 잘림 확인
    expect(info.buildTime).toBe('2026-10-03T12:00:00.000Z');
    expect(info.env).toBe('production');
  });

  it('appName 옵션이 주어지면 해당 앱의 package.json 정보를 읽어와야 한다', () => {
    // given
    delete process.env.APP_NAME;
    delete process.env.APP_VERSION;
    service = new VersionService({ appName: 'api' });

    // when
    const info = service.getVersionInfo();

    // then
    expect(info.name).toBe('@my-space/api');
    expect(info.version).toBe('0.1.0');
  });

  it('ai 앱에 대한 옵션이 주어지면 @my-space/ai와 0.1.0을 읽어와야 한다', () => {
    // given
    delete process.env.APP_NAME;
    delete process.env.APP_VERSION;
    service = new VersionService({ appName: 'ai' });

    // when
    const info = service.getVersionInfo();

    // then
    expect(info.name).toBe('@my-space/ai');
    expect(info.version).toBe('0.1.0');
  });

  it('로컬 환경(IS_LOCAL=true)에서 환경변수가 없으면 Git CLI를 통해 실시간 형상 정보를 가져와야 한다', () => {
    // given
    delete process.env.GIT_BRANCH;
    delete process.env.GIT_COMMIT;
    process.env.IS_LOCAL = 'true';
    delete process.env.NODE_ENV;

    service = new VersionService({ appName: 'api' });

    // when
    const info = service.getVersionInfo();

    // then
    expect(info.name).toBe('@my-space/api');
    expect(info.version).toBe('0.1.0');
    expect(info.gitBranch).not.toBe('');
    expect(info.gitCommit).not.toBe('');
    expect(info.env).toBe('local');
    expect(info.buildTime).toBeDefined();
  });

  it('프로덕션 환경(NODE_ENV=production)에서 환경변수 미주입 시 unknown으로 안전하게 폴백해야 한다', () => {
    // given
    delete process.env.GIT_BRANCH;
    delete process.env.GIT_COMMIT;
    delete process.env.IS_LOCAL;
    process.env.NODE_ENV = 'production';

    service = new VersionService({ appName: 'api' });

    // when
    const info = service.getVersionInfo();

    // then
    expect(info.gitBranch).toBe('unknown');
    expect(info.gitCommit).toBe('unknown');
    expect(info.env).toBe('production');
  });

  it('getVersionInfo를 여러 번 호출해도 인메모리 캐시를 통해 동일한 객체를 반환해야 한다', () => {
    // given
    process.env.GIT_COMMIT = 'test-sha';
    service = new VersionService({ appName: 'api' });

    // when
    const firstCall = service.getVersionInfo();
    const secondCall = service.getVersionInfo();

    // then
    expect(firstCall).toBe(secondCall);
  });
});
