import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { z } from 'zod';

export const createFolderSchema = z.object({
  name: z
    .string()
    .min(1, '폴더 이름은 최소 1자 이상이어야 합니다.')
    .max(100, '폴더 이름은 최대 100자까지 가능합니다.')
    .trim(),
  parentId: z.string().uuid('올바른 UUID 형식이 아닙니다.').nullable().optional(),
});

export class CreateFolderDto {
  static readonly schema = createFolderSchema;

  @ApiProperty({ example: 'Architecture', description: '폴더 이름 (최대 100자)' })
  name: string;

  @ApiPropertyOptional({
    example: 'd3b07384-d113-4696-9812-7495b2d718b5',
    description: '상위 폴더 ID (루트 폴더인 경우 생략 또는 null)',
  })
  parentId?: string | null;
}

export const updateFolderSchema = z.object({
  name: z
    .string()
    .min(1, '폴더 이름은 최소 1자 이상이어야 합니다.')
    .max(100, '폴더 이름은 최대 100자까지 가능합니다.')
    .trim()
    .optional(),
  parentId: z.string().uuid('올바른 UUID 형식이 아닙니다.').nullable().optional(),
});

export class UpdateFolderDto {
  static readonly schema = updateFolderSchema;

  @ApiPropertyOptional({ example: 'Backend Architecture', description: '변경할 폴더 이름' })
  name?: string;

  @ApiPropertyOptional({
    example: null,
    description: '이동할 상위 폴더 ID (최상위 루트로 이동 시 null)',
  })
  parentId?: string | null;
}

export class FolderResponseDto {
  @ApiProperty({ example: 'd3b07384-d113-4696-9812-7495b2d718b5', description: '폴더 ID' })
  id: string;

  @ApiProperty({ example: 'Architecture', description: '폴더 이름' })
  name: string;

  @ApiPropertyOptional({ example: null, description: '상위 폴더 ID' })
  parentId: string | null;

  @ApiProperty({ example: '2026-10-05T10:00:00.000Z', description: '생성 일시' })
  createdAt: string;

  @ApiProperty({ example: '2026-10-05T10:00:00.000Z', description: '수정 일시' })
  updatedAt: string;

  @ApiProperty({
    type: () => [FolderResponseDto],
    description: '하위 자식 폴더 목록 (계층 트리 구조)',
  })
  children: FolderResponseDto[];

  constructor(partial: Partial<FolderResponseDto>) {
    Object.assign(this, partial);
    this.children = partial.children || [];
  }
}
