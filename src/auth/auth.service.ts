import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import db from '../db/connection.js';
import { AppError } from '../utils/response.js';
import type { AppUserEntity, RoleEntity } from '../common/types.js';

export interface TokenPayload {
    userId: string;
    workspaceId: string;
    email: string;
    roles: string[];
    permissions: string[];
}

export class AuthService {
    private static get secret(): string {
        return process.env.JWT_SECRET || 'super-secret-sea-freight-jwt-key-2026';
    }

    /**
     * Swappable Token Verification Function
     * Verifies JWT signature; can be adapted for JWKS verification.
     */
    public static verifyToken(token: string): TokenPayload {
        try {
            const decoded = jwt.verify(token, this.secret) as TokenPayload;
            return decoded;
        } catch (err) {
            throw new AppError(401, 'INVALID_TOKEN', 'Session token is invalid or has expired');
        }
    }

    public static async login(email: string, passwordPlain: string) {
        const user = await db<AppUserEntity>('app_user')
            .where({ email })
            .where('is_active', true)
            .first();

        if (!user) {
            throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid email or password');
        }

        const isPasswordValid = await bcrypt.compare(passwordPlain, user.password_hash);
        if (!isPasswordValid) {
            throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid email or password');
        }

        // Fetch user role
        const role = await db<RoleEntity>('role').where({ id: user.role_id }).first();
        const roleName = role ? role.name : 'User';

        // Fetch user permissions through role_permission join
        const permRows = await db('permission')
            .join('role_permission', 'permission.id', 'role_permission.permission_id')
            .where('role_permission.role_id', user.role_id)
            .select<{ code: string }[]>('permission.code');

        const permissions = permRows.map((r) => r.code);

        const payload: TokenPayload = {
            userId: user.id,
            workspaceId: user.workspace_id,
            email: user.email,
            roles: [roleName],
            permissions,
        };

        const accessToken = jwt.sign(payload, this.secret, {
            expiresIn: '15m',
        });

        const refreshToken = jwt.sign(
            { userId: user.id, workspaceId: user.workspace_id },
            this.secret,
            { expiresIn: '7d' }
        );

        return {
            access_token: accessToken,
            refresh_token: refreshToken,
            user: {
                id: user.id,
                email: user.email,
                name: user.name,
                workspace_id: user.workspace_id,
                roles: [roleName],
                permissions,
            },
        };
    }

    public static async getProfile(userId: string, workspaceId: string) {
        const user = await db<AppUserEntity>('app_user')
            .where({ id: userId, workspace_id: workspaceId })
            .where('is_active', true)
            .first();

        if (!user) {
            throw new AppError(404, 'NOT_FOUND', 'User profile not found');
        }

        const role = await db<RoleEntity>('role').where({ id: user.role_id }).first();
        const roleName = role ? role.name : 'User';

        const permRows = await db('permission')
            .join('role_permission', 'permission.id', 'role_permission.permission_id')
            .where('role_permission.role_id', user.role_id)
            .select<{ code: string }[]>('permission.code');

        return {
            id: user.id,
            email: user.email,
            name: user.name,
            workspace_id: user.workspace_id,
            roles: [roleName],
            permissions: permRows.map((r) => r.code),
        };
    }

    public static async refresh(refreshToken: string) {
        if (!refreshToken) {
            throw new AppError(401, 'UNAUTHORIZED', 'Refresh token is required');
        }

        let payload: { userId: string; workspaceId: string };
        try {
            payload = jwt.verify(refreshToken, this.secret) as { userId: string; workspaceId: string };
        } catch (err) {
            throw new AppError(401, 'INVALID_TOKEN', 'Refresh token is invalid or has expired');
        }

        const user = await db<AppUserEntity>('app_user')
            .where({ id: payload.userId, workspace_id: payload.workspaceId })
            .where('is_active', true)
            .first();

        if (!user) {
            throw new AppError(401, 'INVALID_CREDENTIALS', 'User account is inactive or not found');
        }

        const role = await db<RoleEntity>('role').where({ id: user.role_id }).first();
        const roleName = role ? role.name : 'User';

        const permRows = await db('permission')
            .join('role_permission', 'permission.id', 'role_permission.permission_id')
            .where('role_permission.role_id', user.role_id)
            .select<{ code: string }[]>('permission.code');

        const permissions = permRows.map((r) => r.code);

        const newAccessToken = jwt.sign(
            {
                userId: user.id,
                workspaceId: user.workspace_id,
                email: user.email,
                roles: [roleName],
                permissions,
            },
            this.secret,
            { expiresIn: '15m' }
        );

        const newRefreshToken = jwt.sign(
            { userId: user.id, workspaceId: user.workspace_id },
            this.secret,
            { expiresIn: '7d' }
        );

        return {
            access_token: newAccessToken,
            refresh_token: newRefreshToken,
            user: {
                id: user.id,
                email: user.email,
                name: user.name,
                workspace_id: user.workspace_id,
                roles: [roleName],
                permissions,
            },
        };
    }
}

