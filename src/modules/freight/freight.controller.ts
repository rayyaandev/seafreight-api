import type { Request, Response, NextFunction } from 'express';
import { FreightService } from './freight.service.js';
import { sendSuccess } from '../../utils/response.js';

export class FreightController {
    public static async listFiles(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const { workspaceId } = req.context;
            const result = await FreightService.listFiles(workspaceId, req.query as any);
            sendSuccess(res, result.data, 200, { total: result.total });
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
                version,
                updates
            );
            sendSuccess(res, updated);
        } catch (err) {
            next(err);
        }
    }

    public static async transitionState(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const { workspaceId, actorId } = req.context;
            const { target_status, version, reason } = req.body;
            const result = await FreightService.transitionStatus(
                req.params.id as string,
                workspaceId,
                actorId,
                version,
                target_status,
                reason
            );
            sendSuccess(res, result);
        } catch (err) {
            next(err);
        }
    }

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

    public static async evaluateGates(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            sendSuccess(res, { gates: [] });
        } catch (err) {
            next(err);
        }
    }

    public static async updateSpecialHandling(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            sendSuccess(res, { updated: true });
        } catch (err) {
            next(err);
        }
    }

    public static async deleteContainer(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            sendSuccess(res, { deleted: true });
        } catch (err) {
            next(err);
        }
    }

    public static async addFreightLine(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            sendSuccess(res, { id: 'stub-line-id' }, 201);
        } catch (err) {
            next(err);
        }
    }

    public static async deleteFreightLine(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            sendSuccess(res, { deleted: true });
        } catch (err) {
            next(err);
        }
    }

    public static async addBillOfLading(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            sendSuccess(res, { id: 'stub-bol-id' }, 201);
        } catch (err) {
            next(err);
        }
    }

    public static async addDocument(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            sendSuccess(res, { id: 'stub-doc-id' }, 201);
        } catch (err) {
            next(err);
        }
    }

    public static async deleteDocument(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            sendSuccess(res, { deleted: true });
        } catch (err) {
            next(err);
        }
    }

    public static async addNote(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            sendSuccess(res, { id: 'stub-note-id' }, 201);
        } catch (err) {
            next(err);
        }
    }

    public static async addMilestone(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            sendSuccess(res, { id: 'stub-milestone-id' }, 201);
        } catch (err) {
            next(err);
        }
    }

    public static async addCharge(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            sendSuccess(res, { id: 'stub-charge-id' }, 201);
        } catch (err) {
            next(err);
        }
    }

    public static async deleteCharge(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            sendSuccess(res, { deleted: true });
        } catch (err) {
            next(err);
        }
    }

    public static async getMetrics(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const { workspaceId } = req.context;
            const metrics = await FreightService.getMetrics(workspaceId);
            sendSuccess(res, metrics);
        } catch (err) {
            next(err);
        }
    }
}
