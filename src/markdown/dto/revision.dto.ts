import { ApiProperty } from '@nestjs/swagger';

export class RevisionListItemDto {
  @ApiProperty({ example: 1, description: '리비전 버전 번호' })
  version: number;

  @ApiProperty({ example: '문서 제목', description: '해당 시점의 문서 제목' })
  title: string;

  @ApiProperty({ example: '2026-10-05T10:00:00.000Z', description: '리비전 생성 일시' })
  createdAt: string;

  @ApiProperty({ example: false, description: '현재 활성 버전 여부' })
  isCurrent: boolean;

  constructor(partial: Partial<RevisionListItemDto>) {
    Object.assign(this, partial);
    this.isCurrent = partial.isCurrent ?? false;
  }
}

export class RevisionDetailDto {
  @ApiProperty({ example: 1, description: '리비전 버전 번호' })
  version: number;

  @ApiProperty({ example: '문서 제목', description: '해당 시점의 문서 제목' })
  title: string;

  @ApiProperty({ example: '# 해당 버전의 본문 내용...', description: 'Markdown 본문 내용' })
  content: string;

  @ApiProperty({ example: '2026-10-05T10:00:00.000Z', description: '생성 일시' })
  createdAt: string;

  constructor(partial: Partial<RevisionDetailDto>) {
    Object.assign(this, partial);
    this.content = partial.content || '';
  }
}

export class RevisionCompareDto {
  @ApiProperty({ example: 2, description: '기준 버전 (보통 현재 버전)' })
  baseVersion: number;

  @ApiProperty({ example: '# 현재 내용', description: '기준 버전 본문' })
  baseContent: string;

  @ApiProperty({ example: 1, description: '비교 대상 과거 버전' })
  targetVersion: number;

  @ApiProperty({ example: '# 과거 내용', description: '비교 대상 버전 본문' })
  targetContent: string;

  constructor(partial: Partial<RevisionCompareDto>) {
    Object.assign(this, partial);
  }
}
