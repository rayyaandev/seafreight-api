import type { Request, Response, NextFunction } from 'express';
import { sendError } from '../utils/response.js';

/**
 * RBAC Permission Guard Middleware
 * Refuses with 403 Forbidden if the authenticated actor lacks the declared permission.
 */
export function requirePermission(permissionCode: string) {
    return (req: Request, res: Response, next: NextFunction): void => {
        const { permissions = [], roles = [] } = req.context || {};

        // Operations Manager & Administrator bypass checks
        if (roles.includes('Operations Manager') || roles.includes('Administrator')) {
            return next();
        }

        if (!permissions.includes(permissionCode)) {
            sendError(
                res,
                'FORBIDDEN',
                `Access denied: missing required permission '${permissionCode}'`,
                403,
                undefined,
                { required_permission: permissionCode, granted_permissions: permissions }
            );
            return;
        }

        next();
    };
}

/**
 * Role Guard Middleware
 * Refuses with 403 Forbidden if the authenticated actor does not hold the required role.
 */
export function requireRole(roleName: string) {
    return (req: Request, res: Response, next: NextFunction): void => {
        const { roles = [] } = req.context || {};

        if (roles.includes('Operations Manager') || roles.includes('Administrator')) {
            return next();
        }

        if (!roles.includes(roleName)) {
            sendError(
                res,
                'FORBIDDEN',
                `Access denied: requires '${roleName}' role`,
                403,
                undefined,
                { required_role: roleName, current_roles: roles }
            );
            return;
        }

        next();
    };
}
