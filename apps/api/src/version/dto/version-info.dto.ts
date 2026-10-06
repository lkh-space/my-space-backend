import { ApiProperty } from '@nestjs/swagger';
import { z } from 'zod';

/**
 * VersionResponseDto Zod 스키마
 */
export const versionResponseSchema = z.object({
  name: z.string().describe('애플리케이션 이름'),
  version: z.string().describe('애플리케이션 SemVer 버전'),
  gitBranch: z.string().describe('Git 브랜치명'),
  gitCommit: z.string().describe('Git 커밋 해시'),
  buildTime: z.string().describe('빌드 일시 (ISO 8601)'),
  env: z.string().describe('구동 환경 (production, local 등)'),
});

/**
 * 애플리케이션 버전 및 빌드 정보 응답 DTO
 */
export class VersionResponseDto {
  static readonly schema = versionResponseSchema;

  @ApiProperty({
    description: '애플리케이션 명칭',
    example: 'my-space-backend',
  })
  name: string;

  @ApiProperty({
    description: '애플리케이션 버전 (SemVer)',
    example: '0.0.1',
  })
  version: string;

  @ApiProperty({
    description: 'Git 브랜치명',
    example: 'main',
  })
  gitBranch: string;

  @ApiProperty({
    description: 'Git 커밋 해시 (단축 해시 또는 전체 SHA)',
    example: 'c334cc2',
  })
  gitCommit: string;

  @ApiProperty({
    description: '빌드 일시 (ISO 8601)',
    example: '2026-10-03T16:45:00.000Z',
  })
  buildTime: string;

  @ApiProperty({
    description: '런타임 구동 환경',
    example: 'production',
  })
  env: string;

  constructor(partial: VersionResponseDto) {
    this.name = partial.name;
    this.version = partial.version;
    this.gitBranch = partial.gitBranch;
    this.gitCommit = partial.gitCommit;
    this.buildTime = partial.buildTime;
    this.env = partial.env;
  }
}
