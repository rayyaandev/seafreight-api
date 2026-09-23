import type { OcrAdapter, OcrExtractOptions, OcrExtractionResult } from './ocr.types.js';

export class HttpOcrAdapter implements OcrAdapter {
    constructor(
        private readonly apiUrl: string = process.env.OCR_API_URL || 'https://api.ocr-provider.com/v1/extract',
        private readonly apiKey: string = process.env.OCR_API_KEY || ''
    ) {}

    async extract(options: OcrExtractOptions): Promise<OcrExtractionResult> {
        if (!this.apiKey) {
            throw new Error('[HttpOcrAdapter] OCR_API_KEY is not configured. Use MockOcrAdapter in development.');
        }

        const formData = new FormData();
        const blob = new Blob([new Uint8Array(options.buffer)], { type: options.mimeType });
        formData.append('file', blob, options.fileName);
        formData.append('document_type', options.docType);

        const response = await fetch(this.apiUrl, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${this.apiKey}`,
            },
            body: formData,
        });

        if (!response.ok) {
            throw new Error(`[HttpOcrAdapter] External OCR API returned ${response.status}: ${await response.text()}`);
        }

        const data = (await response.json()) as any;
        return {
            doc_type: options.docType,
            overall_confidence: data.confidence || 0.90,
            extracted_fields: data.fields || {},
            raw_text: data.text,
        };
    }
}
