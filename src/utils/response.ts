import type { Response } from 'express';

export interface ApiResponse<T> {
    data: T;
    page?: {
        next_cursor?: string | null;
        total?: number;
        limit?: number;
    };
}

export interface ApiErrorResponse {
    error: {
        code: string;
        message: string;
        field?: string;
        details?: unknown;
    };
}

export function sendSuccess<T>(res: Response, data: T, statusCode = 200, page?: ApiResponse<T>['page']): Response {
    const body: ApiResponse<T> = { data };
    if (page) {
        body.page = page;
    }
    return res.status(statusCode).json(body);
}

export function sendError(
    res: Response,
    code: string,
    message: string,
    statusCode = 400,
    field?: string,
    details?: unknown
): Response {
    const body: ApiErrorResponse = {
        error: {
            code,
            message,
            ...(field ? { field } : {}),
            ...(details ? { details } : {}),
        },
    };
    return res.status(statusCode).json(body);
}

export class AppError extends Error {
    constructor(
        public statusCode: number,
        public code: string,
        message: string,
        public field?: string,
        public details?: unknown
    ) {
        super(message);
        this.name = 'AppError';
    }
}
