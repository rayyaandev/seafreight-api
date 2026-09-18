import { FreightRepository } from './freight.repository.js';
import { SeaImportStateMachine } from './state-machine/import-state-machine.js';
import { SeaExportStateMachine } from './state-machine/export-state-machine.js';
import { SpecialHandlingEngine } from './state-machine/special-handling.js';
import { AuditService } from '../audit/audit.service.js';
import { AppError } from '../../utils/response.js';
import type {
    FreightFileEntity,
    FreightContainerEntity,
    DrayageOrderEntity,
    ExceptionCaseEntity,
    FileDocumentEntity,
    SeaImportStatus,
    SeaExportStatus,
} from './state-machine/types.js';

export class FreightService {
    public static async listFiles(
        workspaceId: string,
        query: {
            mode?: string;
            direction?: string;
            status?: string;
            special_handling_status?: string;
            carrier_name?: string;
            q?: string;
            limit: number;
        }
    ) {
        return FreightRepository.listFiles(workspaceId, query);
    }

    public static async getFileDossier(id: string, workspaceId: string) {
        const file = await FreightRepository.findById(id, workspaceId);
        if (!file) {
            throw new AppError(404, 'NOT_FOUND', `Freight file with ID '${id}' not found`);
        }

        const [containers, drayageOrders, documents, exceptions] = await Promise.all([
            FreightRepository.getContainers(id),
            FreightRepository.getDrayageOrders(id),
            FreightRepository.getDocuments(id),
            FreightRepository.getExceptions(id),
        ]);

        const compliance = SpecialHandlingEngine.evaluate(file.special_handling_type, containers);

        return {
            ...file,
            containers,
            drayage_orders: drayageOrders,
            documents,
            exceptions,
            compliance_evaluation: compliance,
        };
    }

    public static async createFile(
        workspaceId: string,
        actorId: string,
        data: Partial<FreightFileEntity>
    ) {
        const mode = data.mode || 'sea';
        const humanId = await FreightRepository.generateHumanId(mode);

        const initialStatus = 'draft';
        const file = await FreightRepository.create({
            ...data,
            workspace_id: workspaceId,
            created_by: actorId,
            human_id: humanId,
            mode,
            status: initialStatus,
            special_handling_status: data.special_handling_type && data.special_handling_type !== 'none' ? 'orange' : 'green',
        });

        await AuditService.log({
            workspaceId,
            actorId,
            entityType: 'freight_file',
            entityId: file.id,
            action: 'create',
            toState: initialStatus,
            payload: { human_id: file.human_id, mode: file.mode, direction: file.direction },
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

        const updated = await FreightRepository.update(id, workspaceId, version, updates);
        if (!updated) {
            throw new AppError(409, 'CONFLICT', 'Failed to update file due to a concurrent modification.');
        }

        await AuditService.log({
            workspaceId,
            actorId,
            entityType: 'freight_file',
            entityId: id,
            action: 'update',
            payload: updates as Record<string, unknown>,
        });

        return updated;
    }

    public static async transitionStatus(
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

        const containers = await FreightRepository.getContainers(id);

        let transitionResult: {
            fromStatus: string;
            toStatus: string;
            actionTaken: string;
            eventsToPublish: string[];
            demurrageWarning?: boolean;
        };

        if (file.direction === 'import') {
            transitionResult = SeaImportStateMachine.validateTransition(
                file,
                targetStatus as SeaImportStatus,
                containers
            );
        } else {
            transitionResult = SeaExportStateMachine.validateTransition(
                file,
                targetStatus as SeaExportStatus,
                containers
            );
        }

        const updated = await FreightRepository.update(id, workspaceId, version, {
            status: targetStatus,
        });

        if (!updated) {
            throw new AppError(409, 'CONFLICT', 'Failed to update status due to a concurrent conflict.');
        }

        await AuditService.log({
            workspaceId,
            actorId,
            entityType: 'freight_file',
            entityId: id,
            action: 'transition',
            fromState: transitionResult.fromStatus,
            toState: transitionResult.toStatus,
            payload: {
                reason,
                actionTaken: transitionResult.actionTaken,
                events: transitionResult.eventsToPublish,
            },
        });

        if (transitionResult.demurrageWarning) {
            await FreightRepository.createException({
                workspace_id: workspaceId,
                freight_file_id: id,
                type: 'demurrage_risk',
                severity: 'warn',
                title: 'Demurrage Free-Time Alert',
                description: `Vessel has arrived and container free-time expires in under 48 hours (${file.free_time_expires_at}).`,
            });
        }

        return {
            file: updated,
            transition: transitionResult,
        };
    }

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
            freight_file_id: freightFileId,
        });

        const allContainers = await FreightRepository.getContainers(freightFileId);
        const evalResult = SpecialHandlingEngine.evaluate(file.special_handling_type, allContainers);

        // Update file special handling status if it changed
        if (file.special_handling_status !== evalResult.status) {
            await FreightRepository.update(file.id, workspaceId, file.version, {
                special_handling_status: evalResult.status,
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
            freight_file_id: freightFileId,
            status: 'open',
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

    public static async getMetrics(workspaceId: string) {
        return FreightRepository.getMetrics(workspaceId);
    }
}
