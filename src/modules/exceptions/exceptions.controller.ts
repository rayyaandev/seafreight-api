import type { Request, Response, NextFunction } from 'express';
import { ExceptionsService } from './exceptions.service.js';
import { sendSuccess } from '../../utils/response.js';
import type { ListExceptionsQuery, UpdateExceptionCaseInput } from './exceptions.schema.js';

export class ExceptionsController {
    /**
     * GET /v1/exceptions
     * Cross-dossier exception worklist with filtering and cursor pagination.
     */
    static listExceptions = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const workspaceId = req.context?.workspaceId || '00000000-0000-0000-0000-000000000001';
            const query = req.query as unknown as ListExceptionsQuery;

            const result = await ExceptionsService.listExceptions(query, workspaceId);
            sendSuccess(res, result.data, 200, result.page);
        } catch (err) {
            next(err);
        }
    };

    /**
     * GET /v1/exceptions/:id
     * Returns details of a specific exception case.
     */
    static getException = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const workspaceId = req.context?.workspaceId || '00000000-0000-0000-0000-000000000001';
            const id = req.params.id as string;

            const item = await ExceptionsService.getExceptionById(id, workspaceId);
            sendSuccess(res, item, 200);
        } catch (err) {
            next(err);
        }
    };

    /**
     * PATCH /v1/exceptions/:id
     * Update exception status, resolution notes, assignment.
     */
    static updateException = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const workspaceId = req.context?.workspaceId || '00000000-0000-0000-0000-000000000001';
            const actorId = req.context?.actorId;
            const id = req.params.id as string;
            const body = req.body as UpdateExceptionCaseInput;

            const updated = await ExceptionsService.updateException(id, workspaceId, actorId, body);
            sendSuccess(res, updated, 200);
        } catch (err) {
            next(err);
        }
    };
}
