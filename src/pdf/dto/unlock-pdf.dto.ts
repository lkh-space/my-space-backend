import { ApiProperty } from '@nestjs/swagger';

export class UnlockPdfDto {
  @ApiProperty({
    description: 'PDF 암호를 해제하기 위한 비밀번호',
    example: 'my-secret-password',
  })
  password!: string;
}
