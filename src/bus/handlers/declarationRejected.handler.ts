import { randomUUID } from 'crypto';
import db from '../../db/connection.js';
import type { EventEnvelope, DeclarationRejectedPayload } from '../../common/events.js';

/**
 * Handles `declaration.rejected` and `declaration.under_control`:
 * - Updates freight_file.declaration_status accordingly
 * - Opens an exception_case to notify the operations team
 */
export async function handleDeclarationRejected(envelope: EventEnvelope): Promise<void> {
    const payload = envelope.payload as unknown as DeclarationRejectedPayload;
    const { file_id, declaration_id, rejection_reason, mrn } = payload;

    if (!file_id) {
        console.warn('[Handler:declaration.rejected] No file_id in payload — skipping');
        return;
    }

    const file = await db('freight_file').where('id', file_id).first();
    if (!file) {
        console.warn(`[Handler:declaration.rejected] Freight file ${file_id} not found — skipping`);
        return;
    }

    const isRejected = envelope.type === 'declaration.rejected';
    const newStatus = isRejected ? 'rejected' : 'under_control';
    const severity = isRejected ? 'warn' : 'info';

    // Update declaration status on the file
    await db('freight_file')
        .where({ id: file_id, version: file.version })
        .update({
            declaration_status: newStatus,
            declaration_id: declaration_id || file.declaration_id,
            mrn: mrn || file.mrn,
            version: file.version + 1,
            updated_at: db.fn.now(),
        });

    // Open an exception case
    await db('exception_case').insert({
        id: randomUUID(),
        workspace_id: file.workspace_id,
        freight_file_id: file_id,
        gate_code: 'CUSTOMS_RELEASE',
        type: isRejected ? 'customs_rejection' : 'customs_under_control',
        severity,
        status: 'Open',
        title: isRejected
            ? `Customs declaration rejected: ${rejection_reason || 'No reason provided'}`
            : `Customs declaration placed under control`,
        description: isRejected
            ? `Declaration ${declaration_id || file.declaration_id} was rejected by customs. Reason: ${rejection_reason || 'N/A'}.`
            : `Declaration ${declaration_id || file.declaration_id} has been flagged for customs control inspection.`,
        created_by: 'system',
        created_at: db.fn.now(),
        updated_at: db.fn.now(),
        version: 1,
    });

    console.log(`[Handler:declaration.${newStatus}] Updated file ${file_id} — exception case opened (severity: ${severity})`);
}
