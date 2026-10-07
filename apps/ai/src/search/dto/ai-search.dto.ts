import { z } from 'zod';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export const aiSearchSchema = z.object({
  query: z.string().min(1, '검색 질의어는 최소 1자 이상이어야 합니다.'),
  limit: z.coerce.number().int().min(1).max(20).default(5),
  folderId: z.string().optional(),
  tags: z.array(z.string()).optional(),
});

export type AiSearchInput = z.infer<typeof aiSearchSchema>;

export class AiSearchDto {
  static readonly schema = aiSearchSchema;

  @ApiProperty({ description: '시맨틱 검색 키워드 또는 자연어 질의', example: 'NestJS 아키텍처 설계' })
  query!: string;

  @ApiPropertyOptional({ description: '조회할 최대 청크 개수', example: 5, default: 5 })
  limit?: number;

  @ApiPropertyOptional({ description: '특정 폴더 필터링 ID' })
  folderId?: string;

  @ApiPropertyOptional({ description: '특정 태그 필터링 배열', example: ['backend'] })
  tags?: string[];
}

export class AiSearchResultItemDto {
  @ApiProperty({ description: '문서 고유 ID' })
  documentId!: string;

  @ApiProperty({ description: '문서 제목' })
  title!: string;

  @ApiProperty({ description: '소속 헤딩' })
  heading!: string;

  @ApiProperty({ description: '청크 본문' })
  content!: string;

  @ApiProperty({ description: '코사인 유사도 점수', example: 0.892 })
  score!: number;

  @ApiPropertyOptional({ description: '태그 목록' })
  tags?: string[];
}

export class AiSearchResponseDto {
  @ApiProperty({ type: [AiSearchResultItemDto], description: '유사도 순 검색 결과 목록' })
  results!: AiSearchResultItemDto[];

  @ApiProperty({ description: '총 검색된 청크 수' })
  total!: number;
}
