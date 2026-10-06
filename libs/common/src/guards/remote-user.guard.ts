import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';

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
 * 1. 로컬 개발 환경(NODE_ENV !== 'production')에서 헤더가 없으면 MOCK_LOCAL_USER 주입
 * 2. 헤더에 Remote-User가 존재하면 헤더 값들을 파싱하여 req.user에 바인딩
 * 3. 프로덕션 환경(NODE_ENV === 'production')에서 Remote-User 헤더가 없으면 401 UnauthorizedException 발생
 */
@Injectable()
export class RemoteUserGuard implements CanActivate {
  constructor(private readonly configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const nodeEnv =
      this.configService.get<string>('app.nodeEnv') ||
      process.env.NODE_ENV ||
      'development';
    const isProduction = nodeEnv === 'production';

    const remoteUser = this.getHeader(request, 'remote-user');

    // 헤더에 remote-user가 있는 경우 (정상 인증된 요청)
    if (remoteUser && remoteUser.trim().length > 0) {
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
        username: remoteUser.trim(),
        displayName: displayName?.trim() || undefined,
        email: email?.trim() || undefined,
        groups,
      };

      return true;
    }

    // 로컬/비프로덕션 환경이고 헤더가 없는 경우 -> Mock 유저 자동 주입 (DX)
    if (!isProduction) {
      request.user = { ...MOCK_LOCAL_USER };
      return true;
    }

    // 프로덕션 환경인데 인증 헤더가 누락된 경우 -> 401 차단
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
