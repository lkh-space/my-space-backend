import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthUser } from '../guards/remote-user.guard.js';

/**
 * 컨트롤러 핸들러에서 req.user에 주입된 AuthUser를 추출하는 커스텀 데코레이터
 *
 * 사용 예:
 * ```typescript
 * @Get('me')
 * getMe(@CurrentUser() user: AuthUser) {
 *   return user;
 * }
 * ```
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser | undefined => {
    const request = ctx.switchToHttp().getRequest<Request>();
    return request.user;
  },
);
