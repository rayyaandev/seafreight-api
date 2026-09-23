import { randomUUID } from 'crypto';
import db from '../../db/connection.js';
import { StorageService } from './storage.service.js';
import { getOcrAdapter } from '../../adapters/ocr/index.js';
import { isConnected, publish } from '../../bus/rabbitmq.config.js';
import { handleDocumentOcr } from '../../bus/handlers/documentOcr.handler.js';
import type { DocumentOcrCompletedPayload } from '../../common/events.js';
import { AppError } from '../../utils/response.js';

export interface DocumentOcrJob {
    id: string;
    status: 'queued' | 'processing' | 'completed' | 'failed';
    document_id?: string;
    document_ref_id: string;
    file_id?: string;
    doc_type: string;
    confidence?: number;
    extracted_fields?: Record<string, { value: unknown; confidence: number }>;
    error?: string;
    created_at: string;
    completed_at?: string;
}

// In-memory async job store with auto-cleanup after 1 hour
const jobs = new Map<string, DocumentOcrJob>();

setInterval(() => {
    const oneHourAgo = Date.now() - 3600 * 1000;
    for (const [id, job] of jobs.entries()) {
        if (new Date(job.created_at).getTime() < oneHourAgo) {
            jobs.delete(id);
        }
    }
}, 600_000).unref();

export class DocumentsService {
    /**
     * Accepts a binary file upload, stores it in MinIO object storage,
     * registers it in document_ref and file_document, and launches an
     * asynchronous OCR extraction job.
     */
    static async initiateOcr(params: {
        fileBuffer: Buffer;
        fileName: string;
        mimeType: string;
        docType: string;
        fileId?: string;
        workspaceId: string;
        actorId: string;
    }): Promise<{ job_id: string; status: string; document_ref_id: string; file_id?: string }> {
        const { fileBuffer, fileName, mimeType, docType, fileId, workspaceId, actorId } = params;

        if (!fileBuffer || fileBuffer.length === 0) {
            throw new AppError(400, 'INVALID_FILE', 'Uploaded file buffer is empty');
        }

        // 1. If file_id is provided, verify freight_file exists
        if (fileId) {
            const file = await db('freight_file')
                .where({ id: fileId, workspace_id: workspaceId })
                .first();
            if (!file) {
                throw new AppError(404, 'NOT_FOUND', `Freight dossier '${fileId}' not found`);
            }
        }

        // 2. Upload binary to MinIO/S3 object storage
        const uploadResult = await StorageService.uploadDocument({
            buffer: fileBuffer,
            fileName,
            mimeType,
            workspaceId,
            actorId,
        });

        // 3. Create file_document record if attached to a dossier
        const docId = randomUUID();
        if (fileId) {
            await db('file_document').insert({
                id: docId,
                workspace_id: workspaceId,
                freight_file_id: fileId,
                doc_type: docType,
                file_name: fileName,
                storage_key: uploadResult.storageKey,
                integrity_hash: uploadResult.integrityHash,
                mime_type: mimeType,
                file_size_bytes: fileBuffer.length,
                created_by: actorId,
                created_at: db.fn.now(),
                updated_at: db.fn.now(),
                version: 1,
            });
        }

        // 4. Create OCR Job
        const jobId = randomUUID();
        const job: DocumentOcrJob = {
            id: jobId,
            status: 'processing',
            document_id: fileId ? docId : undefined,
            document_ref_id: uploadResult.documentRefId,
            file_id: fileId,
            doc_type: docType,
            created_at: new Date().toISOString(),
        };
        jobs.set(jobId, job);

        // 5. Asynchronously execute OCR extraction in the background
        setImmediate(async () => {
            try {
                const ocrAdapter = getOcrAdapter();
                const extraction = await ocrAdapter.extract({
                    buffer: fileBuffer,
                    fileName,
                    mimeType,
                    docType,
                });

                // Update job status
                job.status = 'completed';
                job.confidence = extraction.overall_confidence;
                job.extracted_fields = extraction.extracted_fields;
                job.completed_at = new Date().toISOString();

                // Publish document.ocr.completed event to RabbitMQ
                if (fileId) {
                    const eventPayload: DocumentOcrCompletedPayload = {
                        document_id: docId,
                        file_id: fileId,
                        doc_type: docType,
                        confidence: extraction.overall_confidence,
                        extracted_fields: extraction.extracted_fields,
                    };

                    const envelope = {
                        id: randomUUID(),
                        type: 'document.ocr.completed',
                        occurred_at: new Date().toISOString(),
                        workspace_id: workspaceId,
                        actor: actorId,
                        version: 1,
                        payload: eventPayload,
                    };

                    if (isConnected()) {
                        await publish('document.ocr.completed', envelope as unknown as Record<string, unknown>);
                    }
                    await handleDocumentOcr(envelope as any);
                }
            } catch (err: any) {
                console.error(`[DocumentsService] OCR job ${jobId} failed:`, err.message);
                job.status = 'failed';
                job.error = err.message;
                job.completed_at = new Date().toISOString();
            }
        });

        return {
            job_id: jobId,
            status: 'processing',
            document_ref_id: uploadResult.documentRefId,
            file_id: fileId,
        };
    }

    /**
     * Poll the status and extraction payload of an OCR or generation job.
     */
    static getJob(jobId: string): DocumentOcrJob {
        const job = jobs.get(jobId);
        if (!job) {
            throw new AppError(404, 'NOT_FOUND', `Document job '${jobId}' not found`);
        }
        return job;
    }


    /**
     * Download binary document by document ID.
     */
    static async downloadDocument(documentId: string, workspaceId: string): Promise<{ buffer: Buffer; fileName: string; mimeType: string }> {
        // Check file_document first, then document_ref
        const doc = await db('file_document')
            .where({ id: documentId, workspace_id: workspaceId })
            .first();

        const docRef = doc || (await db('document_ref').where({ id: documentId, workspace_id: workspaceId }).first());

        if (!docRef) {
            throw new AppError(404, 'NOT_FOUND', `Document with ID '${documentId}' not found`);
        }

        const buffer = await StorageService.downloadDocument(docRef.storage_key);
        if (!buffer) {
            throw new AppError(404, 'FILE_NOT_FOUND', `Document storage binary for key '${docRef.storage_key}' not found in MinIO`);
        }

        return {
            buffer,
            fileName: docRef.file_name,
            mimeType: docRef.mime_type || 'application/octet-stream',
        };
    }
}
