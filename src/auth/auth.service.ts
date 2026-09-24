import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';
import db from '../db/connection.js';
import { AppError } from '../utils/response.js';
import type { AppUserEntity, RoleEntity } from '../common/types.js';

export interface TokenPayload {
    userId: string;
    workspaceId: string;
    sessionId: string;
    tokenType: 'access';
    email: string;
    roles: string[];
    permissions: string[];
}

interface RefreshTokenPayload {
    userId: string;
    workspaceId: string;
    sessionId: string;
    tokenType: 'refresh';
}

export class AuthService {
    private static get secret(): string {
        return process.env.JWT_SECRET || 'super-secret-sea-freight-jwt-key-2026';
    }

    /** Verify the access token and its server-side session. */
    public static async verifyToken(token: string): Promise<TokenPayload> {
        let decoded: TokenPayload;
        try {
            decoded = jwt.verify(token, this.secret) as TokenPayload;
        } catch (err) {
            throw new AppError(401, 'INVALID_TOKEN', 'Session token is invalid or has expired');
        }
        if (decoded.tokenType !== 'access' || !decoded.sessionId || !decoded.userId || !decoded.workspaceId) {
            throw new AppError(401, 'INVALID_TOKEN', 'Session token is invalid or has expired');
        }
        await this.requireActiveSession(decoded.sessionId, decoded.userId, decoded.workspaceId);
        return decoded;
    }

    private static async requireActiveSession(sessionId: string, userId: string, workspaceId: string): Promise<void> {
        const session = await db('auth_session')
            .where({ id: sessionId, user_id: userId, workspace_id: workspaceId })
            .whereNull('revoked_at')
            .where('expires_at', '>', db.fn.now())
            .first();
        if (!session) {
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

        const sessionId = randomUUID();
        await db('auth_session').insert({
            id: sessionId,
            user_id: user.id,
            workspace_id: user.workspace_id,
            expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        });

        const payload: TokenPayload = {
            userId: user.id,
            workspaceId: user.workspace_id,
            sessionId,
            tokenType: 'access',
            email: user.email,
            roles: [roleName],
            permissions,
        };

        const accessToken = jwt.sign(payload, this.secret, {
            expiresIn: '15m',
        });

        const refreshToken = jwt.sign(
            { userId: user.id, workspaceId: user.workspace_id, sessionId, tokenType: 'refresh' },
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

        let payload: RefreshTokenPayload;
        try {
            payload = jwt.verify(refreshToken, this.secret) as RefreshTokenPayload;
        } catch (err) {
            throw new AppError(401, 'INVALID_TOKEN', 'Refresh token is invalid or has expired');
        }
        if (payload.tokenType !== 'refresh' || !payload.sessionId || !payload.userId || !payload.workspaceId) {
            throw new AppError(401, 'INVALID_TOKEN', 'Refresh token is invalid or has expired');
        }
        await this.requireActiveSession(payload.sessionId, payload.userId, payload.workspaceId);

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
                sessionId: payload.sessionId,
                tokenType: 'access',
                email: user.email,
                roles: [roleName],
                permissions,
            },
            this.secret,
            { expiresIn: '15m' }
        );

        const newRefreshToken = jwt.sign(
            { userId: user.id, workspaceId: user.workspace_id, sessionId: payload.sessionId, tokenType: 'refresh' },
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

    public static async logout(accessToken?: string, refreshToken?: string): Promise<void> {
        const sessions: string[] = [];
        for (const [token, tokenType] of [[accessToken, 'access'], [refreshToken, 'refresh']] as const) {
            if (!token) continue;
            let payload: TokenPayload | RefreshTokenPayload;
            try {
                payload = jwt.verify(token, this.secret) as TokenPayload | RefreshTokenPayload;
            } catch {
                // A stale token does not prevent a second valid credential from logging out.
                continue;
            }
            if (payload.tokenType === tokenType && payload.sessionId && payload.userId && payload.workspaceId) {
                const session = await db('auth_session')
                    .where({ id: payload.sessionId, user_id: payload.userId, workspace_id: payload.workspaceId })
                    .first();
                if (session) sessions.push(payload.sessionId);
            }
        }
        if (sessions.length === 0) {
            throw new AppError(401, 'UNAUTHORIZED', 'A valid access or refresh token is required');
        }
        await db('auth_session').whereIn('id', sessions).whereNull('revoked_at').update({ revoked_at: db.fn.now() });
    }
}
