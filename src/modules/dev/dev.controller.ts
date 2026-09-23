import type { Request, Response, NextFunction } from 'express';
import { DevService } from './dev.service.js';
import { sendSuccess } from '../../utils/response.js';

export class DevController {
    /**
     * POST /v1/dev/simulate
     * Simulates an inbound event onto the RabbitMQ bus or directly to the consumer handler.
     */
    static simulate = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const context = {
                user_id: req.context?.actorId,
                workspace_id: req.context?.workspaceId,
            };

            const result = await DevService.simulateEvent(req.body, context);
            sendSuccess(res, result, 200);
        } catch (err) {
            next(err);
        }
    };

    /**
     * GET /v1/dev/templates
     * Returns a list of supported inbound events and canned sample payloads.
     */
    static getTemplates = async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const templates = DevService.getEventTemplates();
            sendSuccess(res, templates, 200);
        } catch (err) {
            next(err);
        }
    };
}
