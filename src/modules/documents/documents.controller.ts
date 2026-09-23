import type { Request, Response, NextFunction } from 'express';
import { DocumentsService } from './documents.service.js';
import { sendSuccess, sendError, AppError } from '../../utils/response.js';
import { OcrUploadBodySchema } from './documents.schema.js';

export class DocumentsController {
    /**
     * POST /v1/documents/ocr
     * Upload a document for asynchronous OCR extraction.
     */
    static uploadOcr = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            if (!req.file) {
                sendError(res, 'MISSING_FILE', 'No file was uploaded. Provide multipart form-data with "file" key.', 400);
                return;
            }

            const parsed = OcrUploadBodySchema.safeParse(req.body);
            if (!parsed.success) {
                throw new AppError(422, 'VALIDATION_ERROR', 'Invalid OCR upload parameters', undefined, parsed.error.format());
            }

            const workspaceId = req.context?.workspaceId || '00000000-0000-0000-0000-000000000001';
            const actorId = req.context?.actorId || '00000000-0000-0000-0000-000000000001';

            const { file_id, doc_type } = parsed.data;

            const result = await DocumentsService.initiateOcr({
                fileBuffer: req.file.buffer,
                fileName: req.file.originalname,
                mimeType: req.file.mimetype,
                docType: doc_type,
                fileId: file_id,
                workspaceId,
                actorId,
            });

            sendSuccess(res, result, 202);
        } catch (err) {
            next(err);
        }
    };

    /**
     * GET /v1/documents/jobs/:id
     * Poll the status and extracted data of an OCR job.
     */
    static getJob = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const id = req.params.id as string;
            const job = DocumentsService.getJob(id);
            sendSuccess(res, job, 200);
        } catch (err) {
            next(err);
        }
    };


    /**
     * GET /v1/documents/:id/download
     * Download stored binary from MinIO object storage.
     */
    static downloadDocument = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const workspaceId = req.context?.workspaceId || '00000000-0000-0000-0000-000000000001';
            const id = req.params.id as string;

            const result = await DocumentsService.downloadDocument(id, workspaceId);
            res.setHeader('Content-Type', result.mimeType);
            res.setHeader('Content-Disposition', `attachment; filename="${result.fileName}"`);
            res.status(200).send(result.buffer);
        } catch (err) {
            next(err);
        }
    };
}
