import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { z } from 'zod';

export const createDocumentSchema = z.object({
  title: z
    .string()
    .min(1, '문서 제목은 필수입니다.')
    .max(255, '문서 제목은 최대 255자까지 가능합니다.')
    .trim(),
  content: z.string().default(''),
  folderId: z.string().uuid('올바른 UUID 형식이 아닙니다.').nullable().optional(),
  tags: z.array(z.string().trim()).default([]),
  frontmatter: z.record(z.string(), z.unknown()).optional(),
});

export class CreateDocumentDto {
  static readonly schema = createDocumentSchema;

  @ApiProperty({ example: 'NestJS 아키텍처 가이드', description: '문서 제목' })
  title: string;

  @ApiProperty({
    example: '# NestJS 아키텍처\n\n본 문서는 아키텍처를 설명합니다.',
    description: 'Markdown 본문 내용',
  })
  content: string;

  @ApiPropertyOptional({
    example: 'd3b07384-d113-4696-9812-7495b2d718b5',
    description: '소속 폴더 ID (미지정 시 루트/미분류)',
  })
  folderId?: string | null;

  @ApiPropertyOptional({
    example: ['nestjs', 'architecture'],
    description: '태그 목록',
  })
  tags?: string[];

  @ApiPropertyOptional({
    example: { author: 'Keunhyeok', draft: false },
    description: 'YAML Frontmatter 메타데이터',
  })
  frontmatter?: Record<string, unknown>;
}

export const updateDocumentSchema = z.object({
  title: z
    .string()
    .min(1, '문서 제목은 필수입니다.')
    .max(255, '문서 제목은 최대 255자까지 가능합니다.')
    .trim()
    .optional(),
  content: z.string().optional(),
  folderId: z.string().uuid('올바른 UUID 형식이 아닙니다.').nullable().optional(),
  tags: z.array(z.string().trim()).optional(),
  frontmatter: z.record(z.string(), z.unknown()).optional(),
});

export class UpdateDocumentDto {
  static readonly schema = updateDocumentSchema;

  @ApiPropertyOptional({ example: '수정된 문서 제목', description: '변경할 문서 제목' })
  title?: string;

  @ApiPropertyOptional({ example: '# 수정된 본문 내용', description: '변경할 Markdown 본문' })
  content?: string;

  @ApiPropertyOptional({
    example: null,
    description: '이동할 폴더 ID (루트로 이동 시 null)',
  })
  folderId?: string | null;

  @ApiPropertyOptional({
    example: ['backend', 'guide'],
    description: '대체할 태그 목록',
  })
  tags?: string[];

  @ApiPropertyOptional({
    example: { updated: true },
    description: '갱신할 Frontmatter 메타데이터',
  })
  frontmatter?: Record<string, unknown>;
}

export const documentQuerySchema = z.object({
  folderId: z.string().uuid().optional(),
  tag: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export class DocumentQueryDto {
  static readonly schema = documentQuerySchema;

  @ApiPropertyOptional({ description: '특정 폴더의 문서만 필터링' })
  folderId?: string;

  @ApiPropertyOptional({ description: '특정 태그가 포함된 문서만 필터링' })
  tag?: string;

  @ApiPropertyOptional({ example: 1, default: 1, description: '페이지 번호' })
  page?: number = 1;

  @ApiPropertyOptional({ example: 20, default: 20, description: '페이지당 항목 수' })
  limit?: number = 20;
}

export class DocumentListItemDto {
  @ApiProperty({ example: 'a1b2c3d4-0000-0000-0000-000000000000', description: '문서 ID' })
  id: string;

  @ApiProperty({ example: 'NestJS 아키텍처 가이드', description: '문서 제목' })
  title: string;

  @ApiPropertyOptional({ example: 'd3b07384-d113-4696-9812-7495b2d718b5', description: '폴더 ID' })
  folderId: string | null;

  @ApiPropertyOptional({ example: 'Architecture', description: '폴더 이름' })
  folderName?: string | null;

  @ApiProperty({ example: ['nestjs', 'architecture'], description: '태그 목록' })
  tags: string[];

  @ApiProperty({ example: 1, description: '현재 리비전 버전' })
  currentVersion: number;

  @ApiProperty({ example: '2026-10-05T10:00:00.000Z', description: '생성 일시' })
  createdAt: string;

  @ApiProperty({ example: '2026-10-05T10:00:00.000Z', description: '수정 일시' })
  updatedAt: string;

  constructor(partial: Partial<DocumentListItemDto>) {
    Object.assign(this, partial);
    this.tags = partial.tags || [];
  }
}

export class DocumentDetailDto extends DocumentListItemDto {
  @ApiProperty({ example: '# 본문 내용...', description: 'Markdown 본문 (Frontmatter 제외)' })
  content: string;

  @ApiProperty({ example: { author: 'Keunhyeok' }, description: '파싱된 Frontmatter 객체' })
  frontmatter: Record<string, unknown>;

  constructor(partial: Partial<DocumentDetailDto>) {
    super(partial);
    this.content = partial.content || '';
    this.frontmatter = partial.frontmatter || {};
  }
}
