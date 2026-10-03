import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { AuthUser } from '../../common/guards/remote-user.guard.js';

export class AuthUserDto implements AuthUser {
  @ApiProperty({ description: '사용자 고유 ID / Username', example: 'admin' })
  username!: string;

  @ApiPropertyOptional({
    description: '사용자 실명 / 표시명',
    example: 'Administrator',
  })
  displayName?: string;

  @ApiPropertyOptional({
    description: '사용자 이메일 주소',
    example: 'admin@homelab.local',
  })
  email?: string;

  @ApiProperty({
    description: '사용자가 소속된 그룹 목록',
    example: ['admins', 'dev'],
    type: [String],
  })
  groups!: string[];
}
