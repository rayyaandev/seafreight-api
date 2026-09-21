import { randomUUID } from 'crypto';
import db from '../../db/connection.js';
import type { EventEnvelope } from '../../common/events.js';

interface WmsEventPayload {
    file_id: string;
    event_type: 't1_open' | 't1_close' | 'inslag' | 'uitslag';
    mrn?: string;
    bonded_warehouse_ref?: string;
    occurred_at?: string;
}

/**
 * Handles `wms.event`:
 * - Inserts a row into the t1_bonded_event table recording bonded warehouse events
 */
export async function handleWmsEvent(envelope: EventEnvelope): Promise<void> {
    const payload = envelope.payload as unknown as WmsEventPayload;
    const { file_id, event_type, mrn, bonded_warehouse_ref, occurred_at } = payload;

    if (!file_id || !event_type) {
        console.warn('[Handler:wms.event] Missing file_id or event_type in payload — skipping');
        return;
    }

    const file = await db('freight_file').where('id', file_id).first();
    if (!file) {
        console.warn(`[Handler:wms.event] Freight file ${file_id} not found — skipping`);
        return;
    }

    await db('t1_bonded_event').insert({
        id: randomUUID(),
        workspace_id: file.workspace_id,
        freight_file_id: file_id,
        event_type,
        mrn: mrn || null,
        bonded_warehouse_ref: bonded_warehouse_ref || null,
        occurred_at: occurred_at ? new Date(occurred_at) : db.fn.now(),
        created_by: envelope.actor || 'system',
        created_at: db.fn.now(),
        updated_at: db.fn.now(),
        version: 1,
    });

    console.log(`[Handler:wms.event] Recorded ${event_type} event for file ${file_id}`);
}
