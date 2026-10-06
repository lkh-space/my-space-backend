import { PdfInvalidPageRangeException } from '../exceptions/pdf.exception.js';

/**
 * 사용자 입력 페이지 범위 문자열(예: '1-3, 5, 8-10')을 파싱하여
 * 1-based 정렬된 고유 페이지 번호 배열로 변환합니다.
 *
 * @param rangeStr 페이지 범위 문자열
 * @param totalPages PDF의 총 페이지 수
 * @returns 1-based 페이지 번호 배열 (오름차순)
 * @throws PdfInvalidPageRangeException 유효하지 않은 범위일 경우
 */
export function parsePageRanges(
  rangeStr: string,
  totalPages: number,
): number[] {
  if (!rangeStr || typeof rangeStr !== 'string' || rangeStr.trim() === '') {
    throw new PdfInvalidPageRangeException('페이지 범위를 입력해야 합니다.');
  }

  if (totalPages <= 0) {
    throw new PdfInvalidPageRangeException(
      '문서의 전체 페이지 수가 유효하지 않습니다.',
    );
  }

  const parts = rangeStr
    .split(',')
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  if (parts.length === 0) {
    throw new PdfInvalidPageRangeException(
      '유효한 페이지 범위를 지정해주세요.',
    );
  }

  const pageSet = new Set<number>();

  for (const part of parts) {
    if (part.includes('-')) {
      const rangeParts = part.split('-').map((s) => s.trim());
      if (rangeParts.length !== 2) {
        throw new PdfInvalidPageRangeException(
          `잘못된 범위 형식입니다: "${part}"`,
        );
      }

      const start = Number(rangeParts[0]);
      const end = Number(rangeParts[1]);

      if (!Number.isInteger(start) || !Number.isInteger(end)) {
        throw new PdfInvalidPageRangeException(
          `페이지 번호는 정수여야 합니다: "${part}"`,
        );
      }

      if (start <= 0 || end <= 0) {
        throw new PdfInvalidPageRangeException(
          `페이지 번호는 1 이상이어야 합니다: "${part}"`,
        );
      }

      if (start > end) {
        throw new PdfInvalidPageRangeException(
          `시작 페이지(${start})는 끝 페이지(${end})보다 클 수 없습니다.`,
        );
      }

      if (end > totalPages) {
        throw new PdfInvalidPageRangeException(
          `지정한 페이지(${end})가 전체 페이지 수(${totalPages})를 초과합니다.`,
        );
      }

      for (let i = start; i <= end; i++) {
        pageSet.add(i);
      }
    } else {
      const pageNum = Number(part);
      if (!Number.isInteger(pageNum)) {
        throw new PdfInvalidPageRangeException(
          `페이지 번호는 정수여야 합니다: "${part}"`,
        );
      }

      if (pageNum <= 0) {
        throw new PdfInvalidPageRangeException(
          `페이지 번호는 1 이상이어야 합니다: "${part}"`,
        );
      }

      if (pageNum > totalPages) {
        throw new PdfInvalidPageRangeException(
          `지정한 페이지(${pageNum})가 전체 페이지 수(${totalPages})를 초과합니다.`,
        );
      }

      pageSet.add(pageNum);
    }
  }

  if (pageSet.size === 0) {
    throw new PdfInvalidPageRangeException('추출할 수 있는 페이지가 없습니다.');
  }

  return Array.from(pageSet).sort((a, b) => a - b);
}
