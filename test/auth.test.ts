import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createApp } from '../src/app.js';
import type { Server } from 'http';
import { requireIsolatedTestDatabase } from './helpers/database.js';
import { testPorts } from './helpers/ports.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const json = (res: Response): Promise<any> => res.json();

const PORT = 4777;
const baseUrl = `http://localhost:${PORT}`;

let server: Server;

beforeAll(() => {
    requireIsolatedTestDatabase();
    const app = createApp();
    server = app.listen(PORT);
});

afterAll(() => {
    server.close();
});

// ── Helpers ──────────────────────────────────────────────────────────────────

async function login(email: string, password: string) {
    const res = await fetch(`${baseUrl}/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
    });
    const data = await json(res);
    return { res, data };
}

function authHeaders(token: string) {
    return {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
    };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('Auth & RBAC', () => {
    let coordinatorToken: string;
    let customsToken: string;
    let managerToken: string;
    let coordinatorRefreshToken: string;

    // ── 1. Login Authentication ─────────────────────────────────────────────

    describe('1. Login & Token Generation', () => {
        it('Non-existent user returns 401 INVALID_CREDENTIALS', async () => {
            const { res, data } = await login('nonexistent@example.com', 'Password123!');
            expect(res.status).toBe(401);
            expect(data.error.code).toBe('INVALID_CREDENTIALS');
        });

        it('Wrong password returns 401 INVALID_CREDENTIALS', async () => {
            const { res, data } = await login('coordinator@yourcargocontact.com', 'WrongPassword!');
            expect(res.status).toBe(401);
            expect(data.error.code).toBe('INVALID_CREDENTIALS');
        });

        it('Coordinator login returns 200 with JWT and correct role/permissions', async () => {
            const { res, data } = await login('coordinator@yourcargocontact.com', 'Password123!');
            expect(res.status).toBe(200);
            expect(data.data.access_token).toBeTruthy();
            expect(data.data.user.roles).toContain('Sea Freight Coordinator');
            expect(data.data.user.permissions).toContain('freight.file.create');

            coordinatorToken = data.data.access_token;
            coordinatorRefreshToken = data.data.refresh_token;
        });

        it('Customs officer login returns 200 with correct role and limited permissions', async () => {
            const { res, data } = await login('customs@yourcargocontact.com', 'Password123!');
            expect(res.status).toBe(200);
            expect(data.data.user.roles).toContain('Customs');
            expect(data.data.user.permissions).not.toContain('freight.file.create');
            expect(data.data.user.permissions).toContain('freight.file.clear');

            customsToken = data.data.access_token;
        });

        it('Operations Manager login returns 200 with correct role', async () => {
            const { res, data } = await login('manager@yourcargocontact.com', 'Password123!');
            expect(res.status).toBe(200);
            expect(data.data.user.roles).toContain('Operations Manager');

            managerToken = data.data.access_token;
        });
    });

    // ── 2. Profile & JWT Middleware ──────────────────────────────────────────

    describe('2. Profile & JWT Middleware (/v1/auth/me)', () => {
        it('Unauthenticated request rejected with 401 UNAUTHORIZED', async () => {
            const res = await fetch(`${baseUrl}/v1/auth/me`);
            const data = await json(res);
            expect(res.status).toBe(401);
            expect(data.error.code).toBe('UNAUTHORIZED');
        });

        it('Tampered token rejected with 401 UNAUTHORIZED', async () => {
            const res = await fetch(`${baseUrl}/v1/auth/me`, {
                headers: { Authorization: 'Bearer invalid.token.value' },
            });
            const data = await json(res);
            expect(res.status).toBe(401);
            expect(data.error.code).toBe('UNAUTHORIZED');
        });

        it('Valid coordinator token returns user profile', async () => {
            const res = await fetch(`${baseUrl}/v1/auth/me`, {
                headers: { Authorization: `Bearer ${coordinatorToken}` },
            });
            const data = await json(res);
            expect(res.status).toBe(200);
            expect(data.data.email).toBe('coordinator@yourcargocontact.com');
        });
    });

    // ── 3. RBAC Route Guards ────────────────────────────────────────────────

    describe('3. RBAC Permission Guards', () => {
        it('Customs officer blocked with 403 FORBIDDEN when attempting file creation', async () => {
            const res = await fetch(`${baseUrl}/v1/freight/files`, {
                method: 'POST',
                headers: authHeaders(customsToken),
                body: JSON.stringify({ mode: 'sea', direction: 'import' }),
            });
            const data = await json(res);
            expect(res.status).toBe(403);
            expect(data.error.code).toBe('FORBIDDEN');
        });

        it('Coordinator successfully creates file with 201', async () => {
            const res = await fetch(`${baseUrl}/v1/freight/files`, {
                method: 'POST',
                headers: authHeaders(coordinatorToken),
                body: JSON.stringify({ mode: 'sea', direction: 'import', ...await testPorts() }),
            });
            const data = await json(res);
            expect(res.status).toBe(201);
            expect(data.data.file_no).toMatch(/^SF-2026-/);
        });

        it('Operations Manager bypasses checks and creates file with 201', async () => {
            const res = await fetch(`${baseUrl}/v1/freight/files`, {
                method: 'POST',
                headers: authHeaders(managerToken),
                body: JSON.stringify({ mode: 'sea', direction: 'export', ...await testPorts() }),
            });
            const data = await json(res);
            expect(res.status).toBe(201);
            expect(data.data.file_no).toMatch(/^SF-2026-/);
        });
    });

    // ── 4. Token Refresh & Logout ───────────────────────────────────────────

    describe('4. Token Refresh & Logout Flow', () => {
        it('Refresh without token returns 401 UNAUTHORIZED', async () => {
            const res = await fetch(`${baseUrl}/v1/auth/refresh`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({}),
            });
            const data = await json(res);
            expect(res.status).toBe(401);
            expect(data.error.code).toBe('UNAUTHORIZED');
        });

        it('Invalid refresh token returns 401 INVALID_TOKEN', async () => {
            const res = await fetch(`${baseUrl}/v1/auth/refresh`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ refresh_token: 'invalid-refresh-jwt' }),
            });
            const data = await json(res);
            expect(res.status).toBe(401);
            expect(data.error.code).toBe('INVALID_TOKEN');
        });

        it('Refresh via JSON body returns new access token', async () => {
            const res = await fetch(`${baseUrl}/v1/auth/refresh`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ refresh_token: coordinatorRefreshToken }),
            });
            const data = await json(res);
            expect(res.status).toBe(200);
            expect(data.data.access_token).toBeTruthy();
            expect(data.data.user.email).toBe('coordinator@yourcargocontact.com');
        });

        it('Refresh via Cookie header returns new access token', async () => {
            const res = await fetch(`${baseUrl}/v1/auth/refresh`, {
                method: 'POST',
                headers: {
                    Cookie: `refresh_token=${coordinatorRefreshToken}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({}),
            });
            const data = await json(res);
            expect(res.status).toBe(200);
            expect(data.data.access_token).toBeTruthy();
        });

        it('Logout requires a token to revoke', async () => {
            const res = await fetch(`${baseUrl}/v1/auth/logout`, {
                method: 'POST',
            });
            const data = await json(res);
            expect(res.status).toBe(401);
            expect(data.error.code).toBe('UNAUTHORIZED');
        });

        it('Logout revokes access and refresh tokens without affecting another login', async () => {
            const first = await login('coordinator@yourcargocontact.com', 'Password123!');
            const second = await login('coordinator@yourcargocontact.com', 'Password123!');
            const accessToken = first.data.data.access_token;
            const refreshToken = first.data.data.refresh_token;

            const before = await fetch(`${baseUrl}/v1/auth/me`, { headers: authHeaders(accessToken) });
            expect(before.status).toBe(200);

            const res = await fetch(`${baseUrl}/v1/auth/logout`, {
                method: 'POST',
                headers: authHeaders(accessToken),
            });
            const data = await json(res);
            expect(res.status).toBe(200);
            expect(data.data.logged_out).toBe(true);

            const after = await fetch(`${baseUrl}/v1/auth/me`, { headers: authHeaders(accessToken) });
            expect(after.status).toBe(401);

            const refresh = await fetch(`${baseUrl}/v1/auth/refresh`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ refresh_token: refreshToken }),
            });
            expect(refresh.status).toBe(401);

            const otherSession = await fetch(`${baseUrl}/v1/auth/me`, {
                headers: authHeaders(second.data.data.access_token),
            });
            expect(otherSession.status).toBe(200);
        });

        it('Logout with refresh cookie revokes its access token', async () => {
            const session = await login('customs@yourcargocontact.com', 'Password123!');
            const { access_token, refresh_token } = session.data.data;
            const res = await fetch(`${baseUrl}/v1/auth/logout`, {
                method: 'POST',
                headers: { Cookie: `refresh_token=${refresh_token}` },
            });
            expect(res.status).toBe(200);
            const profile = await fetch(`${baseUrl}/v1/auth/me`, { headers: authHeaders(access_token) });
            expect(profile.status).toBe(401);
        });

        it('Refresh token cannot authenticate profile requests', async () => {
            const res = await fetch(`${baseUrl}/v1/auth/me`, {
                headers: authHeaders(coordinatorRefreshToken),
            });
            expect(res.status).toBe(401);
        });
    });
});
