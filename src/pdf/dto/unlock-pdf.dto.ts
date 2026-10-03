import { z } from 'zod';
import { ApiProperty } from '@nestjs/swagger';

export const unlockPdfSchema = z.object({
  password: z
    .string()
    .min(1, 'PDF 암호 해제를 위한 비밀번호를 입력해주세요.'),
});

export class UnlockPdfDto {
  static readonly schema = unlockPdfSchema;

  @ApiProperty({
    description: 'PDF 암호를 해제하기 위한 비밀번호',
    example: 'my-secret-password',
  })
  password!: string;
}
