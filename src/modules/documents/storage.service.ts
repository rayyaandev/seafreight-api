import { S3Client, PutObjectCommand, GetObjectCommand, HeadBucketCommand, CreateBucketCommand } from '@aws-sdk/client-s3';
import { createHash, randomUUID } from 'crypto';
import path from 'path';
import db from '../../db/connection.js';

export interface UploadOptions {
    buffer: Buffer;
    fileName: string;
    mimeType: string;
    workspaceId: string;
    actorId: string;
}

export interface UploadResult {
    documentRefId: string;
    storageKey: string;
    integrityHash: string;
    fileSizeBytes: number;
    fileName: string;
    mimeType: string;
}

const BUCKET_NAME = process.env.S3_BUCKET || 'seafreight-documents';

const s3Client = new S3Client({
    endpoint: process.env.S3_ENDPOINT || 'http://127.0.0.1:9000',
    region: 'us-east-1',
    credentials: {
        accessKeyId: process.env.S3_KEY || 'minioadmin',
        secretAccessKey: process.env.S3_SECRET || 'minioadmin',
    },
    forcePathStyle: true,
});

let bucketInitialized = false;

export class StorageService {
    /**
     * Ensures bucket exists in MinIO/S3.
     */
    static async ensureBucketExists(): Promise<void> {
        if (bucketInitialized) return;

        try {
            await s3Client.send(new HeadBucketCommand({ Bucket: BUCKET_NAME }));
            bucketInitialized = true;
        } catch (err: any) {
            if (err.name === 'NotFound' || err.$metadata?.httpStatusCode === 404) {
                try {
                    await s3Client.send(new CreateBucketCommand({ Bucket: BUCKET_NAME }));
                    bucketInitialized = true;
                    console.log(`[Storage] Created S3/MinIO bucket '${BUCKET_NAME}'`);
                } catch (createErr) {
                    console.warn(`[Storage] Could not create bucket '${BUCKET_NAME}':`, createErr);
                }
            } else {
                console.warn('[Storage] HeadBucket check failed (will continue):', err.message);
            }
        }
    }

    /**
     * Upload binary document to MinIO/S3 and record entry in document_ref table.
     */
    static async uploadDocument(options: UploadOptions): Promise<UploadResult> {
        const { buffer, fileName, mimeType, workspaceId, actorId } = options;

        await this.ensureBucketExists();

        // 1. Calculate SHA-256 integrity hash
        const integrityHash = createHash('sha256').update(buffer).digest('hex');

        // 2. Generate unique storage key
        const ext = path.extname(fileName) || '';
        const datePrefix = new Date().toISOString().slice(0, 10);
        const storageKey = `${workspaceId}/${datePrefix}/${randomUUID()}${ext}`;

        // 3. Upload object to S3 / MinIO
        try {
            await s3Client.send(
                new PutObjectCommand({
                    Bucket: BUCKET_NAME,
                    Key: storageKey,
                    Body: buffer,
                    ContentType: mimeType,
                })
            );
        } catch (s3Err: any) {
            console.warn('[Storage] MinIO upload error (recording DB ref):', s3Err.message);
        }

        // 4. Record document_ref in database
        const documentRefId = randomUUID();
        await db('document_ref').insert({
            id: documentRefId,
            workspace_id: workspaceId,
            storage_key: storageKey,
            integrity_hash: integrityHash,
            file_name: fileName,
            mime_type: mimeType,
            file_size_bytes: buffer.length,
            created_by: actorId,
            created_at: db.fn.now(),
        });

        return {
            documentRefId,
            storageKey,
            integrityHash,
            fileSizeBytes: buffer.length,
            fileName,
            mimeType,
        };
    }

    /**
     * Download document buffer from S3/MinIO by storage key.
     */
    static async downloadDocument(storageKey: string): Promise<Buffer | null> {
        try {
            const response = await s3Client.send(
                new GetObjectCommand({
                    Bucket: BUCKET_NAME,
                    Key: storageKey,
                })
            );

            if (!response.Body) return null;
            const byteArray = await response.Body.transformToByteArray();
            return Buffer.from(byteArray);
        } catch (err: any) {
            console.error(`[Storage] Failed to download key '${storageKey}':`, err.message);
            return null;
        }
    }
}
