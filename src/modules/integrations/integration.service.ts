import { randomUUID } from 'crypto';
import db from '../../db/connection.js';
import { OutboxService } from '../../bus/outbox.service.js';
import { AppError } from '../../utils/response.js';
import type { AdapterRequest, Operation, Provider } from '../../adapters/section4/index.js';
import { getPortbaseAdapter, getCarrierAdapter, getTerminalAdapter } from '../../adapters/section4/index.js';
import { specialHandlingGate } from '../freight/gates/specialHandling.gate.js';

const operationProvider: Record<Operation, Provider> = {
    exa: 'portbase', ima: 'portbase', booking: 'carrier', schedule: 'carrier',
    shipping_instructions: 'carrier', bl_request: 'carrier', availability: 'terminal',
};

export class IntegrationService {
    static async submitCustoms(fileId: string, workspaceId: string, actorId: string, version: number) {
        return db.transaction(async (trx) => {
            const file = await trx('freight_file').where({ id: fileId, workspace_id: workspaceId }).whereNull('deleted_at').forUpdate().first();
            if (!file) throw new AppError(404, 'NOT_FOUND', 'Freight file not found');
            if (file.version !== version) throw new AppError(409, 'CONFLICT', `File version is ${file.version}`);
            if (file.declaration_status === 'submitted' || file.declaration_status === 'accepted') {
                throw new AppError(409, 'DECLARATION_ALREADY_SUBMITTED', 'Declaration is already submitted or accepted');
            }
            const declarationId = randomUUID();
            const [containers, lines] = await Promise.all([
                trx('freight_container').where({ freight_file_id: fileId, workspace_id: workspaceId }),
                trx('freight_line').where({ freight_file_id: fileId, workspace_id: workspaceId }),
            ]);
            await trx('freight_file').where({ id: fileId, workspace_id: workspaceId }).update({
                declaration_id: declarationId, declaration_status: 'submitted', mrn: null,
                version: version + 1, updated_at: trx.fn.now(),
            });
            await OutboxService.enqueue(trx, {
                workspaceId, eventType: 'declaration.submit.requested',
                payload: { declaration_id: declarationId, file_id: fileId, file_no: file.file_no,
                    direction: file.direction, customer_id: file.customer_id, shipper_id: file.shipper_id,
                    consignee_id: file.consignee_id, pol_id: file.pol_id, pod_id: file.pod_id,
                    containers: containers.map((c) => ({ container_number: c.container_number, type: c.type })),
                    lines: lines.map((l) => ({ description: l.description, commodity_code: l.commodity_code,
                        quantity: l.quantity, weight_kg: l.weight_kg, value_amount: l.value_amount })) },
            });
            await trx('audit_log').insert({ id: randomUUID(), workspace_id: workspaceId, actor_id: actorId,
                entity_type: 'freight_file', entity_id: fileId, action: 'submit_customs',
                payload: JSON.stringify({ declaration_id: declarationId }), created_at: trx.fn.now() });
            return { declaration_id: declarationId, declaration_status: 'submitted', version: version + 1 };
        });
    }

    static async request(fileId: string, workspaceId: string, actorId: string, operation: Operation, shippingInstructions?: string) {
        const provider = operationProvider[operation];
        if (!provider) throw new AppError(400, 'INVALID_OPERATION', 'Unsupported integration operation');
        return db.transaction(async (trx) => {
            const file = await trx('freight_file').where({ id: fileId, workspace_id: workspaceId }).whereNull('deleted_at').first();
            if (!file) throw new AppError(404, 'NOT_FOUND', 'Freight file not found');
            if (operation === 'exa' && file.direction !== 'export') throw new AppError(422, 'WRONG_DIRECTION', 'EXA requires an export file');
            if (operation === 'ima' && file.direction !== 'import') throw new AppError(422, 'WRONG_DIRECTION', 'IMA requires an import file');
            if (['booking', 'shipping_instructions', 'bl_request'].includes(operation) && file.direction !== 'export') {
                throw new AppError(422, 'WRONG_DIRECTION', 'Carrier operation requires an export file');
            }
            if (operation === 'booking' && file.status !== 'Draft') throw new AppError(409, 'INVALID_STATE', 'Only Draft export files can request booking');
            const [containers, lines] = await Promise.all([
                trx('freight_container').where({ freight_file_id: fileId, workspace_id: workspaceId }),
                trx('freight_line').where({ freight_file_id: fileId, workspace_id: workspaceId }),
            ]);
            if (operation === 'booking') {
                const gate = specialHandlingGate(file, { containers });
                if (!gate.pass) throw new AppError(422, 'SPECIAL_HANDLING_GATE_FAILED', gate.reason || 'Special handling blocked');
            }
            const request: AdapterRequest = {
                file_id: file.id, file_no: file.file_no, direction: file.direction,
                carrier_id: file.carrier_id, vessel: file.vessel, voyage: file.voyage,
                etd: file.etd, eta: file.eta, pol_id: file.pol_id, pod_id: file.pod_id,
                declaration_id: file.declaration_id,
                containers: containers.map((c) => ({ id: c.id, container_number: c.container_number, type: c.type })),
                lines: lines.map((l) => ({ description: l.description, commodity_code: l.commodity_code, quantity: l.quantity })),
                ...(shippingInstructions ? { shipping_instructions: shippingInstructions } : {}),
            };
            const id = randomUUID();
            await trx('integration_job').insert({ id, workspace_id: workspaceId, freight_file_id: fileId,
                provider, operation, request_payload: JSON.stringify(request), status: 'pending', attempts: 0,
                next_attempt_at: trx.fn.now(), created_at: trx.fn.now(), updated_at: trx.fn.now() });
            await trx('audit_log').insert({ id: randomUUID(), workspace_id: workspaceId, actor_id: actorId,
                entity_type: 'integration_job', entity_id: id, action: 'request',
                payload: JSON.stringify({ provider, operation, file_id: fileId }), created_at: trx.fn.now() });
            return { id, provider, operation, status: 'pending' };
        });
    }

    static async getJob(id: string, workspaceId: string) {
        const job = await db('integration_job').where({ id, workspace_id: workspaceId }).first();
        if (!job) throw new AppError(404, 'NOT_FOUND', 'Integration job not found');
        return { ...job, request_payload: JSON.parse(job.request_payload),
            result_payload: job.result_payload ? JSON.parse(job.result_payload) : null };
    }

    static async processOne(id: string): Promise<void> {
        const claimed = await db('integration_job').where({ id, status: 'pending' })
            .where('next_attempt_at', '<=', db.fn.now())
            .update({ status: 'processing', attempts: db.raw('attempts + 1'), updated_at: db.fn.now() });
        if (!claimed) return;
        const job = await db('integration_job').where({ id }).first();
        const request = JSON.parse(job.request_payload) as AdapterRequest;
        try {
            const result = job.operation === 'exa' ? await getPortbaseAdapter().sendExa(request)
                : job.operation === 'ima' ? await getPortbaseAdapter().sendIma(request)
                : job.operation === 'booking' ? await getCarrierAdapter().requestBooking(request)
                : job.operation === 'schedule' ? await getCarrierAdapter().getSchedule(request)
                : job.operation === 'shipping_instructions' ? await getCarrierAdapter().sendShippingInstructions(request)
                : job.operation === 'bl_request' ? await getCarrierAdapter().requestBillOfLading(request)
                : await getTerminalAdapter().getAvailability(request);
            await db.transaction(async (trx) => {
                await trx('integration_job').where({ id }).update({ status: 'completed', result_payload: JSON.stringify(result),
                    provider_reference: result.reference,
                    error_message: null, updated_at: trx.fn.now() });
                const eventType = job.operation === 'booking' ? 'carrier.booking.confirmed'
                    : job.operation === 'schedule' ? 'carrier.schedule.updated'
                    : `${job.provider}.${job.operation}.completed`;
                await OutboxService.enqueue(trx, { workspaceId: job.workspace_id, eventType,
                    payload: { file_id: job.freight_file_id, job_id: id, ...result } });
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            const attempts = Number(job.attempts);
            const status = attempts >= 5 ? 'failed' : 'pending';
            await db('integration_job').where({ id }).update({ status, error_message: message,
                next_attempt_at: new Date(Date.now() + Math.min(60000, 1000 * 2 ** attempts)), updated_at: db.fn.now() });
        }
    }

    static async processPending(): Promise<void> {
        // Recover jobs abandoned by a crashed worker. Mock calls are bounded to 30 seconds.
        await db('integration_job').where({ status: 'processing' })
            .where('updated_at', '<', new Date(Date.now() - 60000))
            .update({ status: 'pending', next_attempt_at: db.fn.now(), updated_at: db.fn.now() });
        const jobs = await db('integration_job').where({ status: 'pending' })
            .where('next_attempt_at', '<=', db.fn.now()).orderBy('created_at').limit(20);
        for (const job of jobs) await this.processOne(job.id);
    }
}
