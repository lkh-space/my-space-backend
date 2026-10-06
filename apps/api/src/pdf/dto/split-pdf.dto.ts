import { z } from 'zod';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export const splitRangePdfSchema = z.object({
  ranges: z.string().min(1, '추출할 페이지 범위를 입력해주세요.'),
  password: z.string().optional(),
});

export class SplitRangePdfDto {
  static readonly schema = splitRangePdfSchema;

  @ApiProperty({
    description:
      '추출할 페이지 범위 (콤마 및 하이픈 형식, 1-based 인덱스)',
    example: '1-3, 5, 8-10',
  })
  ranges!: string;

  @ApiPropertyOptional({
    description: '암호화된 PDF 파일인 경우 비밀번호',
    example: 'my-password',
  })
  password?: string;
}

export const splitAllPdfSchema = z.object({
  password: z.string().optional(),
});

export class SplitAllPdfDto {
  static readonly schema = splitAllPdfSchema;

  @ApiPropertyOptional({
    description: '암호화된 PDF 파일인 경우 비밀번호',
    example: 'my-password',
  })
  password?: string;
}
