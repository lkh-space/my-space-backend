import { describe, it, expect } from 'vitest';
import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants.js';
import type { ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { CurrentUser } from './current-user.decorator.js';
import type { AuthUser } from '../guards/remote-user.guard.js';

// Param decorator factory 추출 헬퍼
function getParamDecoratorFactory(decorator: Function) {
  class TestClass {
    testMethod(@decorator() _value: unknown) {}
  }

  const metadata = Reflect.getMetadata(
    ROUTE_ARGS_METADATA,
    TestClass,
    'testMethod',
  );
  const key = Object.keys(metadata)[0];
  return metadata[key].factory;
}

describe('CurrentUser Decorator', () => {
  it('ExecutionContext에서 request.user를 성공적으로 추출하여 반환한다', () => {
    // given
    const mockUser: AuthUser = {
      username: 'local-admin',
      displayName: 'Local Developer',
      email: 'dev@homelab.local',
      groups: ['admins'],
    };

    const mockContext = {
      switchToHttp: () => ({
        getRequest: () =>
          ({
            user: mockUser,
          }) as Request,
      }),
    } as unknown as ExecutionContext;

    const factory = getParamDecoratorFactory(CurrentUser);

    // when
    const result = factory(null, mockContext);

    // then
    expect(result).toEqual(mockUser);
  });

  it('request.user가 없으면 undefined를 반환한다', () => {
    // given
    const mockContext = {
      switchToHttp: () => ({
        getRequest: () => ({}) as Request,
      }),
    } as unknown as ExecutionContext;

    const factory = getParamDecoratorFactory(CurrentUser);

    // when
    const result = factory(null, mockContext);

    // then
    expect(result).toBeUndefined();
  });
});
