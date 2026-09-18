import type { Request, Response, NextFunction } from 'express';

// Extend Express Request type
declare global {
    namespace Express {
        interface Request {
            context: {
                workspaceId: string;
                actorId: string;
                roles: string[];
            };
        }
    }
}

const DEFAULT_WORKSPACE_ID = '00000000-0000-0000-0000-000000000001';
const DEFAULT_ACTOR_ID = '00000000-0000-0000-0000-000000000002';

export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
    const workspaceId = (req.headers['x-workspace-id'] as string) || DEFAULT_WORKSPACE_ID;
    const actorId = (req.headers['x-actor-id'] as string) || DEFAULT_ACTOR_ID;
    const roles = req.headers['x-roles']
        ? (req.headers['x-roles'] as string).split(',').map((r) => r.trim())
        : ['operator', 'customs_broker'];

    req.context = {
        workspaceId,
        actorId,
        roles,
    };

    next();
}
