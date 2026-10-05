import { ApiProperty } from '@nestjs/swagger';

export class AssetUploadResponseDto {
  @ApiProperty({
    example: '/api/v1/markdown/assets/images/admin/uuid-example.png',
    description: '마크다운 본문에 삽입 가능한 이미지 접근 상대 URL',
  })
  url: string;

  @ApiProperty({
    example: 'images/admin/uuid-example.png',
    description: 'MinIO 에셋 버킷 내부 오브젝트 키',
  })
  key: string;

  @ApiProperty({ example: 'architecture.png', description: '원본 파일명' })
  filename: string;

  @ApiProperty({ example: 1048576, description: '파일 크기 (바이트)' })
  size: number;

  @ApiProperty({ example: 'image/png', description: 'MIME 콘텐츠 타입' })
  contentType: string;

  constructor(partial: Partial<AssetUploadResponseDto>) {
    Object.assign(this, partial);
  }
}
