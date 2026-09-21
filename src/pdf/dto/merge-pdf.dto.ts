export class MergePdfDto {
  /**
   * 각 파일에 대응하는 비밀번호 목록
   * - JSON 배열 문자열: `["pw1", "", "pw2"]`
   * - 인덱스 배열 필드: `passwords[0]=pw1&passwords[1]=`
   */
  passwords?: string | string[];
}
