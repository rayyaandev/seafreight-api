import db from '../../db/connection.js';
import type { EventEnvelope, DeclarationAcceptedPayload } from '../../common/events.js';
import { SeaImportStatus } from '../../common/enums.js';

/**
 * Handles `declaration.accepted`:
 * - Updates freight_file.declaration_status to 'accepted' and sets MRN
 * - If container_release_received_at is also set, auto-transitions Arrived → Cleared
 */
export async function handleDeclarationAccepted(envelope: EventEnvelope): Promise<void> {
    const payload = envelope.payload as unknown as DeclarationAcceptedPayload;
    const { file_id, declaration_id, mrn } = payload;

    if (!file_id) {
        console.warn('[Handler:declaration.accepted] No file_id in payload — skipping');
        return;
    }

    const file = await db('freight_file').where('id', file_id).first();
    if (!file) {
        console.warn(`[Handler:declaration.accepted] Freight file ${file_id} not found — skipping`);
        return;
    }

    const updates: Record<string, unknown> = {
        declaration_status: 'accepted',
        updated_at: db.fn.now(),
    };

    if (declaration_id) updates.declaration_id = declaration_id;
    if (mrn) updates.mrn = mrn;

    // Auto-transition: if container release is already received and file is Arrived → Cleared
    if (
        file.status === SeaImportStatus.ARRIVED &&
        file.container_release_received_at
    ) {
        updates.status = SeaImportStatus.CLEARED;
        updates.version = file.version + 1;
        console.log(`[Handler:declaration.accepted] Auto-transitioning file ${file_id} from Arrived → Cleared`);
    } else {
        updates.version = file.version + 1;
    }

    await db('freight_file')
        .where({ id: file_id, version: file.version })
        .update(updates);

    console.log(`[Handler:declaration.accepted] Updated file ${file_id} — declaration_status=accepted, mrn=${mrn || 'unchanged'}`);
}
