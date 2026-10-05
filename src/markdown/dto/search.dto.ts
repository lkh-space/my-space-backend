import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { z } from 'zod';

export const searchQuerySchema = z.object({
  q: z.string().trim().default(''),
  folderId: z.string().uuid().optional(),
  tag: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export class SearchQueryDto {
  static readonly schema = searchQuerySchema;

  @ApiPropertyOptional({ example: 'NestJS', description: '검색어' })
  q?: string = '';

  @ApiPropertyOptional({ description: '특정 폴더로 검색 범위 제한' })
  folderId?: string;

  @ApiPropertyOptional({ description: '특정 태그로 검색 범위 제한' })
  tag?: string;

  @ApiPropertyOptional({ example: 1, default: 1, description: '페이지 번호' })
  page?: number = 1;

  @ApiPropertyOptional({ example: 20, default: 20, description: '페이지당 항목 수' })
  limit?: number = 20;
}

export class SearchResultItemDto {
  @ApiProperty({ example: 'a1b2c3d4-0000-0000-0000-000000000000', description: '문서 ID' })
  id: string;

  @ApiProperty({ example: 'NestJS 아키텍처 가이드', description: '문서 제목' })
  title: string;

  @ApiProperty({ example: ['nestjs', 'architecture'], description: '태그 목록' })
  tags: string[];

  @ApiPropertyOptional({ example: 'd3b07384-d113-4696-9812-7495b2d718b5', description: '폴더 ID' })
  folderId: string | null;

  @ApiProperty({ example: '2026-10-05T10:00:00.000Z', description: '수정 일시' })
  updatedAt: string;

  @ApiProperty({ example: 4.5, description: '검색 연관도 점수' })
  score: number;

  @ApiPropertyOptional({
    example: '...본 문서는 <em>NestJS</em>의 모듈형 아키텍처를 설명합니다...',
    description: '본문 일치 부분 하이라이트 스니펫',
  })
  snippet?: string;

  constructor(partial: Partial<SearchResultItemDto>) {
    Object.assign(this, partial);
    this.tags = partial.tags || [];
  }
}

export class SearchResponseDto {
  @ApiProperty({ example: 1, description: '검색 결과 총 개수' })
  total: number;

  @ApiProperty({ example: 1, description: '현재 페이지' })
  page: number;

  @ApiProperty({ example: 20, description: '페이지 크기' })
  limit: number;

  @ApiProperty({ type: [SearchResultItemDto], description: '검색된 문서 목록' })
  items: SearchResultItemDto[];

  constructor(partial: Partial<SearchResponseDto>) {
    Object.assign(this, partial);
    this.items = partial.items || [];
  }
}
