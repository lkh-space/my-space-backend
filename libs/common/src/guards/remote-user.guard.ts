import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator.js';

/**
 * Authelia SSO 인증 통과 후 주입되는 사용자 정보 객체
 */
export interface AuthUser {
  username: string;
  displayName?: string;
  email?: string;
  groups: string[];
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

/**
 * 로컬 개발 시 인증 헤더 부재 시 자동 주입되는 Mock 유저
 */
export const MOCK_LOCAL_USER: AuthUser = {
  username: 'local-admin',
  displayName: 'Local Developer',
  email: 'dev@homelab.local',
  groups: ['admins', 'dev'],
};

/**
 * Authelia SSO + Reverse Proxy ForwardAuth 헤더 검증 가드
 *
 * [보안 원칙: Fail-Closed]
 * 1. 기본적으로 모든 환경에서 Remote-User 헤더가 누락되면 401 Unauthorized를 발생시킵니다.
 * 2. 명시적으로 IS_LOCAL=true가 설정된 로컬 개발 환경에서만 헤더 부재 시 MOCK_LOCAL_USER를 자동 주입합니다.
 * 3. 프로덕션 환경에서 프록시 공유 시크릿(AUTH_FORWARDED_SECRET)이 설정된 경우,
 *    x-forwarded-auth-secret 헤더를 검증하여 직접 포트 접근을 차단합니다.
 * 4. Remote-User 식별자는 영문 대소문자, 숫자, 마침표, 밑줄, 하이픈, 골뱅이만 허용(/^[a-zA-Z0-9._@-]{1,100}$/)합니다.
 */
@Injectable()
export class RemoteUserGuard implements CanActivate {
  private static readonly USERNAME_REGEX = /^[a-zA-Z0-9._@-]{1,100}$/;

  constructor(
    private readonly configService: ConfigService,
    @Optional() private readonly reflector?: Reflector,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    // 0. @Public() 데코레이터가 설정된 엔드포인트는 인증 검사를 완전히 바이패스합니다.
    if (this.reflector && typeof context.getHandler === 'function') {
      const targets = [
        context.getHandler(),
        typeof context.getClass === 'function' ? context.getClass() : undefined,
      ].filter((t): t is (...args: unknown[]) => unknown => Boolean(t));

      const isPublic = this.reflector.getAllAndOverride<boolean>(
        IS_PUBLIC_KEY,
        targets,
      );
      if (isPublic) {
        return true;
      }
    }

    const request = context.switchToHttp().getRequest<Request>();
    const isLocal =
      process.env.IS_LOCAL !== undefined
        ? process.env.IS_LOCAL === 'true'
        : this.configService.get<boolean>('app.isLocal') === true;

    // 1. 프록시 신뢰 검증 (Reverse Proxy ForwardAuth 공유 시크릿 검증)
    // 로컬 환경이 아니고, 서버에 프록시 시크릿이 설정되어 있는 경우 헤더 일치 여부 검증
    const proxySecret =
      this.configService.get<string>('app.proxySharedSecret') ||
      process.env.AUTH_FORWARDED_SECRET;

    if (!isLocal && proxySecret) {
      const incomingSecret = this.getHeader(request, 'x-forwarded-auth-secret');
      if (!incomingSecret || incomingSecret !== proxySecret) {
        throw new UnauthorizedException('신뢰할 수 없는 프록시 요청입니다.');
      }
    }

    const rawRemoteUser = this.getHeader(request, 'remote-user');
    const remoteUser = rawRemoteUser?.trim();

    // 2. 헤더에 remote-user가 있는 경우 (정상 인증된 요청)
    if (remoteUser && remoteUser.length > 0) {
      if (!RemoteUserGuard.USERNAME_REGEX.test(remoteUser)) {
        throw new UnauthorizedException('유효하지 않은 사용자 식별자 형식입니다.');
      }

      const displayName = this.getHeader(request, 'remote-name');
      const email = this.getHeader(request, 'remote-email');
      const rawGroups = this.getHeader(request, 'remote-groups');

      const groups = rawGroups
        ? rawGroups
            .split(',')
            .map((g) => g.trim())
            .filter((g) => g.length > 0)
        : [];

      request.user = {
        username: remoteUser,
        displayName: displayName?.trim() || undefined,
        email: email?.trim() || undefined,
        groups,
      };

      return true;
    }

    // 3. 명시적 로컬 개발 환경(IS_LOCAL=true)이고 헤더가 없는 경우 -> Mock 유저 자동 주입 (DX)
    if (isLocal) {
      request.user = { ...MOCK_LOCAL_USER };
      return true;
    }

    // 4. 프로덕션 및 비로컬 환경인데 인증 헤더가 누락된 경우 -> 401 차단 (Fail-Closed)
    throw new UnauthorizedException('인증 헤더(Remote-User)가 누락되었습니다.');
  }

  /**
   * Express Request에서 대소문자 무관하게 헤더 값을 단일 문자열로 추출합니다.
   */
  private getHeader(request: Request, name: string): string | undefined {
    const value = request.headers[name.toLowerCase()];
    if (Array.isArray(value)) {
      return value[0];
    }
    return value;
  }
}
