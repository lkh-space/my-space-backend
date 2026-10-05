import { Controller, Get, UseGuards, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiHeader } from '@nestjs/swagger';
import {
  RemoteUserGuard,
  type AuthUser,
} from '../../common/guards/remote-user.guard.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { TagService } from '../services/tag.service.js';
import { TagResponseDto } from '../dto/tag.dto.js';

@ApiTags('Markdown Tags')
@ApiHeader({
  name: 'Remote-User',
  description: '사용자 ID (프로덕션 환경 필수, 로컬은 Mock 유저 주입)',
})
@UseGuards(RemoteUserGuard)
@Controller('api/v1/markdown/tags')
export class TagController {
  constructor(private readonly tagService: TagService) {}

  @Get()
  @ApiOperation({
    summary: '태그 목록 및 문서 사용 건수 조회',
    description: '로그인 사용자가 작성한 문서에 지정된 태그 목록과 각 태그별 문서 개수를 조회합니다.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: '태그 목록 조회 성공',
    type: [TagResponseDto],
  })
  async getTags(@CurrentUser() user: AuthUser): Promise<TagResponseDto[]> {
    return this.tagService.getTags(user.username);
  }
}
