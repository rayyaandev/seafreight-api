import type { Request, Response, NextFunction } from 'express';
import { AppError, sendError } from '../utils/response.js';

export function errorHandler(
    err: unknown,
    req: Request,
    res: Response,
    _next: NextFunction
): Response {
    if (err instanceof AppError) {
        return sendError(res, err.code, err.message, err.statusCode, err.field, err.details);
    }

    if (err instanceof Error) {
        console.error(`[Unhandled Error] ${err.name}: ${err.message}`, err.stack);
        return sendError(
            res,
            'INTERNAL_SERVER_ERROR',
            process.env.NODE_ENV === 'production' ? 'An unexpected error occurred' : err.message,
            500
        );
    }

    console.error('[Unknown Error]', err);
    return sendError(res, 'INTERNAL_SERVER_ERROR', 'An unexpected error occurred', 500);
}
