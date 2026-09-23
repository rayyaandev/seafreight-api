import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Server } from 'http';
import { createApp } from '../src/app.js';
import { seedDatabase } from '../src/db/seeds/01_sea_freight_seed.js';
import db from '../src/db/connection.js';

// Helper to parse JSON from fetch Response
const json = (res: Response): Promise<any> => res.json();

const PORT = 4996;
const baseUrl = `http://localhost:${PORT}`;

let server: Server;
let authHeaders: Record<string, string>;
let coordinatorToken: string;

beforeAll(async () => {
    await seedDatabase();
    const app = createApp();
    server = app.listen(PORT);

    // Login as Sea Freight Coordinator
    const loginRes = await fetch(`${baseUrl}/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            email: 'coordinator@yourcargocontact.com',
            password: 'Password123!',
        }),
    });
    const loginData = await json(loginRes);
    coordinatorToken = loginData.data.access_token;
    authHeaders = {
        Authorization: `Bearer ${coordinatorToken}`,
    };
});

afterAll(async () => {
    server?.close();
});

describe('Import Document Storage & OCR Pipeline (/v1/documents)', () => {
    // ── 1. Authentication & Guard Checks ──────────────────────────────────
    describe('1. Authentication & Guard Checks', () => {
        it('POST /v1/documents/ocr without auth returns 401 UNAUTHORIZED', async () => {
            const formData = new FormData();
            formData.append('file', new Blob(['dummy'], { type: 'text/plain' }), 'test.txt');

            const res = await fetch(`${baseUrl}/v1/documents/ocr`, {
                method: 'POST',
                body: formData,
            });

            expect(res.status).toBe(401);
            const body = await json(res);
            expect(body.error.code).toBe('UNAUTHORIZED');
        });

        it('GET /v1/documents/jobs/:id without auth returns 401 UNAUTHORIZED', async () => {
            const res = await fetch(`${baseUrl}/v1/documents/jobs/test-job-id`);
            expect(res.status).toBe(401);
            const body = await json(res);
            expect(body.error.code).toBe('UNAUTHORIZED');
        });

        it('GET /v1/documents/:id/download without auth returns 401 UNAUTHORIZED', async () => {
            const res = await fetch(`${baseUrl}/v1/documents/test-id/download`);
            expect(res.status).toBe(401);
            const body = await json(res);
            expect(body.error.code).toBe('UNAUTHORIZED');
        });
    });

    // ── 2. Payload Validation ─────────────────────────────────────────────
    describe('2. Payload Validation', () => {
        it('POST /v1/documents/ocr with missing file returns 400 MISSING_FILE', async () => {
            const formData = new FormData();
            formData.append('doc_type', 'mbl');

            const res = await fetch(`${baseUrl}/v1/documents/ocr`, {
                method: 'POST',
                headers: authHeaders,
                body: formData,
            });

            expect(res.status).toBe(400);
            const body = await json(res);
            expect(body.error.code).toBe('MISSING_FILE');
        });

        it('POST /v1/documents/ocr with invalid doc_type returns 422 VALIDATION_ERROR', async () => {
            const formData = new FormData();
            formData.append('file', new Blob(['fake content'], { type: 'text/plain' }), 'document.txt');
            formData.append('doc_type', 'invalid_doc_type_foo');

            const res = await fetch(`${baseUrl}/v1/documents/ocr`, {
                method: 'POST',
                headers: authHeaders,
                body: formData,
            });

            expect(res.status).toBe(422);
            const body = await json(res);
            expect(body.error.code).toBe('VALIDATION_ERROR');
        });

        it('POST /v1/documents/ocr with non-existent file_id returns 404 NOT_FOUND', async () => {
            const formData = new FormData();
            formData.append('file', new Blob(['fake content'], { type: 'text/plain' }), 'mbl.pdf');
            formData.append('file_id', 'e0000000-0000-4000-8000-000000000000');
            formData.append('doc_type', 'mbl');

            const res = await fetch(`${baseUrl}/v1/documents/ocr`, {
                method: 'POST',
                headers: authHeaders,
                body: formData,
            });

            expect(res.status).toBe(404);
            const body = await json(res);
            expect(body.error.code).toBe('NOT_FOUND');
        });
    });

    // ── 3. Standalone Document OCR Upload & Polling ───────────────────────
    describe('3. Standalone Document Upload, Storage & Async OCR Polling', () => {
        let jobId: string;
        let documentRefId: string;
        const sampleContent = 'INVOICE 2026-90234 TOTAL EUR 45000 FOB ROTTERDAM TECH';

        it('POST /v1/documents/ocr returns 202 with job_id and document_ref_id', async () => {
            const formData = new FormData();
            formData.append('file', new Blob([sampleContent], { type: 'text/plain' }), 'INV-2026-90234.txt');
            formData.append('doc_type', 'commercial_invoice');

            const res = await fetch(`${baseUrl}/v1/documents/ocr`, {
                method: 'POST',
                headers: authHeaders,
                body: formData,
            });

            expect(res.status).toBe(202);
            const body = await json(res);
            expect(body.data).toBeDefined();
            expect(body.data.job_id).toBeDefined();
            expect(body.data.status).toBe('processing');
            expect(body.data.document_ref_id).toBeDefined();

            jobId = body.data.job_id;
            documentRefId = body.data.document_ref_id;
        });

        it('Stores object metadata and integrity hash in document_ref table', async () => {
            const docRef = await db('document_ref').where('id', documentRefId).first();
            expect(docRef).toBeDefined();
            expect(docRef.file_name).toBe('INV-2026-90234.txt');
            expect(docRef.storage_key).toContain('.txt');
            expect(docRef.file_size_bytes).toBe(sampleContent.length);
        });

        it('GET /v1/documents/jobs/:id polls until OCR completes and returns extracted data', async () => {
            // Poll for async job completion (mock has 50ms simulated delay)
            let completed = false;
            let jobData: any = null;

            for (let attempt = 0; attempt < 20; attempt++) {
                await new Promise((resolve) => setTimeout(resolve, 30));
                const res = await fetch(`${baseUrl}/v1/documents/jobs/${jobId}`, {
                    headers: authHeaders,
                });
                expect(res.status).toBe(200);
                const body = await json(res);

                if (body.data.status === 'completed') {
                    completed = true;
                    jobData = body.data;
                    break;
                }
            }

            expect(completed).toBe(true);
            expect(jobData.doc_type).toBe('commercial_invoice');
            expect(jobData.confidence).toBeGreaterThan(0.8);
            expect(jobData.extracted_fields).toBeDefined();
            expect(jobData.extracted_fields.invoice_number.value).toContain('INV');
            expect(jobData.extracted_fields.total_amount.value).toBe(84500);
            expect(jobData.extracted_fields.currency.value).toBe('EUR');
        });

        it('GET /v1/documents/:id/download downloads binary buffer from MinIO', async () => {
            const res = await fetch(`${baseUrl}/v1/documents/${documentRefId}/download`, {
                headers: authHeaders,
            });

            expect(res.status).toBe(200);
            expect(res.headers.get('content-disposition')).toContain('INV-2026-90234.txt');
            const downloadedText = await res.text();
            expect(downloadedText).toBe(sampleContent);
        });
    });

    // ── 4. Dossier-Attached OCR & Event Ingestion ─────────────────────────
    describe('4. Dossier-Attached OCR, file_document Linking & Event Emission', () => {
        let targetFile: any;
        let jobId: string;
        let documentRefId: string;

        beforeAll(async () => {
            // Grab seeded active dossier SF-2026-00001
            targetFile = await db('freight_file').where('file_no', 'SF-2026-00001').first();
            expect(targetFile).toBeDefined();
        });

        it('POST /v1/documents/ocr with file_id links document to dossier and starts OCR', async () => {
            const formData = new FormData();
            const fakeMblPdf = '%PDF-1.4 Mock Ocean Bill of Lading MSCU98234190 Port of Loading NLRTM';
            formData.append('file', new Blob([fakeMblPdf], { type: 'application/pdf' }), 'BL-MSCU98234190.pdf');
            formData.append('doc_type', 'mbl');
            formData.append('file_id', targetFile.id);

            const res = await fetch(`${baseUrl}/v1/documents/ocr`, {
                method: 'POST',
                headers: authHeaders,
                body: formData,
            });

            expect(res.status).toBe(202);
            const body = await json(res);
            expect(body.data).toBeDefined();
            expect(body.data.file_id).toBe(targetFile.id);

            jobId = body.data.job_id;
            documentRefId = body.data.document_ref_id;
        });

        it('OCR worker finishes and updates file_document table with confidence & extracted JSON', async () => {
            // Poll job until completed
            let completed = false;
            let job: any = null;

            for (let i = 0; i < 20; i++) {
                await new Promise((resolve) => setTimeout(resolve, 30));
                const res = await fetch(`${baseUrl}/v1/documents/jobs/${jobId}`, {
                    headers: authHeaders,
                });
                const body = await json(res);
                if (body.data.status === 'completed') {
                    completed = true;
                    job = body.data;
                    break;
                }
            }

            expect(completed).toBe(true);
            expect(job.extracted_fields.bl_number.value).toBe('MSCU98234190');
            expect(job.extracted_fields.vessel_name.value).toBe('MSC ISABELLA');
            expect(job.extracted_fields.seal_number.confidence).toBeLessThan(0.75); // Low-confidence flag for operator verification

            // Verify file_document row in database
            const fileDoc = await db('file_document')
                .where({ freight_file_id: targetFile.id, doc_type: 'mbl' })
                .orderBy('created_at', 'desc')
                .first();

            expect(fileDoc).toBeDefined();
            expect(fileDoc.file_name).toBe('BL-MSCU98234190.pdf');
            expect(fileDoc.ocr_confidence).toBeGreaterThan(0.9);

            const extractedInDb = JSON.parse(fileDoc.ocr_extracted_data);
            expect(extractedInDb.bl_number.value).toBe('MSCU98234190');
            expect(extractedInDb.vessel_name.value).toBe('MSC ISABELLA');
            expect(extractedInDb.port_of_loading.value).toBe('NLRTM');

            // Verify download by file_document ID as well
            const dlRes = await fetch(`${baseUrl}/v1/documents/${fileDoc.id}/download`, {
                headers: authHeaders,
            });
            expect(dlRes.status).toBe(200);
            expect(dlRes.headers.get('content-type')).toContain('application/pdf');
        });
    });

    // ── 5. Multi-type Import Extractions ──────────────────────────────────
    describe('5. Multi-type Import Extractions (Arrival Notice, IMDG, T1)', () => {
        it('Extracts Arrival Notice with demurrage rate & terminal name', async () => {
            const formData = new FormData();
            formData.append('file', new Blob(['Arrival Notice Content'], { type: 'application/pdf' }), 'Arrival_Notice_MADRID_MAERSK.pdf');
            formData.append('doc_type', 'arrival_notice');

            const uploadRes = await fetch(`${baseUrl}/v1/documents/ocr`, {
                method: 'POST',
                headers: authHeaders,
                body: formData,
            });
            const uploadBody = await json(uploadRes);

            // Wait for extraction
            await new Promise((resolve) => setTimeout(resolve, 100));

            const jobRes = await fetch(`${baseUrl}/v1/documents/jobs/${uploadBody.data.job_id}`, {
                headers: authHeaders,
            });
            const jobBody = await json(jobRes);

            expect(jobBody.data.status).toBe('completed');
            expect(jobBody.data.extracted_fields.terminal_name.value).toBe('APM Terminals Maasvlakte II');
            expect(jobBody.data.extracted_fields.demurrage_daily_rate.confidence).toBeLessThan(0.75); // Low-confidence flag
        });

        it('Extracts IMDG Declaration with UN number and hazard class', async () => {
            const formData = new FormData();
            formData.append('file', new Blob(['IMDG dangerous goods declaration'], { type: 'application/pdf' }), 'IMDG_Dec_UN1993.pdf');
            formData.append('doc_type', 'imdg_declaration');

            const uploadRes = await fetch(`${baseUrl}/v1/documents/ocr`, {
                method: 'POST',
                headers: authHeaders,
                body: formData,
            });
            const uploadBody = await json(uploadRes);

            // Wait for extraction
            await new Promise((resolve) => setTimeout(resolve, 100));

            const jobRes = await fetch(`${baseUrl}/v1/documents/jobs/${uploadBody.data.job_id}`, {
                headers: authHeaders,
            });
            const jobBody = await json(jobRes);

            expect(jobBody.data.status).toBe('completed');
            expect(jobBody.data.extracted_fields.un_number.value).toBe('1993');
            expect(jobBody.data.extracted_fields.hazard_class.value).toBe('3');
            expect(jobBody.data.extracted_fields.packing_group.value).toBe('II');
        });

        it('Extracts T1 Transit Document with MRN and departure office', async () => {
            const formData = new FormData();
            formData.append('file', new Blob(['T1 Transit customs document'], { type: 'application/pdf' }), 'T1_Customs_Doc.pdf');
            formData.append('doc_type', 't1_document');

            const uploadRes = await fetch(`${baseUrl}/v1/documents/ocr`, {
                method: 'POST',
                headers: authHeaders,
                body: formData,
            });
            const uploadBody = await json(uploadRes);

            // Wait for extraction
            await new Promise((resolve) => setTimeout(resolve, 100));

            const jobRes = await fetch(`${baseUrl}/v1/documents/jobs/${uploadBody.data.job_id}`, {
                headers: authHeaders,
            });
            const jobBody = await json(jobRes);

            expect(jobBody.data.status).toBe('completed');
            expect(jobBody.data.extracted_fields.mrn.value).toContain('26NL');
            expect(jobBody.data.extracted_fields.customs_office_departure.value).toContain('NL000100');
        });
    });

    // ── 6. Error Cases ───────────────────────────────────────────────────
    describe('6. Error Cases', () => {
        it('GET /v1/documents/jobs/:id with non-existent job returns 404 NOT_FOUND', async () => {
            const res = await fetch(`${baseUrl}/v1/documents/jobs/non-existent-id-1234`, {
                headers: authHeaders,
            });
            expect(res.status).toBe(404);
            const body = await json(res);
            expect(body.error.code).toBe('NOT_FOUND');
        });

        it('GET /v1/documents/:id/download with non-existent document returns 404 NOT_FOUND', async () => {
            const res = await fetch(`${baseUrl}/v1/documents/00000000-0000-0000-0000-000000000000/download`, {
                headers: authHeaders,
            });
            expect(res.status).toBe(404);
            const body = await json(res);
            expect(body.error.code).toBe('NOT_FOUND');
        });
    });
});
