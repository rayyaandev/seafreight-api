import db from '../../db/connection.js';
import type { EventEnvelope } from '../../common/events.js';

interface TruckingStatusPayload {
    order_number?: string;
    order_id?: string;
    status: string;
    gate_in_at?: string;
    gate_out_at?: string;
    delivered_at?: string;
    pod_signature_ref?: string;
}

/**
 * Handles `trucking.order.updated`:
 * - Updates the matching drayage_order status and timestamps
 */
export async function handleTruckingStatus(envelope: EventEnvelope): Promise<void> {
    const payload = envelope.payload as unknown as TruckingStatusPayload;
    const { order_number, order_id, status } = payload;

    const identifier = order_id || order_number;
    if (!identifier) {
        console.warn('[Handler:trucking.order.updated] No order_number or order_id in payload — skipping');
        return;
    }

    const query = order_id
        ? db('drayage_order').where('id', order_id)
        : db('drayage_order').where('order_number', order_number);

    const order = await query.first();
    if (!order) {
        console.warn(`[Handler:trucking.order.updated] Drayage order '${identifier}' not found — skipping`);
        return;
    }

    const updates: Record<string, unknown> = {
        status,
        updated_at: db.fn.now(),
    };

    if (payload.gate_in_at) updates.gate_in_at = new Date(payload.gate_in_at);
    if (payload.gate_out_at) updates.gate_out_at = new Date(payload.gate_out_at);
    if (payload.delivered_at) updates.delivered_at = new Date(payload.delivered_at);
    if (payload.pod_signature_ref) updates.pod_signature_ref = payload.pod_signature_ref;

    await db('drayage_order')
        .where('id', order.id)
        .update(updates);

    console.log(`[Handler:trucking.order.updated] Updated drayage order ${order.order_number} → status: ${status}`);
}
