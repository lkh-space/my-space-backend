import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { UnauthorizedException, ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import {
  RemoteUserGuard,
  MOCK_LOCAL_USER,
} from './remote-user.guard.js';

describe('RemoteUserGuard 단위 테스트', () => {
  let guard: RemoteUserGuard;
  let configService: ConfigService;
  const originalEnv = { ...process.env };

  const createMockExecutionContext = (
    headers: Record<string, string | string[] | undefined> = {},
  ): { context: ExecutionContext; request: Partial<Request> } => {
    const request: Partial<Request> = {
      headers,
      user: undefined,
    };

    const context = {
      switchToHttp: () => ({
        getRequest: () => request as Request,
        getResponse: () => ({}),
      }),
      getHandler: vi.fn(),
      getClass: vi.fn(),
    } as unknown as ExecutionContext;

    return { context, request };
  };

  beforeEach(() => {
    delete process.env.IS_LOCAL;
    delete process.env.AUTH_FORWARDED_SECRET;

    configService = {
      get: vi.fn(),
    } as unknown as ConfigService;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('명시적 로컬 개발 환경 (app.isLocal === true 또는 IS_LOCAL="true")', () => {
    beforeEach(() => {
      vi.mocked(configService.get).mockImplementation((key: string) => {
        if (key === 'app.isLocal') return true;
        return undefined;
      });
      guard = new RemoteUserGuard(configService);
    });

    it('Remote-User 헤더가 없으면 MOCK_LOCAL_USER를 req.user에 자동 주입하고 true를 반환한다', () => {
      // given
      const { context, request } = createMockExecutionContext({});

      // when
      const result = guard.canActivate(context);

      // then
      expect(result).toBe(true);
      expect(request.user).toEqual(MOCK_LOCAL_USER);
    });

    it('로컬 환경이라도 Remote-User 헤더가 제공되면 해당 헤더 정보를 우선 파싱하여 바인딩한다', () => {
      // given
      const { context, request } = createMockExecutionContext({
        'remote-user': 'custom-dev',
        'remote-name': 'Custom Developer',
        'remote-email': 'custom@dev.local',
        'remote-groups': 'developers, testers',
      });

      // when
      const result = guard.canActivate(context);

      // then
      expect(result).toBe(true);
      expect(request.user).toEqual({
        username: 'custom-dev',
        displayName: 'Custom Developer',
        email: 'custom@dev.local',
        groups: ['developers', 'testers'],
      });
    });
  });

  describe('비로컬 / 운영 환경 (Fail-Closed 보안 검증)', () => {
    beforeEach(() => {
      vi.mocked(configService.get).mockImplementation((key: string) => {
        if (key === 'app.isLocal') return false;
        return undefined;
      });
      guard = new RemoteUserGuard(configService);
    });

    it('IS_LOCAL이 false일 때 Remote-User 헤더가 누락되면 UnauthorizedException을 던진다', () => {
      // given
      const { context } = createMockExecutionContext({});

      // when & then
      expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
    });

    it('IS_LOCAL이 아예 정의되지 않은(undefined) 기본 프로덕션 상태에서도 Mock 관리자가 주입되지 않고 401을 던져야 한다 (C-2 회귀 방지)', () => {
      // given
      vi.mocked(configService.get).mockReturnValue(undefined);
      delete process.env.IS_LOCAL;
      const prodGuard = new RemoteUserGuard(configService);
      const { context } = createMockExecutionContext({});

      // when & then
      expect(() => prodGuard.canActivate(context)).toThrow(UnauthorizedException);
    });

    it('Remote-User 헤더가 공백 문자열인 경우 UnauthorizedException을 던진다', () => {
      // given
      const { context } = createMockExecutionContext({
        'remote-user': '   ',
      });

      // when & then
      expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
    });

    it('Remote-User에 허용되지 않은 특수문자나 인젝션 구문이 포함되어 있으면 401 UnauthorizedException을 던진다', () => {
      // given
      const maliciousUsers = [
        'admin; DROP TABLE users;',
        'user<script>alert(1)</script>',
        'user name with space',
        'admin/../../etc/passwd',
        'a'.repeat(101), // 100자 초과
      ];

      // when & then
      for (const username of maliciousUsers) {
        const { context } = createMockExecutionContext({
          'remote-user': username,
        });
        expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
      }
    });

    it('정상적인 영문, 숫자, 마침표, 하이픈, 밑줄, 골뱅이가 포함된 username은 허용된다', () => {
      // given
      const validUsers = [
        'john.doe',
        'user_123',
        'admin-operator',
        'user@example.com',
        'KeunhyeokLim',
      ];

      // when & then
      for (const username of validUsers) {
        const { context, request } = createMockExecutionContext({
          'remote-user': username,
        });
        const result = guard.canActivate(context);
        expect(result).toBe(true);
        expect(request.user?.username).toBe(username);
      }
    });

    it('Remote-Groups가 없으면 빈 배열로 파싱한다', () => {
      // given
      const { context, request } = createMockExecutionContext({
        'remote-user': 'user-no-group',
      });

      // when
      const result = guard.canActivate(context);

      // then
      expect(result).toBe(true);
      expect(request.user?.groups).toEqual([]);
    });

    it('Remote-Groups에 공백이나 빈 항목이 포함되어 있어도 정상 정제(trim, filter)한다', () => {
      // given
      const { context, request } = createMockExecutionContext({
        'remote-user': 'user-dirty-groups',
        'remote-groups': ' group1 , , group2,   ',
      });

      // when
      const result = guard.canActivate(context);

      // then
      expect(result).toBe(true);
      expect(request.user?.groups).toEqual(['group1', 'group2']);
    });
  });

  describe('리버스 프록시 공유 시크릿 검증 (AUTH_FORWARDED_SECRET)', () => {
    const PROXY_SECRET = 'super-secret-token-1234';

    beforeEach(() => {
      vi.mocked(configService.get).mockImplementation((key: string) => {
        if (key === 'app.isLocal') return false;
        if (key === 'app.proxySharedSecret') return PROXY_SECRET;
        return undefined;
      });
      guard = new RemoteUserGuard(configService);
    });

    it('프록시 시크릿 헤더가 누락된 경우 401 UnauthorizedException을 던진다', () => {
      // given
      const { context } = createMockExecutionContext({
        'remote-user': 'authenticated-user',
      });

      // when & then
      expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
    });

    it('프록시 시크릿 헤더가 불일치하는 경우 401 UnauthorizedException을 던진다', () => {
      // given
      const { context } = createMockExecutionContext({
        'remote-user': 'authenticated-user',
        'x-forwarded-auth-secret': 'wrong-secret',
      });

      // when & then
      expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
    });

    it('프록시 시크릿 헤더가 올바르게 일치하면 인증이 정상 통과된다', () => {
      // given
      const { context, request } = createMockExecutionContext({
        'remote-user': 'authenticated-user',
        'x-forwarded-auth-secret': PROXY_SECRET,
      });

      // when
      const result = guard.canActivate(context);

      // then
      expect(result).toBe(true);
      expect(request.user?.username).toBe('authenticated-user');
    });
  });

  describe('@Public() 데코레이터 바이패스 검증 (Secure by Default 예외 처리)', () => {
    let reflector: { getAllAndOverride: ReturnType<typeof vi.fn> };

    beforeEach(() => {
      vi.mocked(configService.get).mockImplementation((key: string) => {
        if (key === 'app.isLocal') return false;
        return undefined;
      });

      reflector = {
        getAllAndOverride: vi.fn(),
      };
      guard = new RemoteUserGuard(configService, reflector as any);
    });

    it('@Public()이 적용된 경우(isPublic: true), 헤더가 없고 비로컬 환경이어도 401 없이 통과(true)한다', () => {
      // given
      reflector.getAllAndOverride.mockReturnValue(true);
      const { context } = createMockExecutionContext({});

      // when
      const result = guard.canActivate(context);

      // then
      expect(result).toBe(true);
      expect(reflector.getAllAndOverride).toHaveBeenCalled();
    });

    it('@Public()이 미적용된 경우(isPublic: false), 비로컬 환경에서 헤더가 없으면 401 UnauthorizedException을 발생시킨다', () => {
      // given
      reflector.getAllAndOverride.mockReturnValue(false);
      const { context } = createMockExecutionContext({});

      // when & then
      expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
    });
  });
});
