import { randomUUID } from 'crypto';
import db from '../../db/connection.js';
import type { EventEnvelope } from '../../common/events.js';
import { OutboxService } from '../outbox.service.js';
import { blReleaseGate } from '../../modules/freight/gates/blRelease.gate.js';
import { specialHandlingGate } from '../../modules/freight/gates/specialHandling.gate.js';
import { AppError } from '../../utils/response.js';
import { recordMilestone } from '../../modules/freight/milestones.service.js';
import { MilestoneType } from '../../common/enums.js';

export const section4EventTypes = new Set([
    'declaration.accepted', 'declaration.rejected', 'declaration.under_control',
    'portbase.container.released', 'carrier.booking.confirmed', 'carrier.schedule.updated',
    'portbase.message.accepted', 'portbase.message.rejected',
    'terminal.container.gated_in', 'terminal.container.gated_out',
]);

function payloadString(payload: Record<string, unknown>, key: string): string | undefined {
    const value = payload[key];
    return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function eventDate(value: string, key: string): Date {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) throw new AppError(422, 'INVALID_EVENT', `Invalid ${key}`);
    return parsed;
}

/** Transactional inbox for Section 4: deduplication, mutation and outbox commit together. */
export async function handleSection4Event(envelope: EventEnvelope): Promise<void> {
    if (!section4EventTypes.has(envelope.type)) throw new AppError(400, 'UNSUPPORTED_EVENT', envelope.type);
    if (!envelope.id || !envelope.workspace_id || !envelope.payload || typeof envelope.payload !== 'object') {
        throw new AppError(422, 'INVALID_EVENT', 'Event id, workspace and payload are required');
    }
    const p = envelope.payload as Record<string, unknown>;
    await db.transaction(async (trx) => {
        const existing = await trx('processed_message').where({ message_id: envelope.id }).first();
        if (existing) return;
        const fileId = payloadString(p, 'file_id');
        if (!fileId) throw new AppError(422, 'INVALID_EVENT', 'file_id is required');
        const file = await trx('freight_file').where({ id: fileId, workspace_id: envelope.workspace_id })
            .whereNull('deleted_at').forUpdate().first();
        if (!file) throw new AppError(404, 'FILE_NOT_FOUND', 'Event freight file not found in workspace');

        const updates: Record<string, unknown> = {};
        let auditAction = envelope.type;
        if (envelope.type.startsWith('declaration.')) {
            const declarationId = payloadString(p, 'declaration_id');
            if (!declarationId || !file.declaration_id || declarationId !== file.declaration_id) {
                throw new AppError(409, 'DECLARATION_MISMATCH', 'Declaration reply does not match submitted declaration');
            }
            if (file.declaration_status !== 'submitted' && file.declaration_status !== 'under_control') {
                throw new AppError(409, 'DECLARATION_STATE', 'Declaration is not awaiting a reply');
            }
            if (envelope.type === 'declaration.accepted') {
                const mrn = payloadString(p, 'mrn');
                if (!mrn) throw new AppError(422, 'INVALID_EVENT', 'Accepted declaration requires MRN');
                updates.declaration_status = 'accepted';
                updates.mrn = mrn;
            } else {
                const rejected = envelope.type === 'declaration.rejected';
                updates.declaration_status = rejected ? 'rejected' : 'under_control';
                await trx('exception_case').insert({ id: randomUUID(), workspace_id: envelope.workspace_id,
                    freight_file_id: fileId, gate_code: 'CUSTOMS_RELEASE',
                    type: rejected ? 'customs_rejection' : 'customs_under_control',
                    severity: rejected ? 'warn' : 'info', status: 'Open',
                    title: rejected ? `Customs declaration rejected: ${payloadString(p, 'rejection_reason') || 'No reason provided'}`
                        : 'Customs declaration under control',
                    description: `Declaration ${declarationId}: ${payloadString(p, 'rejection_reason') || ''}`,
                    created_by: 'system', created_at: trx.fn.now(), updated_at: trx.fn.now(), version: 1 });
            }
        } else if (envelope.type.startsWith('portbase.message.')) {
            const reference = payloadString(p, 'reference');
            if (!reference) throw new AppError(422, 'INVALID_EVENT', 'Portbase reference required');
            const job = await trx('integration_job').where({ workspace_id: envelope.workspace_id,
                freight_file_id: fileId, provider: 'portbase', provider_reference: reference }).forUpdate().first();
            if (!job) throw new AppError(404, 'PORTBASE_REQUEST_NOT_FOUND', 'No matching Portbase request');
            const rejected = envelope.type.endsWith('rejected');
            const replyStatus = rejected ? 'rejected' : 'accepted';
            if (job.reply_status && job.reply_status !== replyStatus) {
                throw new AppError(409, 'PORTBASE_REPLY_CONFLICT', 'Portbase reply conflicts with existing outcome');
            }
            if (job.reply_status !== replyStatus) {
                await trx('integration_job').where({ id: job.id }).update({ reply_status: replyStatus,
                    error_message: rejected ? payloadString(p, 'reason') || 'Portbase rejected message' : null,
                    updated_at: trx.fn.now() });
                if (rejected) await trx('exception_case').insert({ id: randomUUID(), workspace_id: envelope.workspace_id,
                    freight_file_id: fileId, gate_code: 'PORTBASE_REPLY', type: 'portbase_rejection', severity: 'warn',
                    status: 'Open', title: `Portbase ${job.operation.toUpperCase()} rejected`,
                    description: payloadString(p, 'reason') || 'Portbase rejected the message',
                    created_by: 'system', version: 1, created_at: trx.fn.now(), updated_at: trx.fn.now() });
            }
        } else if (envelope.type === 'portbase.container.released') {
            if (file.direction !== 'import') throw new AppError(422, 'WRONG_DIRECTION', 'Container release requires import file');
            const releasedAt = payloadString(p, 'released_at');
            if (!releasedAt || Number.isNaN(Date.parse(releasedAt))) throw new AppError(422, 'INVALID_EVENT', 'Valid released_at required');
            const containerNumber = payloadString(p, 'container_number');
            if (containerNumber) {
                const container = await trx('freight_container').where({ freight_file_id: fileId,
                    workspace_id: envelope.workspace_id, container_number: containerNumber }).first();
                if (!container) throw new AppError(404, 'CONTAINER_NOT_FOUND', 'Container is not on file');
            }
            updates.container_release_received_at = eventDate(releasedAt, 'released_at');
        } else if (envelope.type === 'carrier.booking.confirmed') {
            if (file.direction !== 'export' || file.status !== 'Draft') {
                throw new AppError(409, 'INVALID_STATE', 'Booking confirmation requires Draft export file');
            }
            const critical = await trx('exception_case').where({ freight_file_id: fileId,
                workspace_id: envelope.workspace_id, severity: 'critical' }).whereIn('status', ['Open', 'InProgress']).first();
            if (critical) throw new AppError(422, 'CRITICAL_EXCEPTION_BLOCKED', 'Critical case blocks booking');
            const containers = await trx('freight_container').where({ freight_file_id: fileId, workspace_id: envelope.workspace_id });
            const gate = specialHandlingGate(file, { containers });
            if (!gate.pass) throw new AppError(422, 'SPECIAL_HANDLING_GATE_FAILED', gate.reason || 'Special handling blocked');
            const reference = payloadString(p, 'reference');
            if (!reference) throw new AppError(422, 'INVALID_EVENT', 'Booking reference required');
            updates.carrier_booking_ref = reference;
            updates.status = 'Booked';
            for (const key of ['vessel', 'voyage', 'etd', 'eta', 'doc_cutoff', 'vgm_cutoff', 'gate_cutoff']) {
                const value = payloadString(p, key);
                if (value) updates[key] = key === 'vessel' || key === 'voyage' ? value : eventDate(value, key);
            }
            await OutboxService.enqueue(trx, { workspaceId: envelope.workspace_id, eventType: 'freight.file.booked',
                payload: { file_id: fileId, file_no: file.file_no, from_status: 'Draft', to_status: 'Booked',
                    carrier_booking_ref: reference } });
        } else if (envelope.type === 'carrier.schedule.updated') {
            for (const key of ['vessel', 'voyage', 'etd', 'eta']) {
                const value = payloadString(p, key);
                if (value) updates[key] = key === 'vessel' || key === 'voyage' ? value : eventDate(value, key);
            }
        } else if (envelope.type.startsWith('terminal.container.')) {
            const containerNumber = payloadString(p, 'container_number');
            const occurredAt = payloadString(p, 'occurred_at');
            if (!containerNumber || !occurredAt || Number.isNaN(Date.parse(occurredAt))) {
                throw new AppError(422, 'INVALID_EVENT', 'Container number and valid occurred_at required');
            }
            const container = await trx('freight_container').where({ freight_file_id: fileId,
                workspace_id: envelope.workspace_id, container_number: containerNumber }).forUpdate().first();
            if (!container) throw new AppError(404, 'CONTAINER_NOT_FOUND', 'Container is not on file');
            const gatedIn = envelope.type.endsWith('gated_in');
            if (gatedIn) {
                const containers = await trx('freight_container').where({ freight_file_id: fileId, workspace_id: envelope.workspace_id });
                const gate = specialHandlingGate(file, { containers });
                if (!gate.pass) throw new AppError(422, 'SPECIAL_HANDLING_GATE_FAILED', gate.reason || 'Special handling blocked');
            }
            await trx('freight_container').where({ id: container.id, workspace_id: envelope.workspace_id })
                .update({ [gatedIn ? 'gate_in_at' : 'gate_out_at']: eventDate(occurredAt, 'occurred_at'),
                    version: container.version + 1, updated_at: trx.fn.now() });
            await OutboxService.enqueue(trx, { workspaceId: envelope.workspace_id,
                eventType: gatedIn ? 'freight.container.gated_in' : 'freight.container.gated_out',
                payload: { file_id: fileId, container_id: container.id, container_number: containerNumber, occurred_at: occurredAt } });
        }

        if (Object.keys(updates).length) {
            // Both responses can arrive in either order. Clear only when every import gate passes.
            const candidate = { ...file, ...updates };
            if (file.direction === 'import' && file.status === 'Arrived' &&
                candidate.declaration_status === 'accepted' && candidate.container_release_received_at) {
                const bills = await trx('bill_of_lading').where({ freight_file_id: fileId, workspace_id: envelope.workspace_id });
                const critical = await trx('exception_case').where({ freight_file_id: fileId,
                    workspace_id: envelope.workspace_id, severity: 'critical' }).whereIn('status', ['Open', 'InProgress']).first();
                if (blReleaseGate(candidate, { billsOfLading: bills }).pass && !critical) {
                    updates.status = 'Cleared';
                    await OutboxService.enqueue(trx, { workspaceId: envelope.workspace_id, eventType: 'freight.file.cleared',
                        payload: { file_id: fileId, file_no: file.file_no, from_status: 'Arrived', to_status: 'Cleared' } });
                    await recordMilestone(trx, { workspaceId: envelope.workspace_id, fileId,
                        type: MilestoneType.CUSTOMS_CLEARED, timestamp: new Date(),
                        source: 'customs', actorId: 'system' });
                    auditAction = 'customs_cleared';
                }
            }
            await trx('freight_file').where({ id: fileId, workspace_id: envelope.workspace_id })
                .update({ ...updates, version: file.version + 1, updated_at: trx.fn.now() });
        }
        await trx('audit_log').insert({ id: randomUUID(), workspace_id: envelope.workspace_id, actor_id: 'system',
            entity_type: 'freight_file', entity_id: fileId, action: auditAction,
            from_state: file.status, to_state: (updates.status as string) || file.status,
            payload: JSON.stringify({ event_id: envelope.id, provider_event: envelope.type }), created_at: trx.fn.now() });
        await trx('processed_message').insert({ id: randomUUID(), workspace_id: envelope.workspace_id,
            message_id: envelope.id, event_type: envelope.type, processed_at: trx.fn.now() });
    });
}
