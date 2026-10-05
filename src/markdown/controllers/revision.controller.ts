import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  UseGuards,
  ParseIntPipe,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiHeader } from '@nestjs/swagger';
import {
  RemoteUserGuard,
  type AuthUser,
} from '../../common/guards/remote-user.guard.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { RevisionService } from '../services/revision.service.js';
import {
  RevisionListItemDto,
  RevisionDetailDto,
  RevisionCompareDto,
} from '../dto/revision.dto.js';
import { DocumentDetailDto } from '../dto/document.dto.js';

@ApiTags('Markdown Revisions')
@ApiHeader({
  name: 'Remote-User',
  description: '사용자 ID (프로덕션 환경 필수, 로컬은 Mock 유저 주입)',
})
@UseGuards(RemoteUserGuard)
@Controller('api/v1/markdown/documents/:documentId/revisions')
export class RevisionController {
  constructor(private readonly revisionService: RevisionService) {}

  @Get()
  @ApiOperation({
    summary: '문서의 리비전 이력 목록 조회',
    description: '문서의 모든 과거 리비전 및 현재 활성 버전 목록을 조회합니다.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: '리비전 목록 조회 성공',
    type: [RevisionListItemDto],
  })
  async getRevisions(
    @CurrentUser() user: AuthUser,
    @Param('documentId') documentId: string,
  ): Promise<RevisionListItemDto[]> {
    return this.revisionService.getRevisions(user.username, documentId);
  }

  @Get('compare')
  @ApiOperation({
    summary: '버전 간 본문 내용 비교',
    description: '현재 버전과 지정한 과거 버전의 본문 내용을 함께 조회하여 비교를 지원합니다.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: '비교 데이터 조회 성공',
    type: RevisionCompareDto,
  })
  async compareRevisions(
    @CurrentUser() user: AuthUser,
    @Param('documentId') documentId: string,
    @Query('targetVersion', ParseIntPipe) targetVersion: number,
  ): Promise<RevisionCompareDto> {
    return this.revisionService.compareRevisions(
      user.username,
      documentId,
      targetVersion,
    );
  }

  @Get(':version')
  @ApiOperation({
    summary: '특정 과거 버전 리비전 상세 조회',
    description: '지정한 과거 버전의 마크다운 본문 및 메타데이터를 조회합니다.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: '과거 리비전 상세 조회 성공',
    type: RevisionDetailDto,
  })
  async getRevisionDetail(
    @CurrentUser() user: AuthUser,
    @Param('documentId') documentId: string,
    @Param('version', ParseIntPipe) version: number,
  ): Promise<RevisionDetailDto> {
    return this.revisionService.getRevisionDetail(
      user.username,
      documentId,
      version,
    );
  }

  @Post(':version/restore')
  @ApiOperation({
    summary: '과거 버전으로 문서 복원',
    description: '지정한 과거 버전의 본문으로 새로운 리비전을 생성하여 복원합니다.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: '문서 복원 성공',
    type: DocumentDetailDto,
  })
  async restoreRevision(
    @CurrentUser() user: AuthUser,
    @Param('documentId') documentId: string,
    @Param('version', ParseIntPipe) version: number,
  ) {
    return this.revisionService.restoreRevision(
      user.username,
      documentId,
      version,
    );
  }
}
