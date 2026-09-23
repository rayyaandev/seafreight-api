import { z } from 'zod';
import { DocType } from '../../common/enums.js';

export const OcrUploadBodySchema = z.object({
    file_id: z.string().uuid().optional(),
    doc_type: z.enum([
        DocType.MBL,
        DocType.HBL,
        DocType.BOOKING_CONFIRMATION,
        DocType.ARRIVAL_NOTICE,
        DocType.COMMERCIAL_INVOICE,
        DocType.PACKING_LIST,
        DocType.VGM_CERTIFICATE,
        DocType.DELIVERY_ORDER,
        DocType.T1_DOCUMENT,
        DocType.IMDG_DECLARATION,
        DocType.MSDS,
        DocType.CUSTOMS_RELEASE_DOC,
        DocType.POD_RECEIPT,
        DocType.FILE_COVER,
        DocType.OTHER,
    ]).default(DocType.MBL),
});

export type OcrUploadBody = z.infer<typeof OcrUploadBodySchema>;
