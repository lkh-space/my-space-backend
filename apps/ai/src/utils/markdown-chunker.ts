import matter from 'gray-matter';

export interface MarkdownChunk {
  chunkIndex: number;
  heading: string;
  content: string;
}

export class MarkdownChunker {
  private static readonly TARGET_CHUNK_SIZE = 700;
  private static readonly MAX_CHUNK_SIZE = 1000;
  private static readonly OVERLAP_SIZE = 100;

  /**
   * 마크다운 텍스트를 의미론적 청크 배열로 분할
   */
  static chunk(rawMarkdown: string): MarkdownChunk[] {
    const parsed = matter(rawMarkdown);
    const content = parsed.content.trim();

    if (!content) {
      return [];
    }

    // 줄 단위로 순회하며 블록과 헤딩 구조 분석
    const lines = content.split('\n');
    const sections: Array<{ heading: string; lines: string[] }> = [];

    let currentHeading = '문서 시작';
    let currentLines: string[] = [];
    let inCodeBlock = false;

    for (const line of lines) {
      // 코드 블록 토글 검사
      if (line.trim().startsWith('```')) {
        inCodeBlock = !inCodeBlock;
      }

      // 코드 블록 내부가 아닐 때의 헤딩 검사
      if (!inCodeBlock && /^#{1,6}\s+/.test(line.trim())) {
        if (currentLines.length > 0) {
          sections.push({ heading: currentHeading, lines: currentLines });
          currentLines = [];
        }
        currentHeading = line.trim();
      }

      currentLines.push(line);
    }

    if (currentLines.length > 0) {
      sections.push({ heading: currentHeading, lines: currentLines });
    }

    // 섹션별로 텍스트를 청크로 분할
    const chunks: MarkdownChunk[] = [];
    let globalIndex = 0;

    for (const section of sections) {
      const sectionText = section.lines.join('\n').trim();
      if (!sectionText) continue;

      if (sectionText.length <= this.MAX_CHUNK_SIZE) {
        chunks.push({
          chunkIndex: globalIndex++,
          heading: section.heading,
          content: sectionText,
        });
      } else {
        // 문단(빈 줄) 단위 분할
        const paragraphs = sectionText.split(/\n\s*\n/);
        let currentChunkText = '';

        for (const p of paragraphs) {
          const trimmedP = p.trim();
          if (!trimmedP) continue;

          if (
            currentChunkText.length + trimmedP.length + 2 >
            this.TARGET_CHUNK_SIZE
          ) {
            if (currentChunkText) {
              chunks.push({
                chunkIndex: globalIndex++,
                heading: section.heading,
                content: currentChunkText.trim(),
              });
              const overlap = currentChunkText.slice(-this.OVERLAP_SIZE);
              currentChunkText = overlap + '\n\n' + trimmedP;
            } else {
              // 단일 문단 자체가 매우 큰 경우 여러 청크로 분할
              let remaining = trimmedP;
              while (remaining.length > this.TARGET_CHUNK_SIZE) {
                const sliceChunk = remaining.slice(0, this.TARGET_CHUNK_SIZE);
                chunks.push({
                  chunkIndex: globalIndex++,
                  heading: section.heading,
                  content: sliceChunk.trim(),
                });
                remaining = remaining.slice(
                  this.TARGET_CHUNK_SIZE - this.OVERLAP_SIZE,
                );
              }
              currentChunkText = remaining;
            }
          } else {
            currentChunkText = currentChunkText
              ? currentChunkText + '\n\n' + trimmedP
              : trimmedP;
          }
        }

        if (currentChunkText.trim()) {
          chunks.push({
            chunkIndex: globalIndex++,
            heading: section.heading,
            content: currentChunkText.trim(),
          });
        }
      }
    }

    return chunks;
  }
}
