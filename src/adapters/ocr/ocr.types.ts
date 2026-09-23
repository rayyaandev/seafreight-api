export interface OcrField<T = unknown> {
    value: T;
    confidence: number; // 0.0 to 1.0
    bounding_box?: number[];
}

export interface OcrExtractionResult {
    doc_type: string;
    overall_confidence: number;
    extracted_fields: Record<string, { value: any; confidence: number }>;
    raw_text?: string;
}

export interface OcrExtractOptions {
    buffer: Buffer;
    fileName: string;
    mimeType: string;
    docType: string;
}

export interface OcrAdapter {
    extract(options: OcrExtractOptions): Promise<OcrExtractionResult>;
}
