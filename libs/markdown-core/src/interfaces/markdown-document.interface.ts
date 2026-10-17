export interface CreateMarkdownDocumentParams {
  title: string;
  content: string;
  folderId?: string | null;
  tags?: string[];
  frontmatter?: Record<string, unknown>;
}

export interface CreatedMarkdownDocumentResult {
  id: string;
  title: string;
  folderId: string | null;
  folderName?: string | null;
  tags: string[];
  objectKey: string;
  currentVersion: number;
  updatedAt: Date;
  createdAt: Date;
}
