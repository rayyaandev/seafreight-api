import db from '../../db/connection.js';
import { PublishedEvents, type EventEnvelope } from '../../common/events.js';
import type { FreightFileEntity, FreightContainerEntity } from '../../common/types.js';
import { specialHandlingGate } from '../../modules/freight/gates/specialHandling.gate.js';
import { FreightRepository } from '../../modules/freight/freight.repository.js';
import { GateCode } from '../../common/enums.js';
import { AppError } from '../../utils/response.js';
import { OutboxService } from '../outbox.service.js';
import { AuditService } from '../../modules/audit/audit.service.js';

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
        ? db('drayage_order').where('id', order_id).where('workspace_id', envelope.workspace_id)
        : db('drayage_order').where('order_number', order_number).where('workspace_id', envelope.workspace_id);

    const order = await query.first();
    if (!order) {
        console.warn(`[Handler:trucking.order.updated] Drayage order '${identifier}' not found — skipping`);
        return;
    }

    const isGateIn = Boolean(payload.gate_in_at) || /^gate[-_ ]?in$/i.test(status);
    try {
        await db.transaction(async (trx) => {
            if (isGateIn) {
                // Lock the parent file; evidence updates also bump its version in a transaction.
                const file = await trx<FreightFileEntity>('freight_file')
                    .where({ id: order.freight_file_id, workspace_id: envelope.workspace_id })
                    .whereNull('deleted_at').forUpdate().first();
                if (!file) throw new Error(`Freight file for drayage order '${identifier}' not found`);
                const containers = await trx<FreightContainerEntity>('freight_container')
                    .where({ freight_file_id: file.id, workspace_id: envelope.workspace_id });
                const gate = specialHandlingGate(file, { containers });
                if (!gate.pass) {
                    throw new AppError(422, 'SPECIAL_HANDLING_GATE_FAILED', gate.reason || 'Special handling RED', undefined, gate.details);
                }
                await trx('freight_file').where({ id: file.id, workspace_id: envelope.workspace_id, version: file.version })
                    .update({ version: file.version + 1, updated_at: trx.fn.now() });
                if (order.container_id) {
                    const gateInAt = payload.gate_in_at ? new Date(payload.gate_in_at) : new Date();
                    const affected = await trx('freight_container')
                        .where({ id: order.container_id, freight_file_id: file.id, workspace_id: envelope.workspace_id })
                        .whereNull('gate_in_at')
                        .update({ gate_in_at: gateInAt, version: trx.raw('version + 1'), updated_at: trx.fn.now() });
                    if (affected) {
                        await OutboxService.enqueue(trx, {
                            workspaceId: envelope.workspace_id,
                            eventType: PublishedEvents.CONTAINER_GATED_IN,
                            payload: { file_id: file.id, container_id: order.container_id, gate_in_at: gateInAt.toISOString() },
                        });
                    }
                }
            }

            const updates: Record<string, unknown> = { status, updated_at: trx.fn.now() };
            if (isGateIn) updates.gate_in_at = payload.gate_in_at ? new Date(payload.gate_in_at) : new Date();
            if (payload.gate_out_at) updates.gate_out_at = new Date(payload.gate_out_at);
            if (payload.delivered_at) updates.delivered_at = new Date(payload.delivered_at);
            if (payload.pod_signature_ref) updates.pod_signature_ref = payload.pod_signature_ref;
            await trx('drayage_order').where({ id: order.id, workspace_id: envelope.workspace_id }).update(updates);
        });
    } catch (error) {
        if (error instanceof AppError && error.code === 'SPECIAL_HANDLING_GATE_FAILED') {
            const existing = await db('exception_case')
                .where({ freight_file_id: order.freight_file_id, workspace_id: envelope.workspace_id, gate_code: GateCode.SPECIAL_HANDLING })
                .whereIn('status', ['Open', 'InProgress']).first();
            if (!existing) {
                await FreightRepository.createException({
                    workspace_id: envelope.workspace_id,
                    freight_file_id: order.freight_file_id,
                    gate_code: GateCode.SPECIAL_HANDLING,
                    type: 'gate_failure', severity: 'warn', status: 'Open',
                    title: 'Special handling gate failed',
                    description: JSON.stringify({ reason: error.message, details: error.details }),
                    created_by: envelope.actor,
                });
            }
        }
        throw error;
    }

    if (isGateIn) {
        await AuditService.log({
            workspaceId: envelope.workspace_id,
            actorId: envelope.actor,
            entityType: order.container_id ? 'container' : 'drayage_order',
            entityId: order.container_id || order.id,
            action: 'gate_in',
            payload: { freight_file_id: order.freight_file_id, order_id: order.id, gate_in_at: payload.gate_in_at || null },
        });
    }

    console.log(`[Handler:trucking.order.updated] Updated drayage order ${order.order_number} → status: ${status}`);
}
