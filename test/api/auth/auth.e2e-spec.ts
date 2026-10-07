import { describe, it, expect } from 'vitest';
import { initE2ETest } from '../../lib/init-e2e-test.js';
import { withAuthHeaders, DEFAULT_TEST_USER, OTHER_TEST_USER } from '../../lib/utils.js';

describe('Auth API (E2E)', () => {
  const ctx = initE2ETest();

  describe('GET /api/v1/auth/me', () => {
    it('인증 헤더가 제공되면 인증된 사용자 프로필을 반환해야 한다 (200)', async () => {
      // given
      const req = ctx.req.get('/api/v1/auth/me');

      // when
      const res = await withAuthHeaders(req, DEFAULT_TEST_USER).expect(200);

      // then
      expect(res.body).toEqual({
        username: DEFAULT_TEST_USER.user,
        email: DEFAULT_TEST_USER.email,
        groups: ['users', 'developers'],
        displayName: DEFAULT_TEST_USER.name,
      });
    });

    it('다른 사용자 헤더로 요청 시 해당 사용자의 정보를 반환해야 한다 (200)', async () => {
      // given
      const req = ctx.req.get('/api/v1/auth/me');

      // when
      const res = await withAuthHeaders(req, OTHER_TEST_USER).expect(200);

      // then
      expect(res.body.username).toBe(OTHER_TEST_USER.user);
      expect(res.body.email).toBe(OTHER_TEST_USER.email);
      expect(res.body.groups).toEqual(['users']);
    });

    it('로컬 개발 환경(IS_LOCAL=true)에서 헤더가 누락되어도 local-admin 기본 계정으로 응답해야 한다 (200)', async () => {
      // given & when
      const res = await ctx.req.get('/api/v1/auth/me').expect(200);

      // then
      expect(res.body.username).toBe('local-admin');
      expect(res.body.groups).toContain('admins');
    });
  });
});
