import {
  Controller,
  Post,
  Body,
  UseGuards,
  HttpStatus,
  HttpCode,
  UsePipes,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiHeader } from '@nestjs/swagger';
import {
  RemoteUserGuard,
  type AuthUser,
} from '@app/common/guards/remote-user.guard.js';
import { CurrentUser } from '@app/common/decorators/current-user.decorator.js';
import { ZodValidationPipe } from '@app/common/pipes/zod-validation.pipe.js';
import { AiSearchService } from './ai-search.service.js';
import {
  AiSearchDto,
  AiSearchResponseDto,
  aiSearchSchema,
} from './dto/ai-search.dto.js';

@ApiTags('AI Search')
@ApiHeader({
  name: 'Remote-User',
  description: '사용자 ID (프로덕션 환경 필수, 로컬은 dev-admin 주입)',
})
@UseGuards(RemoteUserGuard)
@Controller('api/v1/ai/search')
export class AiSearchController {
  constructor(private readonly searchService: AiSearchService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @UsePipes(new ZodValidationPipe(aiSearchSchema))
  @ApiOperation({
    summary: '개인 마크다운 문서 시맨틱 검색',
    description: 'Qdrant 벡터 데이터베이스를 기반으로 사용자의 문서 청크들을 자연어 의미 기반으로 검색합니다.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: '시맨틱 검색 성공',
    type: AiSearchResponseDto,
  })
  async search(
    @CurrentUser() user: AuthUser,
    @Body() dto: AiSearchDto,
  ): Promise<AiSearchResponseDto> {
    return this.searchService.search(user.username, dto);
  }
}
