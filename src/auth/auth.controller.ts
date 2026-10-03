import { Controller, Get, UseGuards, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiHeader } from '@nestjs/swagger';
import {
  RemoteUserGuard,
  type AuthUser,
} from '../common/guards/remote-user.guard.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { AuthUserDto } from './dto/auth-user.dto.js';

@ApiTags('Auth')
@Controller('api/v1/auth')
export class AuthController {
  /**
   * 현재 인증된 사용자 정보 조회
   */
  @Get('me')
  @UseGuards(RemoteUserGuard)
  @ApiOperation({
    summary: '현재 로그인 사용자 프로필 조회',
    description:
      'Authelia SSO 및 Reverse Proxy로부터 주입된 헤더 정보를 바탕으로 현재 사용자의 계정 및 그룹 권한 정보를 반환합니다. (로컬 환경에서는 Mock 유저가 자동 주입됩니다)',
  })
  @ApiHeader({
    name: 'Remote-User',
    description: '사용자 ID (프로덕션 환경 필수)',
    required: false,
  })
  @ApiHeader({
    name: 'Remote-Name',
    description: '사용자 표시명',
    required: false,
  })
  @ApiHeader({
    name: 'Remote-Email',
    description: '사용자 이메일 주소',
    required: false,
  })
  @ApiHeader({
    name: 'Remote-Groups',
    description: '소속 그룹 목록 (쉼표 구분)',
    required: false,
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: '사용자 프로필 조회 성공',
    type: AuthUserDto,
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: '인증 헤더 누락 (프로덕션 환경)',
  })
  getMe(@CurrentUser() user: AuthUser): AuthUserDto {
    return user;
  }
}
