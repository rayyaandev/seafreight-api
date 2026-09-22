import type { Request, Response, NextFunction } from 'express';
import { MasterDataService } from './masterData.service.js';
import { sendSuccess } from '../../utils/response.js';

export class MasterDataController {
    public static async search(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const { workspaceId } = req.context;
            const entity = req.params.entity as string;
            const q = req.query.q as string | undefined;
            const limit = req.query.limit ? Number(req.query.limit) : 20;
            const type = req.query.type as string | undefined;

            const results = await MasterDataService.search(workspaceId, entity, { q, limit, type });
            sendSuccess(res, results, 200, { total: results.length, limit });
        } catch (err) {
            next(err);
        }
    }
}
