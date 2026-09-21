import db from '../../db/connection.js';
import type { EventEnvelope, DocumentOcrCompletedPayload } from '../../common/events.js';

/**
 * Handles `document.ocr.completed`:
 * - Updates the file_document row with OCR confidence and extracted data fields
 */
export async function handleDocumentOcr(envelope: EventEnvelope): Promise<void> {
    const payload = envelope.payload as unknown as DocumentOcrCompletedPayload;
    const { document_id, confidence, extracted_fields } = payload;

    if (!document_id) {
        console.warn('[Handler:document.ocr.completed] No document_id in payload — skipping');
        return;
    }

    const doc = await db('file_document').where('id', document_id).first();
    if (!doc) {
        console.warn(`[Handler:document.ocr.completed] Document ${document_id} not found — skipping`);
        return;
    }

    await db('file_document')
        .where('id', document_id)
        .update({
            ocr_confidence: confidence,
            ocr_extracted_data: extracted_fields ? JSON.stringify(extracted_fields) : null,
            updated_at: db.fn.now(),
        });

    console.log(`[Handler:document.ocr.completed] Updated document ${document_id} — confidence: ${confidence}`);
}
