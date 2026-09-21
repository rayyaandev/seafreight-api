import { FreightRepository } from './freight.repository.js';
import { evaluateAllGates, evaluateSpecialHandlingDetails } from './gates/index.js';
import { SeaImportStateMachine } from './state-machine/import-state-machine.js';
import { SeaExportStateMachine } from './state-machine/export-state-machine.js';
import { AuditService } from '../audit/audit.service.js';
import { AppError } from '../../utils/response.js';
import { SpecialStatus, SpecialType, GateCode, SeaImportStatus, SeaExportStatus } from '../../common/enums.js';

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
        const mode = data.mode || 'sea';
        const fileNo = await FreightRepository.generateHumanId(mode as 'sea' | 'air');

        const initialStatus = 'Draft';
        const specialType = data.special_handling || SpecialType.NONE;
        const initialSpecialStatus = specialType !== SpecialType.NONE ? SpecialStatus.ORANGE : SpecialStatus.GREEN;

        const file = await FreightRepository.create({
            ...data,
            workspace_id: workspaceId,
            created_by: actorId,
            file_no: fileNo,
            mode,
            status: initialStatus,
            special_handling: specialType,
            special_status: initialSpecialStatus,
        });

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
        const { status: _ignoredStatus, ...sanitizedUpdates } = updates;

        const updated = await FreightRepository.update(id, workspaceId, version, sanitizedUpdates);
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
        version: number | undefined,
        override: {
            special_handling: SpecialType;
            special_status?: SpecialStatus;
            reason?: string;
        }
    ) {
        const current = await FreightRepository.findById(id, workspaceId);
        if (!current) {
            throw new AppError(404, 'NOT_FOUND', `Freight file with ID '${id}' not found`);
        }

        const targetVersion = version !== undefined && !isNaN(version) ? version : current.version;
        if (current.version !== targetVersion) {
            throw new AppError(
                409,
                'CONFLICT',
                `Conflict: file version is ${current.version}, but provided version was ${version}.`
            );
        }

        const containers = await FreightRepository.getContainers(id);
        const autoEval = evaluateSpecialHandlingDetails(override.special_handling, containers);
        const targetSpecialStatus = override.special_status || autoEval.status;

        const updated = await FreightRepository.update(id, workspaceId, targetVersion, {
            special_handling: override.special_handling,
            special_status: targetSpecialStatus,
        });

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

        const container = await FreightRepository.createContainer({
            ...containerData,
            workspace_id: workspaceId,
            created_by: actorId,
            freight_file_id: freightFileId,
        });

        // Re-evaluate Special Handling status on parent dossier
        const allContainers = await FreightRepository.getContainers(freightFileId);
        const evalResult = evaluateSpecialHandlingDetails(file.special_handling, allContainers);

        if (file.special_status !== evalResult.status) {
            await FreightRepository.update(file.id, workspaceId, file.version, {
                special_status: evalResult.status,
            });
        }

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

        const deleted = await FreightRepository.deleteContainer(containerId, freightFileId);
        if (!deleted) {
            throw new AppError(404, 'NOT_FOUND', `Container '${containerId}' not found on file '${freightFileId}'`);
        }

        const allContainers = await FreightRepository.getContainers(freightFileId);
        const evalResult = evaluateSpecialHandlingDetails(file.special_handling, allContainers);

        if (file.special_status !== evalResult.status) {
            await FreightRepository.update(file.id, workspaceId, file.version, {
                special_status: evalResult.status,
            });
        }

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
        const file = await FreightRepository.findById(freightFileId, workspaceId);
        if (!file) {
            throw new AppError(404, 'NOT_FOUND', `Freight file with ID '${freightFileId}' not found`);
        }

        const year = new Date().getFullYear();
        const orderNumber = `TR-${year}-${Math.floor(10000 + Math.random() * 90000)}`;

        const order = await FreightRepository.createDrayageOrder({
            ...orderData,
            workspace_id: workspaceId,
            created_by: actorId,
            freight_file_id: freightFileId,
            order_number: orderNumber,
            status: 'draft',
        });

        await AuditService.log({
            workspaceId,
            actorId,
            entityType: 'drayage_order',
            entityId: order.id,
            action: 'create',
            payload: { order_number: order.order_number, terminal: order.terminal_name },
        });

        return order;
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
        const file = await FreightRepository.findById(freightFileId, workspaceId);
        if (!file) {
            throw new AppError(404, 'NOT_FOUND', `Freight file with ID '${freightFileId}' not found`);
        }

        const milestone = await FreightRepository.createMilestone({
            ...milestoneData,
            workspace_id: workspaceId,
            created_by: actorId,
            freight_file_id: freightFileId,
        });

        await AuditService.log({
            workspaceId,
            actorId,
            entityType: 'milestone',
            entityId: milestone.id,
            action: 'create',
            payload: { milestone_type: milestone.milestone_type },
        });

        return milestone;
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
            transition = SeaExportStateMachine.validateTransition(file, canonicalTarget, containers);
        } else {
            throw new AppError(400, 'INVALID_DIRECTION', `Unsupported direction '${file.direction}' for lifecycle transition`);
        }

        // Apply status change with optimistic lock
        const updated = await FreightRepository.update(id, workspaceId, version, {
            status: canonicalTarget,
        });

        if (!updated) {
            throw new AppError(409, 'CONFLICT', 'Failed to update file due to a concurrent modification.');
        }

        // Write audit trail
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

        const updated = await FreightRepository.update(id, workspaceId, version, updatePayload);
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
