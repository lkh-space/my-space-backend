import type request from 'supertest';

export interface AuthHeaders {
  user?: string;
  email?: string;
  groups?: string;
  name?: string;
}

export const DEFAULT_TEST_USER: AuthHeaders = {
  user: 'test-user',
  email: 'test@example.com',
  groups: 'users,developers',
  name: 'Test User',
};

export const OTHER_TEST_USER: AuthHeaders = {
  user: 'other-user',
  email: 'other@example.com',
  groups: 'users',
  name: 'Other User',
};

/**
 * SuperTest 요청에 Authelia Forward Auth 인증 헤더 주입
 */
export function withAuthHeaders(
  req: request.Test,
  headers: AuthHeaders = DEFAULT_TEST_USER,
): request.Test {
  if (headers.user) req.set('Remote-User', headers.user);
  if (headers.email) req.set('Remote-Email', headers.email);
  if (headers.groups) req.set('Remote-Groups', headers.groups);
  if (headers.name) req.set('Remote-Name', headers.name);
  return req;
}

export function authHeaderBy(headers: AuthHeaders = DEFAULT_TEST_USER) {
  return function (req: request.Test): request.Test {
    return withAuthHeaders(req, headers);
  };
}
