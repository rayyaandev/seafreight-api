import type { Request, Response, NextFunction } from 'express';
import { AuthService } from '../auth/auth.service.js';
import { sendError } from '../utils/response.js';

declare global {
    namespace Express {
        interface Request {
            context: {
                workspaceId: string;
                actorId: string;
                email?: string;
                roles: string[];
                permissions: string[];
            };
        }
    }
}

export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
    const authHeader = req.headers.authorization;

    if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.substring(7);
        try {
            const decoded = AuthService.verifyToken(token);
            req.context = {
                workspaceId: decoded.workspaceId,
                actorId: decoded.userId,
                email: decoded.email,
                roles: decoded.roles,
                permissions: decoded.permissions,
            };
            return next();
        } catch (err) {
            sendError(res, 'UNAUTHORIZED', 'Invalid or expired authentication token', 401);
            return;
        }
    }

    // Support test mock headers when in test environment
    if (process.env.NODE_ENV === 'test' && req.headers['x-actor-id']) {
        const workspaceId = (req.headers['x-workspace-id'] as string) || '00000000-0000-0000-0000-000000000001';
        const actorId = req.headers['x-actor-id'] as string;
        const roles = req.headers['x-roles']
            ? (req.headers['x-roles'] as string).split(',').map((r) => r.trim())
            : [];
        const permissions = req.headers['x-permissions']
            ? (req.headers['x-permissions'] as string).split(',').map((p) => p.trim())
            : [];

        req.context = {
            workspaceId,
            actorId,
            roles,
            permissions,
        };
        return next();
    }

    sendError(res, 'UNAUTHORIZED', 'Authentication token is required (Authorization: Bearer <token>)', 401);
}
