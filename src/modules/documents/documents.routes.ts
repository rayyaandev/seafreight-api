import { Router } from 'express';
import multer from 'multer';
import { DocumentsController } from './documents.controller.js';
import { requirePermission } from '../../middleware/rbac.js';

export const documentsRouter = Router();

const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 15 * 1024 * 1024, // 15MB max file size
    },
});


// POST /v1/documents/ocr - Upload file for asynchronous OCR processing
documentsRouter.post(
    '/ocr',
    upload.single('file'),
    requirePermission('freight.file.read'),
    DocumentsController.uploadOcr
);

// GET /v1/documents/jobs/:id - Poll status of an async OCR job
documentsRouter.get(
    '/jobs/:id',
    requirePermission('freight.file.read'),
    DocumentsController.getJob
);


// GET /v1/documents/:id/download - Download stored binary from MinIO
documentsRouter.get(
    '/:id/download',
    requirePermission('freight.file.read'),
    DocumentsController.downloadDocument
);
