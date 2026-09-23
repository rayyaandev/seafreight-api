import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { requirePermission } from '../../middleware/rbac.js';
import { sendSuccess } from '../../utils/response.js';
import { validateBody } from '../../middleware/validate.js';
import { IntegrationService } from './integration.service.js';
import type { Operation } from '../../adapters/section4/index.js';

export const integrationRouter = Router();
const versionSchema = z.object({ version: z.number().int().positive() });
const requestSchema = z.object({ shipping_instructions: z.string().max(10000).optional() });
const operations = new Set<Operation>(['exa', 'ima', 'booking', 'schedule', 'shipping_instructions', 'bl_request', 'availability']);

integrationRouter.post('/files/:id/customs', requirePermission('freight.file.clear'), validateBody(versionSchema),
    async (req: Request, res: Response, next: NextFunction) => {
        try {
            const result = await IntegrationService.submitCustoms(req.params.id as string,
                req.context.workspaceId, req.context.actorId, req.body.version);
            sendSuccess(res, result, 202);
        } catch (error) { next(error); }
    });

integrationRouter.post('/files/:id/:operation', requirePermission('freight.file.update'), validateBody(requestSchema),
    async (req: Request, res: Response, next: NextFunction) => {
        try {
            const operation = req.params.operation as Operation;
            if (!operations.has(operation)) { res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Unknown operation' } }); return; }
            const result = await IntegrationService.request(req.params.id as string,
                req.context.workspaceId, req.context.actorId, operation, req.body.shipping_instructions);
            sendSuccess(res, result, 202);
        } catch (error) { next(error); }
    });

integrationRouter.get('/jobs/:id', requirePermission('freight.file.read'),
    async (req: Request, res: Response, next: NextFunction) => {
        try { sendSuccess(res, await IntegrationService.getJob(req.params.id as string, req.context.workspaceId)); }
        catch (error) { next(error); }
    });
