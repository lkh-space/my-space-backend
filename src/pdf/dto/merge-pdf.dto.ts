import { z } from 'zod';
import { ApiPropertyOptional } from '@nestjs/swagger';

export const mergePdfSchema = z.object({
  passwords: z.union([z.string(), z.array(z.string())]).optional(),
});

export class MergePdfDto {
  static readonly schema = mergePdfSchema;

  /**
   * 각 파일에 대응하는 비밀번호 목록
   * - JSON 배열 문자열: `["pw1", "", "pw2"]`
   * - 인덱스 배열 필드: `passwords[0]=pw1&passwords[1]=`
   */
  @ApiPropertyOptional({
    description:
      '각 업로드 파일 인덱스에 대응하는 비밀번호 목록 (JSON 배열 문자열 형태 권장)',
    example: '["secret1", ""]',
    type: 'string',
  })
  passwords?: string | string[];
}
