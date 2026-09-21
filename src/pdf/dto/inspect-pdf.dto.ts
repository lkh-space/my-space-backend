export interface InspectPdfResponseDto {
  isEncrypted: boolean;
  isPasswordValid?: boolean;
  pageCount?: number;
  metadata?: {
    title?: string;
    author?: string;
    creator?: string;
    producer?: string;
    creationDate?: Date;
    modificationDate?: Date;
  };
}

export class InspectPdfDto {
  password?: string;
}
