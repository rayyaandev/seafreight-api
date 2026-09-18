import type { Request, Response, NextFunction } from 'express';
import { type ZodType, ZodError } from 'zod';
import { sendError } from '../utils/response.js';

export function validateBody<T>(schema: ZodType<T>) {
    return (req: Request, res: Response, next: NextFunction): void => {
        const result = schema.safeParse(req.body);
        if (!result.success) {
            const firstError = result.error.issues[0];
            const field = firstError?.path.join('.') || 'body';
            const message = firstError?.message || 'Validation error';
            sendError(res, 'VALIDATION_ERROR', message, 422, field, result.error.format());
            return;
        }
        req.body = result.data;
        next();
    };
}

export function validateQuery<T>(schema: ZodType<T>) {
    return (req: Request, res: Response, next: NextFunction): void => {
        const result = schema.safeParse(req.query);
        if (!result.success) {
            const firstError = result.error.issues[0];
            const field = firstError?.path.join('.') || 'query';
            const message = firstError?.message || 'Query validation error';
            sendError(res, 'VALIDATION_ERROR', message, 422, field, result.error.format());
            return;
        }
        for (const key of Object.keys(req.query)) {
            delete (req.query as any)[key];
        }
        Object.assign(req.query, result.data);
        next();
    };
}
