import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SplitRangePdfDto {
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

export class SplitAllPdfDto {
  @ApiPropertyOptional({
    description: '암호화된 PDF 파일인 경우 비밀번호',
    example: 'my-password',
  })
  password?: string;
}
