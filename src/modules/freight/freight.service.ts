import { FreightRepository } from './freight.repository.js';
import { evaluateAllGates, evaluateSpecialHandlingDetails, specialHandlingGate } from './gates/index.js';
import { SeaImportStateMachine } from './state-machine/import-state-machine.js';
import { SeaExportStateMachine } from './state-machine/export-state-machine.js';
import { AuditService } from '../audit/audit.service.js';
import { AppError } from '../../utils/response.js';
import { SpecialStatus, SpecialType, GateCode, SeaImportStatus, SeaExportStatus } from '../../common/enums.js';
import { OutboxService } from '../../bus/outbox.service.js';
import db from '../../db/connection.js';
import { PublishedEvents } from '../../common/events.js';
import { randomUUID } from 'crypto';
import { MilestoneType, type T1EventType } from '../../common/enums.js';
import { recordMilestone } from './milestones.service.js';

function normalizeStatus(status: string): string {
    const s = status.toLowerCase().replace(/[^a-z0-9]/g, '');
    const map: Record<string, string> = {
        draft: 'Draft',
        releasepending: 'ReleasePending',
        intransit: 'InTransit',
        arrived: 'Arrived',
        cleared: 'Cleared',
        delivered: 'Delivered',
        closed: 'Closed',
        booked: 'Booked',
        vgmsisubmitted: 'VgmSiSubmitted',
        loaded: 'Loaded',
        blissued: 'BlIssued',
    };
    return map[s] || status;
}
import type {
    FreightFileEntity,
    FreightContainerEntity,
    FreightLineEntity,
    BillOfLadingEntity,
    FileDocumentEntity,
    FileNoteEntity,
    DrayageOrderEntity,
    MilestoneEntity,
    ExceptionCaseEntity,
    ChargeEntity,
} from '../../common/types.js';

export class FreightService {
    public static async listFiles(
        workspaceId: string,
        query: {
            mode?: string;
            direction?: string;
            status?: string;
            customer_id?: string;
            pol_id?: string;
            pod_id?: string;
            special_handling?: string;
            special_status?: string;
            eta_from?: string;
            eta_to?: string;
            q?: string;
            limit?: number;
            offset?: number;
        }
    ) {
        return FreightRepository.listFiles(workspaceId, query);
    }

    public static async getFileDossier(id: string, workspaceId: string) {
        const file = await FreightRepository.findById(id, workspaceId);
        if (!file) {
            throw new AppError(404, 'NOT_FOUND', `Freight file with ID '${id}' not found`);
        }

        const [
            containers,
            lines,
            billsOfLading,
            documents,
            notes,
            drayageOrders,
            bondedEvents,
            milestones,
            exceptions,
            charges,
        ] = await Promise.all([
            FreightRepository.getContainers(id),
            FreightRepository.getLines(id),
            FreightRepository.getBillsOfLading(id),
            FreightRepository.getDocuments(id),
            FreightRepository.getNotes(id),
            FreightRepository.getDrayageOrders(id),
            FreightRepository.getBondedEvents(id, workspaceId),
            FreightRepository.getMilestones(id),
            FreightRepository.getExceptions(id),
            FreightRepository.getCharges(id),
        ]);

        const gateContext = { containers, lines, billsOfLading };
        const gateEvaluation = evaluateAllGates(file, gateContext);
        const specialHandlingEvaluation = evaluateSpecialHandlingDetails(file.special_handling, containers);

        return {
            ...file,
            containers,
            lines,
            bills_of_lading: billsOfLading,
            documents,
            notes,
            drayage_orders: drayageOrders,
            bonded_events: bondedEvents,
            milestones,
            exceptions,
            charges,
            gates_summary: gateEvaluation,
            special_handling_evaluation: specialHandlingEvaluation,
            compliance_evaluation: specialHandlingEvaluation,
        };
    }

    public static async evaluateGates(id: string, workspaceId: string) {
        const dossier = await this.getFileDossier(id, workspaceId);
        return dossier.gates_summary;
    }

    public static async createFile(
        workspaceId: string,
        actorId: string,
        data: Partial<FreightFileEntity>
    ) {
        const { declaration_id: _declarationId, declaration_status: _declarationStatus,
            mrn: _mrn, container_release_received_at: _releaseAt, ...safeData } = data;
        const mode = data.mode || 'sea';
        const fileNo = await FreightRepository.generateHumanId(mode as 'sea' | 'air');

        const initialStatus = 'Draft';
        const specialType = data.special_handling || SpecialType.NONE;
        const initialSpecialStatus = evaluateSpecialHandlingDetails(specialType, []).status;

        const file = await FreightRepository.create({
            ...safeData,
            workspace_id: workspaceId,
            created_by: actorId,
            file_no: fileNo,
            mode,
            status: initialStatus,
            special_handling: specialType,
            special_status: initialSpecialStatus,
        });

        // Enqueue creation event (best-effort, non-transactional for create since the file insert is not tx-aware)
        try {
            await db.transaction(async (trx) => {
                await OutboxService.enqueue(trx, {
                    workspaceId,
                    eventType: PublishedEvents.FILE_CREATED,
                    payload: {
                        file_id: file.id,
                        file_no: file.file_no,
                        direction: file.direction,
                        customer_id: file.customer_id,
                        shipper_id: file.shipper_id,
                        consignee_id: file.consignee_id,
                        pol_id: file.pol_id,
                        pod_id: file.pod_id,
                    },
                });
            });
        } catch (err) {
            console.error('[FreightService] Failed to enqueue file.created event:', err);
        }

        await AuditService.log({
            workspaceId,
            actorId,
            entityType: 'freight_file',
            entityId: file.id,
            action: 'create',
            toState: initialStatus,
            payload: { file_no: file.file_no, mode: file.mode, direction: file.direction },
        });

        return file;
    }

    public static async updateFile(
        id: string,
        workspaceId: string,
        actorId: string,
        version: number,
        updates: Partial<FreightFileEntity>
    ) {
        const current = await FreightRepository.findById(id, workspaceId);
        if (!current) {
            throw new AppError(404, 'NOT_FOUND', `Freight file with ID '${id}' not found`);
        }

        if (current.version !== version) {
            throw new AppError(
                409,
                'CONFLICT',
                `Conflict: file version is ${current.version}, but provided version was ${version}. Please refresh and try again.`
            );
        }

        // Prevent updating lifecycle status via direct PATCH
        const { status: _ignoredStatus, special_handling: _ignoredHandling, special_status: _ignoredSpecialStatus,
            declaration_id: _declarationId, declaration_status: _declarationStatus, mrn: _mrn,
            container_release_received_at: _releaseAt, ...sanitizedUpdates } = updates;

        const updated = await db.transaction(async (trx) => {
            const result = await FreightRepository.updateWithTrx(trx, id, workspaceId, version, sanitizedUpdates);
            if (result && sanitizedUpdates.atd) await recordMilestone(trx, { workspaceId, fileId: id,
                type: MilestoneType.SAILED, timestamp: sanitizedUpdates.atd, source: 'file', actorId });
            if (result && sanitizedUpdates.ata) await recordMilestone(trx, { workspaceId, fileId: id,
                type: MilestoneType.ARRIVED, timestamp: sanitizedUpdates.ata, source: 'file', actorId });
            return result;
        });
        if (!updated) {
            throw new AppError(409, 'CONFLICT', 'Failed to update file due to a concurrent modification.');
        }

        await AuditService.log({
            workspaceId,
            actorId,
            entityType: 'freight_file',
            entityId: id,
            action: 'update',
            payload: sanitizedUpdates as Record<string, unknown>,
        });

        return updated;
    }

    public static async updateSpecialHandling(
        id: string,
        workspaceId: string,
        actorId: string,
        version: number,
        override: {
            special_handling: SpecialType;
            reason?: string;
        }
    ) {
        const current = await FreightRepository.findById(id, workspaceId);
        if (!current) {
            throw new AppError(404, 'NOT_FOUND', `Freight file with ID '${id}' not found`);
        }

        if (current.version !== version) {
            throw new AppError(
                409,
                'CONFLICT',
                `Conflict: file version is ${current.version}, but provided version was ${version}.`
            );
        }

        const containers = await FreightRepository.getContainers(id);
        const autoEval = evaluateSpecialHandlingDetails(override.special_handling, containers);
        const targetSpecialStatus = autoEval.status;

        const updated = await FreightRepository.update(id, workspaceId, version, {
            special_handling: override.special_handling,
            special_status: targetSpecialStatus,
        });
        if (!updated) {
            throw new AppError(409, 'CONFLICT', 'File changed while updating special handling. Refresh and retry.');
        }

        await AuditService.log({
            workspaceId,
            actorId,
            entityType: 'freight_file',
            entityId: id,
            action: 'special_handling_override',
            payload: {
                previous_type: current.special_handling,
                new_type: override.special_handling,
                previous_status: current.special_status,
                new_status: targetSpecialStatus,
                reason: override.reason,
            },
        });

        return updated;
    }

    private static async recordSpecialGateFailure(
        freightFileId: string,
        workspaceId: string,
        actorId: string,
        reason: string,
        details?: unknown
    ): Promise<void> {
        const existing = await db('exception_case')
            .where({ freight_file_id: freightFileId, workspace_id: workspaceId, gate_code: GateCode.SPECIAL_HANDLING })
            .whereIn('status', ['Open', 'InProgress'])
            .first();
        if (!existing) {
            await FreightRepository.createException({
                workspace_id: workspaceId,
                freight_file_id: freightFileId,
                gate_code: GateCode.SPECIAL_HANDLING,
                type: 'gate_failure',
                severity: 'warn',
                status: 'Open',
                title: 'Special handling gate failed',
                description: JSON.stringify({ reason, details }),
                created_by: actorId,
            });
        }
    }

    public static async updateContainerHandling(
        containerId: string,
        freightFileId: string,
        workspaceId: string,
        actorId: string,
        version: number,
        updates: Partial<FreightContainerEntity>
    ) {
        const file = await FreightRepository.findById(freightFileId, workspaceId);
        if (!file) throw new AppError(404, 'NOT_FOUND', `Freight file '${freightFileId}' not found`);
        const result = await db.transaction(async (trx) => {
            const affected = await trx('freight_container')
                .where({ id: containerId, freight_file_id: freightFileId, workspace_id: workspaceId, version })
                .update({ ...updates, version: version + 1, updated_at: trx.fn.now() });
            if (!affected) throw new AppError(409, 'CONFLICT', 'Container not found or version changed. Refresh and retry.');
            const containers = await trx<FreightContainerEntity>('freight_container').where('freight_file_id', freightFileId);
            const evaluation = evaluateSpecialHandlingDetails(file.special_handling, containers);
            const updatedFile = await FreightRepository.updateWithTrx(trx, freightFileId, workspaceId, file.version, {
                special_status: evaluation.status,
            });
            if (!updatedFile) throw new AppError(409, 'CONFLICT', 'File changed while updating container. Refresh and retry.');
            const container = await trx<FreightContainerEntity>('freight_container').where('id', containerId).first();
            return { container, special_handling_evaluation: evaluation, file_version: updatedFile.version };
        });
        await AuditService.log({
            workspaceId, actorId, entityType: 'container', entityId: containerId,
            action: 'special_handling_update', payload: { freight_file_id: freightFileId, ...updates },
        });
        return result;
    }

    public static async gateInContainer(
        containerId: string,
        freightFileId: string,
        workspaceId: string,
        actorId: string,
        version: number,
        gateInAt?: string
    ) {
        const file = await FreightRepository.findById(freightFileId, workspaceId);
        if (!file) throw new AppError(404, 'NOT_FOUND', `Freight file '${freightFileId}' not found`);
        if (file.version !== version) throw new AppError(409, 'CONFLICT', 'File version changed. Refresh and retry.');
        const containers = await FreightRepository.getContainers(freightFileId);
        const container = containers.find((item) => item.id === containerId);
        if (!container) throw new AppError(404, 'NOT_FOUND', `Container '${containerId}' not found on file`);
        if (container.gate_in_at) throw new AppError(409, 'ALREADY_GATED_IN', 'Container already has a gate-in timestamp');
        const gate = specialHandlingGate(file, { containers });
        if (!gate.pass) {
            await this.recordSpecialGateFailure(freightFileId, workspaceId, actorId, gate.reason || 'Special handling RED', gate.details);
            throw new AppError(422, 'SPECIAL_HANDLING_GATE_FAILED', gate.reason || 'Special handling RED', undefined, gate.details);
        }
        const timestamp = gateInAt ? new Date(gateInAt) : new Date();
        const result = await db.transaction(async (trx) => {
            const updatedFile = await FreightRepository.updateWithTrx(trx, freightFileId, workspaceId, version, {});
            if (!updatedFile) throw new AppError(409, 'CONFLICT', 'File version changed. Refresh and retry.');
            const affected = await trx('freight_container')
                .where({ id: containerId, freight_file_id: freightFileId, workspace_id: workspaceId, version: container.version })
                .whereNull('gate_in_at')
                .update({ gate_in_at: timestamp, version: container.version + 1, updated_at: trx.fn.now() });
            if (!affected) throw new AppError(409, 'CONFLICT', 'Container changed while recording gate-in. Refresh and retry.');
            await OutboxService.enqueue(trx, {
                workspaceId,
                eventType: PublishedEvents.CONTAINER_GATED_IN,
                payload: { file_id: freightFileId, container_id: containerId, gate_in_at: timestamp.toISOString() },
            });
            const updatedContainer = await trx<FreightContainerEntity>('freight_container').where('id', containerId).first();
            return { container: updatedContainer, file_version: updatedFile.version };
        });
        await AuditService.log({
            workspaceId, actorId, entityType: 'container', entityId: containerId,
            action: 'gate_in', payload: { freight_file_id: freightFileId, gate_in_at: timestamp.toISOString() },
        });
        return result;
    }

    // ------------------------------------------------------------------------
    // Child Operations: Containers
    // ------------------------------------------------------------------------
    public static async addContainer(
        freightFileId: string,
        workspaceId: string,
        actorId: string,
        containerData: Partial<FreightContainerEntity>
    ) {
        const file = await FreightRepository.findById(freightFileId, workspaceId);
        if (!file) {
            throw new AppError(404, 'NOT_FOUND', `Freight file with ID '${freightFileId}' not found`);
        }
        if (containerData.gate_in_at) {
            throw new AppError(422, 'GATE_IN_ACTION_REQUIRED', 'Use the guarded gate-in action to record terminal entry.');
        }

        const container = await db.transaction(async (trx) => {
            const created = await FreightRepository.createContainer({
                ...containerData,
                workspace_id: workspaceId,
                created_by: actorId,
                freight_file_id: freightFileId,
            }, trx);
            const allContainers = await FreightRepository.getContainers(freightFileId, trx);
            const evaluation = evaluateSpecialHandlingDetails(file.special_handling, allContainers);
            const updatedFile = await FreightRepository.updateWithTrx(trx, file.id, workspaceId, file.version, {
                special_status: evaluation.status,
            });
            if (!updatedFile) throw new AppError(409, 'CONFLICT', 'File changed while adding container. Refresh and retry.');
            return created;
        });

        await AuditService.log({
            workspaceId,
            actorId,
            entityType: 'container',
            entityId: container.id,
            action: 'create',
            payload: { container_number: container.container_number, freight_file_id: freightFileId },
        });

        return container;
    }

    public static async deleteContainer(
        containerId: string,
        freightFileId: string,
        workspaceId: string,
        actorId: string
    ) {
        const file = await FreightRepository.findById(freightFileId, workspaceId);
        if (!file) {
            throw new AppError(404, 'NOT_FOUND', `Freight file with ID '${freightFileId}' not found`);
        }

        await db.transaction(async (trx) => {
            const deleted = await FreightRepository.deleteContainer(containerId, freightFileId, trx);
            if (!deleted) {
                throw new AppError(404, 'NOT_FOUND', `Container '${containerId}' not found on file '${freightFileId}'`);
            }
            const allContainers = await FreightRepository.getContainers(freightFileId, trx);
            const evaluation = evaluateSpecialHandlingDetails(file.special_handling, allContainers);
            const updatedFile = await FreightRepository.updateWithTrx(trx, file.id, workspaceId, file.version, {
                special_status: evaluation.status,
            });
            if (!updatedFile) throw new AppError(409, 'CONFLICT', 'File changed while deleting container. Refresh and retry.');
        });

        await AuditService.log({
            workspaceId,
            actorId,
            entityType: 'container',
            entityId: containerId,
            action: 'delete',
            payload: { freight_file_id: freightFileId },
        });

        return { deleted: true };
    }

    // ------------------------------------------------------------------------
    // Child Operations: Freight Lines
    // ------------------------------------------------------------------------
    public static async addFreightLine(
        freightFileId: string,
        workspaceId: string,
        actorId: string,
        lineData: Partial<FreightLineEntity>
    ) {
        const file = await FreightRepository.findById(freightFileId, workspaceId);
        if (!file) {
            throw new AppError(404, 'NOT_FOUND', `Freight file with ID '${freightFileId}' not found`);
        }

        const line = await FreightRepository.createLine({
            ...lineData,
            workspace_id: workspaceId,
            created_by: actorId,
            freight_file_id: freightFileId,
        });

        await AuditService.log({
            workspaceId,
            actorId,
            entityType: 'freight_line',
            entityId: line.id,
            action: 'create',
            payload: { description: line.description, quantity: line.quantity },
        });

        return line;
    }

    public static async deleteFreightLine(
        lineId: string,
        freightFileId: string,
        workspaceId: string,
        actorId: string
    ) {
        const file = await FreightRepository.findById(freightFileId, workspaceId);
        if (!file) {
            throw new AppError(404, 'NOT_FOUND', `Freight file with ID '${freightFileId}' not found`);
        }

        const deleted = await FreightRepository.deleteLine(lineId, freightFileId);
        if (!deleted) {
            throw new AppError(404, 'NOT_FOUND', `Freight line '${lineId}' not found on file '${freightFileId}'`);
        }

        await AuditService.log({
            workspaceId,
            actorId,
            entityType: 'freight_line',
            entityId: lineId,
            action: 'delete',
            payload: { freight_file_id: freightFileId },
        });

        return { deleted: true };
    }

    // ------------------------------------------------------------------------
    // Child Operations: Bill of Lading
    // ------------------------------------------------------------------------
    public static async addBillOfLading(
        freightFileId: string,
        workspaceId: string,
        actorId: string,
        bolData: Partial<BillOfLadingEntity>
    ) {
        const file = await FreightRepository.findById(freightFileId, workspaceId);
        if (!file) {
            throw new AppError(404, 'NOT_FOUND', `Freight file with ID '${freightFileId}' not found`);
        }

        const bol = await FreightRepository.createBillOfLading({
            ...bolData,
            workspace_id: workspaceId,
            created_by: actorId,
            freight_file_id: freightFileId,
        });

        await AuditService.log({
            workspaceId,
            actorId,
            entityType: 'bill_of_lading',
            entityId: bol.id,
            action: 'create',
            payload: { bl_number: bol.bl_number, type: bol.type },
        });

        return bol;
    }

    // ------------------------------------------------------------------------
    // Child Operations: Documents
    // ------------------------------------------------------------------------
    public static async addDocument(
        freightFileId: string,
        workspaceId: string,
        actorId: string,
        docData: Partial<FileDocumentEntity>
    ) {
        const file = await FreightRepository.findById(freightFileId, workspaceId);
        if (!file) {
            throw new AppError(404, 'NOT_FOUND', `Freight file with ID '${freightFileId}' not found`);
        }

        const doc = await FreightRepository.createDocument({
            ...docData,
            workspace_id: workspaceId,
            created_by: actorId,
            freight_file_id: freightFileId,
        });

        await AuditService.log({
            workspaceId,
            actorId,
            entityType: 'file_document',
            entityId: doc.id,
            action: 'create',
            payload: { doc_type: doc.doc_type, file_name: doc.file_name },
        });

        return doc;
    }

    public static async deleteDocument(
        docId: string,
        freightFileId: string,
        workspaceId: string,
        actorId: string
    ) {
        const file = await FreightRepository.findById(freightFileId, workspaceId);
        if (!file) {
            throw new AppError(404, 'NOT_FOUND', `Freight file with ID '${freightFileId}' not found`);
        }

        const deleted = await FreightRepository.deleteDocument(docId, freightFileId);
        if (!deleted) {
            throw new AppError(404, 'NOT_FOUND', `Document '${docId}' not found on file '${freightFileId}'`);
        }

        await AuditService.log({
            workspaceId,
            actorId,
            entityType: 'file_document',
            entityId: docId,
            action: 'delete',
            payload: { freight_file_id: freightFileId },
        });

        return { deleted: true };
    }

    // ------------------------------------------------------------------------
    // Child Operations: Notes
    // ------------------------------------------------------------------------
    public static async addNote(
        freightFileId: string,
        workspaceId: string,
        actorId: string,
        noteData: Partial<FileNoteEntity>
    ) {
        const file = await FreightRepository.findById(freightFileId, workspaceId);
        if (!file) {
            throw new AppError(404, 'NOT_FOUND', `Freight file with ID '${freightFileId}' not found`);
        }

        const note = await FreightRepository.createNote({
            ...noteData,
            workspace_id: workspaceId,
            created_by: actorId,
            freight_file_id: freightFileId,
        });

        await AuditService.log({
            workspaceId,
            actorId,
            entityType: 'file_note',
            entityId: note.id,
            action: 'create',
            payload: { show_on_open: note.show_on_open },
        });

        return note;
    }

    // ------------------------------------------------------------------------
    // Child Operations: Drayage Orders
    // ------------------------------------------------------------------------
    public static async addDrayageOrder(
        freightFileId: string,
        workspaceId: string,
        actorId: string,
        orderData: Partial<DrayageOrderEntity>
    ) {
        return db.transaction(async (trx) => {
            const file = await trx('freight_file').where({ id: freightFileId, workspace_id: workspaceId })
                .whereNull('deleted_at').forUpdate().first();
            if (!file) throw new AppError(404, 'NOT_FOUND', 'Freight file not found');
            if (orderData.container_id) {
                const container = await trx('freight_container').where({ id: orderData.container_id,
                    freight_file_id: freightFileId, workspace_id: workspaceId }).first();
                if (!container) throw new AppError(422, 'CONTAINER_NOT_ON_FILE', 'Container is not on this file');
            }
            const orderNumber = `TR-${new Date().getFullYear()}-${randomUUID().slice(0, 8).toUpperCase()}`;
            const order = await FreightRepository.createDrayageOrder({ ...orderData, workspace_id: workspaceId,
                created_by: actorId, freight_file_id: freightFileId, order_number: orderNumber,
                status: 'draft' }, trx);
            await OutboxService.enqueue(trx, { workspaceId, eventType: 'trucking.order.create.requested',
                payload: { drayage_order_id: order.id, order_number: order.order_number,
                    freight_file_id: freightFileId, file_no: file.file_no, direction: file.direction,
                    container_id: order.container_id, type: order.type,
                    terminal_name: order.terminal_name, facility_address: order.facility_address,
                    pickup_address: order.pickup_address || (file.direction === 'import' ? order.facility_address : null),
                    delivery_address: order.delivery_address || (file.direction === 'export' ? order.facility_address : null),
                    planned_pickup_at: order.planned_pickup_at, planned_delivery_at: order.planned_delivery_at,
                    scheduled_at: order.scheduled_at } });
            await trx('audit_log').insert({ id: randomUUID(), workspace_id: workspaceId, actor_id: actorId,
                entity_type: 'drayage_order', entity_id: order.id, action: 'create',
                payload: JSON.stringify({ order_number: order.order_number }), created_at: trx.fn.now() });
            return order;
        });
    }

    public static async updateDrayageOrder(freightFileId: string, orderId: string, workspaceId: string,
        actorId: string, version: number, changes: Partial<DrayageOrderEntity>) {
        return db.transaction(async (trx) => {
            const order = await trx('drayage_order').where({ id: orderId, freight_file_id: freightFileId,
                workspace_id: workspaceId }).forUpdate().first();
            if (!order) throw new AppError(404, 'NOT_FOUND', 'Drayage order not found');
            if (order.version !== version) throw new AppError(409, 'CONFLICT', `Order version is ${order.version}`);
            if (order.status === 'cancelled') throw new AppError(409, 'INVALID_STATE', 'Cancelled order cannot be edited');
            const allowed = ['terminal_name', 'facility_address', 'pickup_address', 'delivery_address',
                'planned_pickup_at', 'planned_delivery_at', 'trucking_company', 'driver_name', 'truck_plate',
                'chassis_number', 'scheduled_at'] as const;
            const dateFields = new Set(['planned_pickup_at', 'planned_delivery_at', 'scheduled_at']);
            const updates = Object.fromEntries(allowed.filter((key) => changes[key] !== undefined)
                .map((key) => [key, dateFields.has(key) && typeof changes[key] === 'string'
                    ? new Date(changes[key]) : changes[key]]));
            if (!Object.keys(updates).length) throw new AppError(422, 'NO_CHANGES', 'No editable fields supplied');
            await trx('drayage_order').where({ id: orderId, workspace_id: workspaceId, version })
                .update({ ...updates, version: version + 1, updated_at: trx.fn.now() });
            await OutboxService.enqueue(trx, { workspaceId, eventType: 'trucking.order.update.requested',
                payload: { drayage_order_id: orderId, trucking_order_id: order.trucking_order_id,
                    order_number: order.order_number, freight_file_id: freightFileId, changes: updates } });
            await trx('audit_log').insert({ id: randomUUID(), workspace_id: workspaceId, actor_id: actorId,
                entity_type: 'drayage_order', entity_id: orderId, action: 'update',
                payload: JSON.stringify(updates), created_at: trx.fn.now() });
            return trx('drayage_order').where({ id: orderId }).first();
        });
    }

    public static async cancelDrayageOrder(freightFileId: string, orderId: string, workspaceId: string,
        actorId: string, version: number) {
        return db.transaction(async (trx) => {
            const order = await trx('drayage_order').where({ id: orderId, freight_file_id: freightFileId,
                workspace_id: workspaceId }).forUpdate().first();
            if (!order) throw new AppError(404, 'NOT_FOUND', 'Drayage order not found');
            if (order.version !== version) throw new AppError(409, 'CONFLICT', `Order version is ${order.version}`);
            if (['delivered', 'cancelled'].includes(order.status)) throw new AppError(409, 'INVALID_STATE', 'Order cannot be cancelled');
            await trx('drayage_order').where({ id: orderId, workspace_id: workspaceId, version })
                .update({ status: 'cancelled', version: version + 1, updated_at: trx.fn.now() });
            await OutboxService.enqueue(trx, { workspaceId, eventType: 'trucking.order.cancel.requested',
                payload: { drayage_order_id: orderId, trucking_order_id: order.trucking_order_id,
                    order_number: order.order_number, freight_file_id: freightFileId } });
            await trx('audit_log').insert({ id: randomUUID(), workspace_id: workspaceId, actor_id: actorId,
                entity_type: 'drayage_order', entity_id: orderId, action: 'cancel', created_at: trx.fn.now() });
            return trx('drayage_order').where({ id: orderId }).first();
        });
    }

    // ------------------------------------------------------------------------
    // Child Operations: Milestones
    // ------------------------------------------------------------------------
    public static async addMilestone(
        freightFileId: string,
        workspaceId: string,
        actorId: string,
        milestoneData: Partial<MilestoneEntity>
    ) {
        return db.transaction(async (trx) => {
            const file = await trx('freight_file').where({ id: freightFileId, workspace_id: workspaceId })
                .whereNull('deleted_at').forUpdate().first();
            if (!file) throw new AppError(404, 'NOT_FOUND', 'Freight file not found');
            if (!milestoneData.milestone_type) throw new AppError(422, 'INVALID_MILESTONE', 'Milestone type required');
            const milestone = await recordMilestone(trx, { workspaceId, fileId: freightFileId,
                type: milestoneData.milestone_type as MilestoneType,
                timestamp: milestoneData.timestamp || new Date(), source: 'manual', actorId });
            await trx('audit_log').insert({ id: randomUUID(), workspace_id: workspaceId, actor_id: actorId,
                entity_type: 'milestone', entity_id: milestone.id, action: 'create',
                payload: JSON.stringify({ milestone_type: milestone.milestone_type }), created_at: trx.fn.now() });
            return milestone;
        });
    }

    public static async addBondedEvent(freightFileId: string, workspaceId: string, actorId: string,
        data: { event_type: T1EventType; mrn?: string | null; bonded_warehouse_ref?: string | null;
            document_id?: string | null; occurred_at?: string }) {
        return db.transaction(async (trx) => {
            const file = await trx('freight_file').where({ id: freightFileId, workspace_id: workspaceId })
                .whereNull('deleted_at').forUpdate().first();
            if (!file) throw new AppError(404, 'NOT_FOUND', 'Freight file not found');
            if (data.document_id) {
                const doc = await trx('file_document').where({ id: data.document_id,
                    freight_file_id: freightFileId, workspace_id: workspaceId, doc_type: 't1_document' }).first();
                if (!doc) throw new AppError(422, 'T1_DOCUMENT_NOT_ON_FILE', 'T1 document must belong to file');
            }
            const id = randomUUID();
            await trx('t1_bonded_event').insert({ id, workspace_id: workspaceId, freight_file_id: freightFileId,
                event_type: data.event_type, mrn: data.mrn || null,
                bonded_warehouse_ref: data.bonded_warehouse_ref || null, document_id: data.document_id || null,
                occurred_at: data.occurred_at ? new Date(data.occurred_at) : trx.fn.now(),
                created_by: actorId, version: 1, created_at: trx.fn.now(), updated_at: trx.fn.now() });
            await OutboxService.enqueue(trx, { workspaceId, eventType: 'freight.bonded_event.recorded',
                payload: { event_id: id, file_id: freightFileId, event_type: data.event_type,
                    mrn: data.mrn || null, document_id: data.document_id || null } });
            await trx('audit_log').insert({ id: randomUUID(), workspace_id: workspaceId, actor_id: actorId,
                entity_type: 't1_bonded_event', entity_id: id, action: 'create',
                payload: JSON.stringify({ event_type: data.event_type }), created_at: trx.fn.now() });
            return trx('t1_bonded_event').where({ id }).first();
        });
    }

    public static async listBondedEvents(freightFileId: string, workspaceId: string) {
        const file = await FreightRepository.findById(freightFileId, workspaceId);
        if (!file) throw new AppError(404, 'NOT_FOUND', 'Freight file not found');
        return FreightRepository.getBondedEvents(freightFileId, workspaceId);
    }

    // ------------------------------------------------------------------------
    // Child Operations: Exception Cases
    // ------------------------------------------------------------------------
    public static async addExceptionCase(
        freightFileId: string,
        workspaceId: string,
        actorId: string,
        caseData: Partial<ExceptionCaseEntity>
    ) {
        const file = await FreightRepository.findById(freightFileId, workspaceId);
        if (!file) {
            throw new AppError(404, 'NOT_FOUND', `Freight file with ID '${freightFileId}' not found`);
        }

        const exception = await FreightRepository.createException({
            ...caseData,
            workspace_id: workspaceId,
            created_by: actorId,
            freight_file_id: freightFileId,
            status: 'Open',
        });

        await AuditService.log({
            workspaceId,
            actorId,
            entityType: 'exception_case',
            entityId: exception.id,
            action: 'create',
            payload: { type: exception.type, severity: exception.severity, title: exception.title },
        });

        return exception;
    }

    // ------------------------------------------------------------------------
    // Child Operations: Charges
    // ------------------------------------------------------------------------
    public static async addCharge(
        freightFileId: string,
        workspaceId: string,
        actorId: string,
        chargeData: Partial<ChargeEntity>
    ) {
        const file = await FreightRepository.findById(freightFileId, workspaceId);
        if (!file) {
            throw new AppError(404, 'NOT_FOUND', `Freight file with ID '${freightFileId}' not found`);
        }

        const charge = await FreightRepository.createCharge({
            ...chargeData,
            workspace_id: workspaceId,
            created_by: actorId,
            freight_file_id: freightFileId,
        });

        await AuditService.log({
            workspaceId,
            actorId,
            entityType: 'charge',
            entityId: charge.id,
            action: 'create',
            payload: { line_type: charge.line_type, service_name: charge.service_name, amount: charge.amount },
        });

        return charge;
    }

    public static async deleteCharge(
        chargeId: string,
        freightFileId: string,
        workspaceId: string,
        actorId: string
    ) {
        const file = await FreightRepository.findById(freightFileId, workspaceId);
        if (!file) {
            throw new AppError(404, 'NOT_FOUND', `Freight file with ID '${freightFileId}' not found`);
        }

        const deleted = await FreightRepository.deleteCharge(chargeId, freightFileId);
        if (!deleted) {
            throw new AppError(404, 'NOT_FOUND', `Charge '${chargeId}' not found on file '${freightFileId}'`);
        }

        await AuditService.log({
            workspaceId,
            actorId,
            entityType: 'charge',
            entityId: chargeId,
            action: 'delete',
            payload: { freight_file_id: freightFileId },
        });

        return { deleted: true };
    }

    // ------------------------------------------------------------------------
    // Lifecycle Transitions (Import & Export)
    // ------------------------------------------------------------------------
    public static async transitionFile(
        id: string,
        workspaceId: string,
        actorId: string,
        version: number,
        targetStatus: string,
        reason?: string
    ) {
        const file = await FreightRepository.findById(id, workspaceId);
        if (!file) {
            throw new AppError(404, 'NOT_FOUND', `Freight file with ID '${id}' not found`);
        }

        if (file.version !== version) {
            throw new AppError(
                409,
                'CONFLICT',
                `Conflict: file version is ${file.version}, but provided version was ${version}. Please refresh and try again.`
            );
        }

        // Check for active critical exception cases blocking transitions
        const activeCriticalCase = await db('exception_case')
            .where({
                freight_file_id: id,
                workspace_id: workspaceId,
                severity: 'critical',
            })
            .whereIn('status', ['Open', 'InProgress'])
            .first();

        if (activeCriticalCase) {
            throw new AppError(
                422,
                'CRITICAL_EXCEPTION_BLOCKED',
                `Transition blocked by active critical exception: "${activeCriticalCase.title}". Must be resolved before advancing.`
            );
        }

        const canonicalTarget = normalizeStatus(targetStatus);

        let transition: {
            fromStatus: string;
            toStatus: string;
            actionTaken: string;
            eventsToPublish: string[];
            demurrageWarning?: boolean;
        };

        if (file.direction === 'import') {
            // 1. Validate structural transition
            transition = SeaImportStateMachine.validateTransition(file.status, canonicalTarget);
            SeaImportStateMachine.validateMilestoneTimestamp(file, canonicalTarget);

            // 2. Enforce required gates
            const requiredGates = SeaImportStateMachine.requiredGatesForTransition(canonicalTarget);
            if (requiredGates.length > 0) {
                const [containers, lines, billsOfLading] = await Promise.all([
                    FreightRepository.getContainers(id),
                    FreightRepository.getLines(id),
                    FreightRepository.getBillsOfLading(id),
                ]);

                const gateContext = { containers, lines, billsOfLading };
                const gateEvaluation = evaluateAllGates(file as any, gateContext);

                for (const requiredGateCode of requiredGates) {
                    const gateResult = gateEvaluation.gates.find((g) => g.gate === requiredGateCode);
                    if (gateResult && !gateResult.pass) {
                        // Open an exception case if not already open for this gate
                        const existingCase = await db('exception_case')
                            .where({
                                freight_file_id: id,
                                workspace_id: workspaceId,
                                gate_code: requiredGateCode,
                            })
                            .whereIn('status', ['Open', 'InProgress'])
                            .first();

                        if (!existingCase) {
                            await FreightRepository.createException({
                                workspace_id: workspaceId,
                                freight_file_id: id,
                                gate_code: requiredGateCode,
                                type: 'gate_failure',
                                severity: 'warn',
                                status: 'Open',
                                title: `${requiredGateCode} Gate Failed: ${gateResult.reason}`,
                                description: gateResult.details ? JSON.stringify(gateResult.details) : null,
                                created_by: actorId,
                            });
                        }

                        throw new AppError(
                            422,
                            `${requiredGateCode}_GATE_FAILED`,
                            `${requiredGateCode} Gate Failed: ${gateResult.reason}`
                        );
                    }
                }
            }

            // 3. Check demurrage warning on arrival
            if (canonicalTarget === SeaImportStatus.ARRIVED && file.ata) {
                const freeTimeDays = file.free_time_days || 5;
                const ataDate = new Date(file.ata).getTime();
                const freeTimeExpiry = ataDate + freeTimeDays * 24 * 3600 * 1000;
                const hoursRemaining = (freeTimeExpiry - Date.now()) / (1000 * 60 * 60);
                if (hoursRemaining < 48) {
                    transition.demurrageWarning = true;
                }
            }
        } else if (file.direction === 'export') {
            const containers = await FreightRepository.getContainers(id);
            try {
                transition = SeaExportStateMachine.validateTransition(file, canonicalTarget, containers);
            } catch (error) {
                if (error instanceof AppError && error.code === 'SPECIAL_HANDLING_GATE_FAILED') {
                    await this.recordSpecialGateFailure(id, workspaceId, actorId, error.message, error.details);
                }
                throw error;
            }
        } else {
            throw new AppError(400, 'INVALID_DIRECTION', `Unsupported direction '${file.direction}' for lifecycle transition`);
        }

        // Apply status change + outbox events atomically in a single DB transaction
        const updated = await db.transaction(async (trx) => {
            const result = await FreightRepository.updateWithTrx(trx, id, workspaceId, version, {
                status: canonicalTarget,
            });

            if (!result) {
                throw new AppError(409, 'CONFLICT', 'Failed to update file due to a concurrent modification.');
            }

            const milestoneType = canonicalTarget === SeaImportStatus.IN_TRANSIT || canonicalTarget === SeaExportStatus.LOADED
                ? MilestoneType.SAILED
                : canonicalTarget === SeaImportStatus.ARRIVED ? MilestoneType.ARRIVED
                : canonicalTarget === SeaImportStatus.CLEARED ? MilestoneType.CUSTOMS_CLEARED
                : canonicalTarget === SeaImportStatus.DELIVERED ? MilestoneType.DELIVERED : null;
            if (milestoneType) await recordMilestone(trx, { workspaceId, fileId: id, type: milestoneType,
                timestamp: milestoneType === MilestoneType.SAILED ? file.atd || new Date()
                    : milestoneType === MilestoneType.ARRIVED ? file.ata || new Date() : new Date(),
                source: 'state_machine', actorId });

            // Enqueue each domain event into the outbox within the same transaction
            for (const eventType of transition.eventsToPublish) {
                await OutboxService.enqueue(trx, {
                    workspaceId,
                    eventType,
                    payload: {
                        file_id: id,
                        file_no: file.file_no,
                        from_status: transition.fromStatus,
                        to_status: transition.toStatus,
                        reason,
                    },
                });
            }

            return result;
        });

        // Write audit trail (outside transaction — non-blocking)
        await AuditService.log({
            workspaceId,
            actorId,
            entityType: 'freight_file',
            entityId: id,
            action: 'transition',
            fromState: transition.fromStatus,
            toState: transition.toStatus,
            payload: {
                action_taken: transition.actionTaken,
                reason,
                events: transition.eventsToPublish,
                demurrage_warning: transition.demurrageWarning,
            },
        });

        return {
            file: updated,
            transition,
        };
    }

    public static async transitionImportFile(
        id: string,
        workspaceId: string,
        actorId: string,
        version: number,
        targetStatus: string,
        reason?: string
    ) {
        return this.transitionFile(id, workspaceId, actorId, version, targetStatus, reason);
    }

    public static async releaseBl(
        id: string,
        workspaceId: string,
        actorId: string,
        version: number,
        reason?: string
    ) {
        return this.transitionFile(id, workspaceId, actorId, version, SeaImportStatus.RELEASE_PENDING, reason);
    }

    public static async clearCustoms(
        id: string,
        workspaceId: string,
        actorId: string,
        version: number,
        reason?: string
    ) {
        return this.transitionFile(id, workspaceId, actorId, version, SeaImportStatus.CLEARED, reason);
    }

    public static async deliverFile(
        id: string,
        workspaceId: string,
        actorId: string,
        version: number,
        reason?: string
    ) {
        return this.transitionFile(id, workspaceId, actorId, version, SeaImportStatus.DELIVERED, reason);
    }

    public static async bookExport(
        id: string,
        workspaceId: string,
        actorId: string,
        version: number,
        reason?: string
    ) {
        return this.transitionFile(id, workspaceId, actorId, version, SeaExportStatus.BOOKED, reason);
    }

    public static async submitVgm(
        id: string,
        workspaceId: string,
        actorId: string,
        version: number,
        reason?: string
    ) {
        return this.transitionFile(id, workspaceId, actorId, version, SeaExportStatus.VGM_SI_SUBMITTED, reason);
    }

    public static async loadExport(
        id: string,
        workspaceId: string,
        actorId: string,
        version: number,
        reason?: string
    ) {
        return this.transitionFile(id, workspaceId, actorId, version, SeaExportStatus.LOADED, reason);
    }

    public static async issueBl(
        id: string,
        workspaceId: string,
        actorId: string,
        version: number,
        reason?: string
    ) {
        return this.transitionFile(id, workspaceId, actorId, version, SeaExportStatus.BL_ISSUED, reason);
    }

    public static async closeFile(
        id: string,
        workspaceId: string,
        actorId: string,
        version: number,
        reason?: string
    ) {
        return this.transitionFile(id, workspaceId, actorId, version, 'Closed', reason);
    }

    public static async recordAta(
        id: string,
        workspaceId: string,
        actorId: string,
        version: number,
        ata?: string,
        reason?: string
    ) {
        const file = await FreightRepository.findById(id, workspaceId);
        if (!file) {
            throw new AppError(404, 'NOT_FOUND', `Freight file with ID '${id}' not found`);
        }

        if (file.direction !== 'import') {
            throw new AppError(400, 'INVALID_DIRECTION', 'Record ATA is for sea import files only');
        }

        if (file.version !== version) {
            throw new AppError(
                409,
                'CONFLICT',
                `Conflict: file version is ${file.version}, but provided version was ${version}.`
            );
        }

        const ataValue = ata || new Date().toISOString();

        let transitionResult: any = null;
        const targetStatus = SeaImportStatus.ARRIVED;
        if (file.status !== SeaImportStatus.ARRIVED && file.status !== SeaImportStatus.CLEARED && file.status !== SeaImportStatus.DELIVERED && file.status !== SeaImportStatus.CLOSED) {
            transitionResult = SeaImportStateMachine.validateTransition(file.status, targetStatus);
            SeaImportStateMachine.validateMilestoneTimestamp({ ...file, ata: ataValue }, targetStatus);
        }

        const freeTimeDays = file.free_time_days || 5;
        const ataDate = new Date(ataValue).getTime();
        const freeTimeExpiry = ataDate + freeTimeDays * 24 * 3600 * 1000;
        const hoursRemaining = (freeTimeExpiry - Date.now()) / (1000 * 60 * 60);
        const demurrageWarning = hoursRemaining < 48;

        const updatePayload: Partial<FreightFileEntity> = {
            ata: ataValue,
        };
        if (transitionResult) {
            updatePayload.status = targetStatus;
        }

        const updated = await db.transaction(async (trx) => {
            const result = await FreightRepository.updateWithTrx(trx, id, workspaceId, version, updatePayload);
            if (!result) return null;
            await recordMilestone(trx, { workspaceId, fileId: id, type: MilestoneType.ARRIVED,
                timestamp: ataValue, source: 'vessel', actorId });
            if (transitionResult) {
                for (const eventType of transitionResult.eventsToPublish) {
                    await OutboxService.enqueue(trx, { workspaceId, eventType,
                        payload: { file_id: id, file_no: file.file_no, from_status: file.status,
                            to_status: result.status, ata: ataValue, reason } });
                }
            }
            return result;
        });
        if (!updated) {
            throw new AppError(409, 'CONFLICT', 'Failed to update file due to a concurrent modification.');
        }

        await AuditService.log({
            workspaceId,
            actorId,
            entityType: 'freight_file',
            entityId: id,
            action: 'record_ata',
            fromState: file.status,
            toState: updated.status,
            payload: {
                ata: ataValue,
                demurrage_warning: demurrageWarning,
                events: transitionResult ? transitionResult.eventsToPublish : [],
                reason,
            },
        });

        return {
            file: updated,
            transition: transitionResult || {
                fromStatus: file.status,
                toStatus: updated.status,
                actionTaken: 'Recorded vessel arrival ATA',
                eventsToPublish: [],
                demurrageWarning,
            },
        };
    }

    // ------------------------------------------------------------------------
    // Metrics
    // ------------------------------------------------------------------------
    public static async getMetrics(workspaceId: string) {
        return FreightRepository.getMetrics(workspaceId);
    }
}
