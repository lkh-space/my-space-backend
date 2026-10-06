import { describe, it, expect } from 'vitest';
import { parsePageRanges } from './page-range.parser.js';
import { PdfInvalidPageRangeException } from '../exceptions/pdf.exception.js';

describe('PageRangeParser (단위 테스트)', () => {
  it('정상적인 쉼표 및 하이픈 범위 문자열을 정렬된 고유 페이지 배열로 파싱한다', () => {
    // given
    const rangeStr = '1-3, 5, 2, 8-10';
    const totalPages = 15;

    // when
    const result = parsePageRanges(rangeStr, totalPages);

    // then
    expect(result).toEqual([1, 2, 3, 5, 8, 9, 10]);
  });

  it('단일 페이지 번호들만 나열된 경우 올바르게 파싱한다', () => {
    // given
    const rangeStr = '3, 1, 4';
    const totalPages = 5;

    // when
    const result = parsePageRanges(rangeStr, totalPages);

    // then
    expect(result).toEqual([1, 3, 4]);
  });

  it('빈 문자열이거나 공백만 있는 경우 PdfInvalidPageRangeException 예외를 던진다', () => {
    // given
    const emptyRange = '   ';
    const totalPages = 10;

    // when & then
    expect(() => parsePageRanges(emptyRange, totalPages)).toThrow(
      PdfInvalidPageRangeException,
    );
  });

  it('페이지 번호가 전체 페이지 수를 초과하는 경우 PdfInvalidPageRangeException 예외를 던진다', () => {
    // given
    const rangeStr = '1-5, 12';
    const totalPages = 10;

    // when & then
    expect(() => parsePageRanges(rangeStr, totalPages)).toThrow(
      PdfInvalidPageRangeException,
    );
  });

  it('시작 페이지가 끝 페이지보다 큰 경우(역순 범위) PdfInvalidPageRangeException 예외를 던진다', () => {
    // given
    const invalidRange = '5-2';
    const totalPages = 10;

    // when & then
    expect(() => parsePageRanges(invalidRange, totalPages)).toThrow(
      PdfInvalidPageRangeException,
    );
  });

  it('0 이하의 페이지 번호가 포함된 경우 PdfInvalidPageRangeException 예외를 던진다', () => {
    // given
    const invalidRange = '0-3';
    const totalPages = 10;

    // when & then
    expect(() => parsePageRanges(invalidRange, totalPages)).toThrow(
      PdfInvalidPageRangeException,
    );
  });

  it('숫자가 아닌 문자열이 포함된 경우 PdfInvalidPageRangeException 예외를 던진다', () => {
    // given
    const invalidRange = '1-3, abc';
    const totalPages = 10;

    // when & then
    expect(() => parsePageRanges(invalidRange, totalPages)).toThrow(
      PdfInvalidPageRangeException,
    );
  });
});
