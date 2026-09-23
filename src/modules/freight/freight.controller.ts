import type { Request, Response, NextFunction } from 'express';
import { FreightService } from './freight.service.js';
import { sendSuccess } from '../../utils/response.js';

export class FreightController {
    // ------------------------------------------------------------------------
    // Freight File Dossier Endpoints
    // ------------------------------------------------------------------------
    public static async listFiles(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const { workspaceId } = req.context;
            const result = await FreightService.listFiles(workspaceId, req.query as any);
            sendSuccess(res, result.data, 200, { total: result.total, limit: Number(req.query.limit) || 20 });
        } catch (err) {
            next(err);
        }
    }

    public static async getFileDossier(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const { workspaceId } = req.context;
            const file = await FreightService.getFileDossier(req.params.id as string, workspaceId);
            sendSuccess(res, file);
        } catch (err) {
            next(err);
        }
    }

    public static async createFile(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const { workspaceId, actorId } = req.context;
            const file = await FreightService.createFile(workspaceId, actorId, req.body);
            sendSuccess(res, file, 201);
        } catch (err) {
            next(err);
        }
    }

    public static async updateFile(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const { workspaceId, actorId } = req.context;
            const { version, ...updates } = req.body;
            const updated = await FreightService.updateFile(
                req.params.id as string,
                workspaceId,
                actorId,
                Number(version),
                updates
            );
            sendSuccess(res, updated);
        } catch (err) {
            next(err);
        }
    }

    public static async evaluateGates(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const { workspaceId } = req.context;
            const gates = await FreightService.evaluateGates(req.params.id as string, workspaceId);
            sendSuccess(res, gates);
        } catch (err) {
            next(err);
        }
    }

    public static async updateSpecialHandling(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const { workspaceId, actorId } = req.context;
            const { version, special_handling, reason } = req.body;
            const updated = await FreightService.updateSpecialHandling(
                req.params.id as string,
                workspaceId,
                actorId,
                Number(version),
                { special_handling, reason }
            );
            sendSuccess(res, updated);
        } catch (err) {
            next(err);
        }
    }

    // ------------------------------------------------------------------------
    // Child Operations: Containers
    // ------------------------------------------------------------------------
    public static async addContainer(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const { workspaceId, actorId } = req.context;
            const container = await FreightService.addContainer(
                req.params.id as string,
                workspaceId,
                actorId,
                req.body
            );
            sendSuccess(res, container, 201);
        } catch (err) {
            next(err);
        }
    }

    public static async deleteContainer(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const { workspaceId, actorId } = req.context;
            const result = await FreightService.deleteContainer(
                req.params.containerId as string,
                req.params.id as string,
                workspaceId,
                actorId
            );
            sendSuccess(res, result);
        } catch (err) {
            next(err);
        }
    }

    public static async updateContainerHandling(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const { workspaceId, actorId } = req.context;
            const { version, ...updates } = req.body;
            const result = await FreightService.updateContainerHandling(
                req.params.containerId as string, req.params.id as string,
                workspaceId, actorId, Number(version), updates
            );
            sendSuccess(res, result);
        } catch (err) { next(err); }
    }

    public static async gateInContainer(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const { workspaceId, actorId } = req.context;
            const result = await FreightService.gateInContainer(
                req.params.containerId as string, req.params.id as string,
                workspaceId, actorId, Number(req.body.version), req.body.gate_in_at
            );
            sendSuccess(res, result);
        } catch (err) { next(err); }
    }

    // ------------------------------------------------------------------------
    // Child Operations: Freight Lines
    // ------------------------------------------------------------------------
    public static async addFreightLine(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const { workspaceId, actorId } = req.context;
            const line = await FreightService.addFreightLine(
                req.params.id as string,
                workspaceId,
                actorId,
                req.body
            );
            sendSuccess(res, line, 201);
        } catch (err) {
            next(err);
        }
    }

    public static async deleteFreightLine(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const { workspaceId, actorId } = req.context;
            const result = await FreightService.deleteFreightLine(
                req.params.lineId as string,
                req.params.id as string,
                workspaceId,
                actorId
            );
            sendSuccess(res, result);
        } catch (err) {
            next(err);
        }
    }

    // ------------------------------------------------------------------------
    // Child Operations: Bills of Lading
    // ------------------------------------------------------------------------
    public static async addBillOfLading(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const { workspaceId, actorId } = req.context;
            const bol = await FreightService.addBillOfLading(
                req.params.id as string,
                workspaceId,
                actorId,
                req.body
            );
            sendSuccess(res, bol, 201);
        } catch (err) {
            next(err);
        }
    }

    // ------------------------------------------------------------------------
    // Child Operations: Documents
    // ------------------------------------------------------------------------
    public static async addDocument(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const { workspaceId, actorId } = req.context;
            const doc = await FreightService.addDocument(
                req.params.id as string,
                workspaceId,
                actorId,
                req.body
            );
            sendSuccess(res, doc, 201);
        } catch (err) {
            next(err);
        }
    }

    public static async deleteDocument(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const { workspaceId, actorId } = req.context;
            const result = await FreightService.deleteDocument(
                req.params.docId as string,
                req.params.id as string,
                workspaceId,
                actorId
            );
            sendSuccess(res, result);
        } catch (err) {
            next(err);
        }
    }

    // ------------------------------------------------------------------------
    // Child Operations: Notes
    // ------------------------------------------------------------------------
    public static async addNote(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const { workspaceId, actorId } = req.context;
            const note = await FreightService.addNote(
                req.params.id as string,
                workspaceId,
                actorId,
                req.body
            );
            sendSuccess(res, note, 201);
        } catch (err) {
            next(err);
        }
    }

    // ------------------------------------------------------------------------
    // Child Operations: Drayage Orders
    // ------------------------------------------------------------------------
    public static async addDrayageOrder(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const { workspaceId, actorId } = req.context;
            const order = await FreightService.addDrayageOrder(
                req.params.id as string,
                workspaceId,
                actorId,
                req.body
            );
            sendSuccess(res, order, 201);
        } catch (err) {
            next(err);
        }
    }

    // ------------------------------------------------------------------------
    // Child Operations: Milestones
    // ------------------------------------------------------------------------
    public static async addMilestone(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const { workspaceId, actorId } = req.context;
            const milestone = await FreightService.addMilestone(
                req.params.id as string,
                workspaceId,
                actorId,
                req.body
            );
            sendSuccess(res, milestone, 201);
        } catch (err) {
            next(err);
        }
    }

    // ------------------------------------------------------------------------
    // Child Operations: Exception Cases
    // ------------------------------------------------------------------------
    public static async addExceptionCase(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const { workspaceId, actorId } = req.context;
            const exception = await FreightService.addExceptionCase(
                req.params.id as string,
                workspaceId,
                actorId,
                req.body
            );
            sendSuccess(res, exception, 201);
        } catch (err) {
            next(err);
        }
    }

    // ------------------------------------------------------------------------
    // Child Operations: Charges
    // ------------------------------------------------------------------------
    public static async addCharge(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const { workspaceId, actorId } = req.context;
            const charge = await FreightService.addCharge(
                req.params.id as string,
                workspaceId,
                actorId,
                req.body
            );
            sendSuccess(res, charge, 201);
        } catch (err) {
            next(err);
        }
    }

    public static async deleteCharge(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const { workspaceId, actorId } = req.context;
            const result = await FreightService.deleteCharge(
                req.params.chargeId as string,
                req.params.id as string,
                workspaceId,
                actorId
            );
            sendSuccess(res, result);
        } catch (err) {
            next(err);
        }
    }

    // ------------------------------------------------------------------------
    // Metrics
    // ------------------------------------------------------------------------
    public static async getMetrics(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const { workspaceId } = req.context;
            const metrics = await FreightService.getMetrics(workspaceId);
            sendSuccess(res, metrics);
        } catch (err) {
            next(err);
        }
    }

    // ------------------------------------------------------------------------
    // Lifecycle Transitions (Specific Action Endpoints & Generic Transition)
    // ------------------------------------------------------------------------
    public static async transitionFile(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const { workspaceId, actorId } = req.context;
            const { version, target_status, reason } = req.body;
            const result = await FreightService.transitionFile(
                req.params.id as string,
                workspaceId,
                actorId,
                Number(version),
                target_status,
                reason
            );
            sendSuccess(res, result);
        } catch (err) {
            next(err);
        }
    }

    public static async releaseBl(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const { workspaceId, actorId } = req.context;
            const { version, reason } = req.body;
            const result = await FreightService.releaseBl(
                req.params.id as string,
                workspaceId,
                actorId,
                Number(version),
                reason
            );
            sendSuccess(res, result);
        } catch (err) {
            next(err);
        }
    }

    public static async recordAta(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const { workspaceId, actorId } = req.context;
            const { version, ata, reason } = req.body;
            const result = await FreightService.recordAta(
                req.params.id as string,
                workspaceId,
                actorId,
                Number(version),
                ata,
                reason
            );
            sendSuccess(res, result);
        } catch (err) {
            next(err);
        }
    }

    public static async clearCustoms(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const { workspaceId, actorId } = req.context;
            const { version, reason } = req.body;
            const result = await FreightService.clearCustoms(
                req.params.id as string,
                workspaceId,
                actorId,
                Number(version),
                reason
            );
            sendSuccess(res, result);
        } catch (err) {
            next(err);
        }
    }

    public static async deliverFile(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const { workspaceId, actorId } = req.context;
            const { version, reason } = req.body;
            const result = await FreightService.deliverFile(
                req.params.id as string,
                workspaceId,
                actorId,
                Number(version),
                reason
            );
            sendSuccess(res, result);
        } catch (err) {
            next(err);
        }
    }

    public static async bookExport(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const { workspaceId, actorId } = req.context;
            const { version, reason } = req.body;
            const result = await FreightService.bookExport(
                req.params.id as string,
                workspaceId,
                actorId,
                Number(version),
                reason
            );
            sendSuccess(res, result);
        } catch (err) {
            next(err);
        }
    }

    public static async submitVgm(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const { workspaceId, actorId } = req.context;
            const { version, reason } = req.body;
            const result = await FreightService.submitVgm(
                req.params.id as string,
                workspaceId,
                actorId,
                Number(version),
                reason
            );
            sendSuccess(res, result);
        } catch (err) {
            next(err);
        }
    }

    public static async loadExport(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const { workspaceId, actorId } = req.context;
            const { version, reason } = req.body;
            const result = await FreightService.loadExport(
                req.params.id as string,
                workspaceId,
                actorId,
                Number(version),
                reason
            );
            sendSuccess(res, result);
        } catch (err) {
            next(err);
        }
    }

    public static async issueBl(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const { workspaceId, actorId } = req.context;
            const { version, reason } = req.body;
            const result = await FreightService.issueBl(
                req.params.id as string,
                workspaceId,
                actorId,
                Number(version),
                reason
            );
            sendSuccess(res, result);
        } catch (err) {
            next(err);
        }
    }

    public static async closeFile(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const { workspaceId, actorId } = req.context;
            const { version, reason } = req.body;
            const result = await FreightService.closeFile(
                req.params.id as string,
                workspaceId,
                actorId,
                Number(version),
                reason
            );
            sendSuccess(res, result);
        } catch (err) {
            next(err);
        }
    }
}
