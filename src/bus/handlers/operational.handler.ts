import { randomUUID } from 'crypto';
import db from '../../db/connection.js';
import type { EventEnvelope } from '../../common/events.js';
import { MilestoneType, T1EventType } from '../../common/enums.js';
import { OutboxService } from '../outbox.service.js';
import { recordMilestone } from '../../modules/freight/milestones.service.js';
import { specialHandlingGate } from '../../modules/freight/gates/specialHandling.gate.js';
import { AppError } from '../../utils/response.js';

export const operationalEventTypes = new Set(['trucking.order.linked', 'trucking.order.updated', 'wms.event']);
const truckingStatuses = new Set(['draft', 'scheduled', 'en_route', 'collected', 'gate_in',
    'gate_out', 'delivered', 'cancelled']);
const bondedTypes = new Set<string>(Object.values(T1EventType));

function value(p: Record<string, unknown>, key: string): string | undefined {
    return typeof p[key] === 'string' && (p[key] as string).length > 0 ? p[key] as string : undefined;
}
function date(value: string | undefined, fallback: string): Date {
    const parsed = new Date(value || fallback);
    if (Number.isNaN(parsed.getTime())) throw new AppError(422, 'INVALID_EVENT_DATE', 'Event timestamp invalid');
    return parsed;
}

export async function handleOperationalEvent(envelope: EventEnvelope): Promise<void> {
    if (!operationalEventTypes.has(envelope.type) || !envelope.id || !envelope.workspace_id ||
        !envelope.payload || typeof envelope.payload !== 'object') {
        throw new AppError(422, 'INVALID_EVENT', 'Valid event envelope required');
    }
    const p = envelope.payload as Record<string, unknown>;
    try {
        await db.transaction(async (trx) => {
            const prior = await trx('processed_message').where({ message_id: envelope.id }).first();
            if (prior) return;
            let fileId: string;
            if (envelope.type === 'wms.event') {
                fileId = value(p, 'file_id') || '';
                const type = value(p, 'event_type');
                if (!fileId || !type || !bondedTypes.has(type)) {
                    throw new AppError(422, 'INVALID_WMS_EVENT', 'File ID and known bonded event type required');
                }
                const file = await trx('freight_file').where({ id: fileId, workspace_id: envelope.workspace_id })
                    .whereNull('deleted_at').forUpdate().first();
                if (!file) throw new AppError(404, 'FILE_NOT_FOUND', 'WMS file not found in workspace');
                const documentId = value(p, 'document_id');
                if (documentId) {
                    const document = await trx('file_document').where({ id: documentId,
                        freight_file_id: fileId, workspace_id: envelope.workspace_id, doc_type: 't1_document' }).first();
                    if (!document) throw new AppError(422, 'T1_DOCUMENT_NOT_ON_FILE', 'T1 document must belong to file');
                }
                const id = randomUUID();
                await trx('t1_bonded_event').insert({ id, workspace_id: envelope.workspace_id,
                    freight_file_id: fileId, event_type: type,
                    mrn: value(p, 'mrn') || value(p, 'reference_number') || null,
                    bonded_warehouse_ref: value(p, 'bonded_warehouse_ref') || value(p, 'warehouse_code') || null,
                    document_id: documentId || null,
                    occurred_at: date(value(p, 'occurred_at'), envelope.occurred_at),
                    created_by: envelope.actor || 'system', version: 1,
                    created_at: trx.fn.now(), updated_at: trx.fn.now() });
                await OutboxService.enqueue(trx, { workspaceId: envelope.workspace_id,
                    eventType: 'freight.bonded_event.recorded',
                    payload: { event_id: id, file_id: fileId, event_type: type, source_event_id: envelope.id } });
            } else {
                const localId = value(p, 'drayage_order_id') || value(p, 'order_id');
                const orderNumber = value(p, 'order_number');
                const externalId = value(p, 'trucking_order_id');
                if (!localId && !orderNumber && !externalId) {
                    throw new AppError(422, 'INVALID_TRUCKING_EVENT', 'Drayage order ID, order number or Trucking order ID required');
                }
                const lookup = trx('drayage_order').where({ workspace_id: envelope.workspace_id });
                if (localId) lookup.where({ id: localId });
                else if (orderNumber) lookup.where({ order_number: orderNumber });
                else lookup.where({ trucking_order_id: externalId });
                const found = await lookup.first();
                if (!found) throw new AppError(404, 'DRAYAGE_ORDER_NOT_FOUND', 'Trucking event order not found');
                fileId = found.freight_file_id;
                const file = await trx('freight_file').where({ id: fileId, workspace_id: envelope.workspace_id })
                    .whereNull('deleted_at').forUpdate().first();
                if (!file) throw new AppError(404, 'FILE_NOT_FOUND', 'Drayage file not found in workspace');
                if (value(p, 'file_id') && value(p, 'file_id') !== fileId) {
                    throw new AppError(409, 'FILE_MISMATCH', 'Trucking event file does not match order');
                }
                const order = await trx('drayage_order').where({ id: found.id, workspace_id: envelope.workspace_id })
                    .forUpdate().first();
                const updates: Record<string, unknown> = {};
                if (envelope.type === 'trucking.order.linked') {
                    if (!externalId) throw new AppError(422, 'INVALID_TRUCKING_EVENT', 'trucking_order_id required');
                    if (order.trucking_order_id && order.trucking_order_id !== externalId) {
                        throw new AppError(409, 'TRUCKING_LINK_CONFLICT', 'Order already linked to different Trucking order');
                    }
                    updates.trucking_order_id = externalId;
                }
                const status = value(p, 'status');
                if (status) {
                    if (!truckingStatuses.has(status)) throw new AppError(422, 'INVALID_TRUCKING_STATUS', 'Unknown Trucking status');
                    if (order.status === 'cancelled' && status !== 'cancelled') {
                        throw new AppError(409, 'INVALID_STATE', 'Cancelled drayage order cannot be reopened');
                    }
                    updates.status = status;
                }
                for (const field of ['gate_in_at', 'gate_out_at', 'delivered_at',
                    'actual_pickup_at', 'actual_delivery_at'] as const) {
                    const raw = value(p, field);
                    if (raw) updates[field] = date(raw, envelope.occurred_at);
                }
                for (const field of ['pod_signature_ref', 'driver_name', 'truck_plate'] as const) {
                    const raw = value(p, field);
                    if (raw) updates[field] = raw;
                }
                const when = date(value(p, 'occurred_at'), envelope.occurred_at);
                if (status === 'collected') {
                    updates.actual_pickup_at ||= when;
                    await recordMilestone(trx, { workspaceId: envelope.workspace_id, fileId,
                        type: MilestoneType.COLLECTED, timestamp: updates.actual_pickup_at as Date,
                        source: 'trucking', actorId: 'system' });
                }
                if (status === 'gate_in' || updates.gate_in_at) {
                    const containers = await trx('freight_container').where({ freight_file_id: fileId,
                        workspace_id: envelope.workspace_id });
                    const gate = specialHandlingGate(file, { containers });
                    if (!gate.pass) throw new AppError(422, 'SPECIAL_HANDLING_GATE_FAILED', gate.reason || 'Special handling RED', undefined, gate.details);
                    updates.gate_in_at ||= when;
                    if (order.container_id) {
                        const changed = await trx('freight_container').where({ id: order.container_id,
                            freight_file_id: fileId, workspace_id: envelope.workspace_id }).whereNull('gate_in_at')
                            .update({ gate_in_at: updates.gate_in_at, version: trx.raw('version + 1'), updated_at: trx.fn.now() });
                        if (changed) await OutboxService.enqueue(trx, { workspaceId: envelope.workspace_id,
                            eventType: 'freight.container.gated_in', payload: { file_id: fileId,
                                container_id: order.container_id, gate_in_at: (updates.gate_in_at as Date).toISOString() } });
                    }
                }
                if (status === 'gate_out' || updates.gate_out_at) {
                    updates.gate_out_at ||= when;
                    if (order.container_id) await trx('freight_container').where({ id: order.container_id,
                        freight_file_id: fileId, workspace_id: envelope.workspace_id }).whereNull('gate_out_at')
                        .update({ gate_out_at: updates.gate_out_at, version: trx.raw('version + 1'), updated_at: trx.fn.now() });
                }
                if (status === 'delivered') {
                    updates.delivered_at ||= when;
                    updates.actual_delivery_at ||= updates.delivered_at;
                    await recordMilestone(trx, { workspaceId: envelope.workspace_id, fileId,
                        type: MilestoneType.DELIVERED, timestamp: updates.delivered_at as Date,
                        source: 'trucking', actorId: 'system' });
                    if (file.direction === 'import' && file.status === 'Cleared' &&
                        (updates.pod_signature_ref || order.pod_signature_ref)) {
                        const critical = await trx('exception_case').where({ freight_file_id: fileId,
                            workspace_id: envelope.workspace_id, severity: 'critical' })
                            .whereIn('status', ['Open', 'InProgress']).first();
                        if (!critical) {
                            await trx('freight_file').where({ id: fileId, workspace_id: envelope.workspace_id,
                                version: file.version }).update({ status: 'Delivered', version: file.version + 1,
                                    updated_at: trx.fn.now() });
                            await OutboxService.enqueue(trx, { workspaceId: envelope.workspace_id,
                                eventType: 'freight.file.delivered', payload: { file_id: fileId,
                                    file_no: file.file_no, from_status: 'Cleared', to_status: 'Delivered' } });
                        }
                    }
                }
                if (Object.keys(updates).length) await trx('drayage_order').where({ id: order.id,
                    workspace_id: envelope.workspace_id }).update({ ...updates,
                        version: order.version + 1, updated_at: trx.fn.now() });
            }
            await trx('audit_log').insert({ id: randomUUID(), workspace_id: envelope.workspace_id,
                actor_id: envelope.actor || 'system', entity_type: 'freight_file', entity_id: fileId,
                action: envelope.type, payload: JSON.stringify({ event_id: envelope.id }),
                created_at: trx.fn.now() });
            await trx('processed_message').insert({ id: randomUUID(), workspace_id: envelope.workspace_id,
                message_id: envelope.id, event_type: envelope.type, processed_at: trx.fn.now() });
        });
    } catch (error) {
        // Operational gate failures still create a case; rejected event is not marked processed.
        if (error instanceof AppError && error.code === 'SPECIAL_HANDLING_GATE_FAILED') {
            const orderId = value(p, 'drayage_order_id') || value(p, 'order_id');
            const order = orderId ? await db('drayage_order').where({ id: orderId,
                workspace_id: envelope.workspace_id }).first() : null;
            if (order) {
                const existing = await db('exception_case').where({ freight_file_id: order.freight_file_id,
                    workspace_id: envelope.workspace_id, gate_code: 'SPECIAL_HANDLING' })
                    .whereIn('status', ['Open', 'InProgress']).first();
                if (!existing) await db('exception_case').insert({ id: randomUUID(), workspace_id: envelope.workspace_id,
                    freight_file_id: order.freight_file_id, gate_code: 'SPECIAL_HANDLING', type: 'gate_failure',
                    severity: 'warn', status: 'Open', title: 'Special handling gate failed',
                    description: error.message, created_by: 'system', version: 1,
                    created_at: db.fn.now(), updated_at: db.fn.now() });
            }
        }
        throw error;
    }
}
