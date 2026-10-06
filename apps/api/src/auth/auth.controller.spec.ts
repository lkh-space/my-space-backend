import { describe, it, expect, beforeEach } from 'vitest';
import { AuthController } from './auth.controller.js';
import type { AuthUser } from '@app/common/guards/remote-user.guard.js';

describe('AuthController', () => {
  let controller: AuthController;

  beforeEach(() => {
    controller = new AuthController();
  });

  describe('GET /api/v1/auth/me', () => {
    it('인증된 유저 객체를 그대로 반환한다', () => {
      // given
      const mockUser: AuthUser = {
        username: 'test-admin',
        displayName: 'Test Administrator',
        email: 'admin@homelab.local',
        groups: ['admins', 'dev'],
      };

      // when
      const result = controller.getMe(mockUser);

      // then
      expect(result).toEqual(mockUser);
      expect(result.username).toBe('test-admin');
      expect(result.groups).toContain('admins');
    });
  });
});
