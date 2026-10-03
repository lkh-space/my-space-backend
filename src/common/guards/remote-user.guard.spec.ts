import { describe, it, expect, beforeEach, vi } from 'vitest';
import { UnauthorizedException, ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import {
  RemoteUserGuard,
  MOCK_LOCAL_USER,
} from './remote-user.guard.js';

describe('RemoteUserGuard', () => {
  let guard: RemoteUserGuard;
  let configService: ConfigService;

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
    } as unknown as ExecutionContext;

    return { context, request };
  };

  beforeEach(() => {
    configService = {
      get: vi.fn(),
    } as unknown as ConfigService;
  });

  describe('비프로덕션 (로컬 개발) 환경', () => {
    beforeEach(() => {
      vi.mocked(configService.get).mockReturnValue('development');
      guard = new RemoteUserGuard(configService);
    });

    it('Remote-User 헤더가 없으면 MOCK_LOCAL_USER를 req.user에 주입하고 true를 반환한다', () => {
      // given
      const { context, request } = createMockExecutionContext({});

      // when
      const result = guard.canActivate(context);

      // then
      expect(result).toBe(true);
      expect(request.user).toEqual(MOCK_LOCAL_USER);
    });

    it('Remote-User 헤더가 제공되면 헤더 정보를 파싱하여 req.user에 바인딩한다', () => {
      // given
      const { context, request } = createMockExecutionContext({
        'remote-user': 'guest-user',
        'remote-name': 'Guest Kim',
        'remote-email': 'guest@example.com',
        'remote-groups': 'guests, reviewers',
      });

      // when
      const result = guard.canActivate(context);

      // then
      expect(result).toBe(true);
      expect(request.user).toEqual({
        username: 'guest-user',
        displayName: 'Guest Kim',
        email: 'guest@example.com',
        groups: ['guests', 'reviewers'],
      });
    });
  });

  describe('프로덕션 환경', () => {
    beforeEach(() => {
      vi.mocked(configService.get).mockReturnValue('production');
      guard = new RemoteUserGuard(configService);
    });

    it('Remote-User 헤더가 유효하면 req.user에 파싱하여 바인딩하고 true를 반환한다', () => {
      // given
      const { context, request } = createMockExecutionContext({
        'remote-user': 'prod-admin',
        'remote-name': 'Production Admin',
        'remote-email': 'admin@homelab.local',
        'remote-groups': 'admins,operators',
      });

      // when
      const result = guard.canActivate(context);

      // then
      expect(result).toBe(true);
      expect(request.user).toEqual({
        username: 'prod-admin',
        displayName: 'Production Admin',
        email: 'admin@homelab.local',
        groups: ['admins', 'operators'],
      });
    });

    it('Remote-User 헤더가 누락되었을 경우 UnauthorizedException을 던진다', () => {
      // given
      const { context } = createMockExecutionContext({});

      // when & then
      expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
    });

    it('Remote-User 헤더가 공백 문자열인 경우 UnauthorizedException을 던진다', () => {
      // given
      const { context } = createMockExecutionContext({
        'remote-user': '   ',
      });

      // when & then
      expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
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
});
