import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class PdfMetadataDto {
  @ApiPropertyOptional({ description: '문서 제목', example: 'Sample Report' })
  title?: string;

  @ApiPropertyOptional({ description: '문서 작성자', example: 'Keunhyeok Lim' })
  author?: string;

  @ApiPropertyOptional({ description: '문서 생성 프로그램', example: 'Word' })
  creator?: string;

  @ApiPropertyOptional({ description: 'PDF 변환기/프로듀서', example: 'macOS Quartz' })
  producer?: string;

  @ApiPropertyOptional({ description: '최초 생성 일시' })
  creationDate?: Date;

  @ApiPropertyOptional({ description: '최종 수정 일시' })
  modificationDate?: Date;
}

export class InspectPdfResponseDto {
  @ApiProperty({ description: 'PDF 암호화 보호 여부', example: false })
  isEncrypted!: boolean;

  @ApiPropertyOptional({
    description: '제공된 비밀번호의 일치 여부 (암호화되어 있지 않은 파일은 undefined)',
    example: true,
  })
  isPasswordValid?: boolean;

  @ApiPropertyOptional({ description: '문서의 총 페이지 수', example: 5 })
  pageCount?: number;

  @ApiPropertyOptional({ description: 'PDF 메타데이터 상세 정보', type: () => PdfMetadataDto })
  metadata?: PdfMetadataDto;
}

export class InspectPdfDto {
  @ApiPropertyOptional({
    description: '암호화된 PDF 파일인 경우 검증할 비밀번호',
    example: 'my-password',
  })
  password?: string;
}
