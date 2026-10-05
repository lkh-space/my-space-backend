import { ApiProperty } from '@nestjs/swagger';

export class TagResponseDto {
  @ApiProperty({ example: '3a18a93b-18a7-4796-9812-7495b2d718b5', description: '태그 ID' })
  id: string;

  @ApiProperty({ example: 'nestjs', description: '태그 이름' })
  name: string;

  @ApiProperty({ example: 5, description: '해당 태그가 지정된 문서 개수' })
  documentCount: number;

  constructor(partial: Partial<TagResponseDto>) {
    Object.assign(this, partial);
    this.documentCount = partial.documentCount ?? 0;
  }
}
