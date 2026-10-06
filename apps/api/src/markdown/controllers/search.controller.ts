import { Controller, Get, Query, UseGuards, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiHeader } from '@nestjs/swagger';
import {
  RemoteUserGuard,
  type AuthUser,
} from '@app/common/guards/remote-user.guard.js';
import { CurrentUser } from '@app/common/decorators/current-user.decorator.js';
import { SearchService } from '../services/search.service.js';
import { SearchQueryDto, SearchResponseDto } from '../dto/search.dto.js';

@ApiTags('Markdown Search')
@ApiHeader({
  name: 'Remote-User',
  description: '사용자 ID (프로덕션 환경 필수, 로컬은 Mock 유저 주입)',
})
@UseGuards(RemoteUserGuard)
@Controller('api/v1/markdown/search')
export class SearchController {
  constructor(private readonly searchService: SearchService) {}

  @Get()
  @ApiOperation({
    summary: '마크다운 문서 풀텍스트 검색',
    description: '제목, 태그 및 마크다운 본문을 대상으로 검색하며, 검색어 주변 본문 스니펫(하이라이트)과 폴더/태그 필터링을 지원합니다.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: '검색 성공',
    type: SearchResponseDto,
  })
  async search(
    @CurrentUser() user: AuthUser,
    @Query() query: SearchQueryDto,
  ): Promise<SearchResponseDto> {
    return this.searchService.search(user.username, query);
  }
}
