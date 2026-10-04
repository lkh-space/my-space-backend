import { Controller, Get, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { VersionService } from './version.service.js';
import { VersionResponseDto } from './dto/version-info.dto.js';

@ApiTags('System')
@Controller(['version', 'api/v1/version'])
export class VersionController {
  constructor(private readonly versionService: VersionService) {}

  /**
   * 애플리케이션 버전 및 빌드 메타데이터 조회
   */
  @Get()
  @ApiOperation({
    summary: '애플리케이션 버전 및 빌드 메타데이터 조회',
    description:
      '현재 배포된 애플리케이션의 버전, Git 브랜치, 커밋 해시, 빌드 시각 및 환경 정보를 반환합니다. (/version 및 /api/v1/version 지원)',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: '버전 정보 조회 성공',
    type: VersionResponseDto,
  })
  getVersionInfo(): VersionResponseDto {
    return this.versionService.getVersionInfo();
  }
}
