/**
 * RFC 6266 / RFC 5987 호환 Content-Disposition 헤더 값 생성 유틸리티
 *
 * @param filename 클라이언트에게 제공할 원본 파일명 (한글/특수문자 포함 가능)
 * @param disposition 'attachment' | 'inline' (기본값: 'attachment')
 * @returns RFC 6266 규격의 헤더 문자열 (예: attachment; filename="doc.pdf"; filename*=UTF-8''%EB%AC%B8%EC%84%9C.pdf)
 */
export function formatContentDisposition(
  filename: string,
  disposition: 'attachment' | 'inline' = 'attachment',
): string {
  // ASCII 대체 파일명 (따옴표, 역슬래시 및 비 ASCII 문자를 '_' 로 치환)
  const asciiFallback = filename
    .replace(/[^\x20-\x7E]/g, '_')
    .replace(/["\\]/g, '_');

  // RFC 5987 / RFC 6266 Percent-Encoding (UTF-8)
  const encodedFilename = encodeURIComponent(filename).replace(
    /['()]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );

  return `${disposition}; filename="${asciiFallback}"; filename*=UTF-8''${encodedFilename}`;
}
