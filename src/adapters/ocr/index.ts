import type { OcrAdapter } from './ocr.types.js';
import { MockOcrAdapter } from './mockOcr.service.js';
import { HttpOcrAdapter } from './httpOcr.service.js';

export * from './ocr.types.js';
export * from './mockOcr.service.js';
export * from './httpOcr.service.js';

let activeAdapter: OcrAdapter | null = null;

export function getOcrAdapter(): OcrAdapter {
    if (activeAdapter) return activeAdapter;

    const provider = (process.env.OCR_ADAPTER || 'mock').toLowerCase();
    if (provider === 'http') {
        activeAdapter = new HttpOcrAdapter();
    } else {
        activeAdapter = new MockOcrAdapter();
    }

    return activeAdapter;
}

export function setOcrAdapter(adapter: OcrAdapter): void {
    activeAdapter = adapter;
}
