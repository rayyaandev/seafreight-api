import { createApp } from '../src/app.js';
import type { Server } from 'http';

async function runAuthTests() {
    console.log('🧪 Starting Auth & RBAC Test Suite...\n');

    const app = createApp();
    const server: Server = app.listen(4777);
    const baseUrl = 'http://localhost:4777';

    let passed = 0;
    let failed = 0;

    function assert(condition: boolean, testName: string, detail?: unknown) {
        if (condition) {
            console.log(`  ✅ PASS: ${testName}`);
            passed++;
        } else {
            console.error(`  ❌ FAIL: ${testName}`, detail || '');
            failed++;
        }
    }

    try {
        // --------------------------------------------------------------------
        // 1. Login Authentication Tests
        // --------------------------------------------------------------------
        console.log('--- 1. Login & Token Generation ---');

        // Non-existent user
        const nonExistentRes = await fetch(`${baseUrl}/v1/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                email: 'nonexistent@example.com',
                password: 'Password123!',
            }),
        });
        const nonExistentData = await nonExistentRes.json();
        assert(nonExistentRes.status === 401 && nonExistentData.error.code === 'INVALID_CREDENTIALS', 'Non-existent user returns 401 INVALID_CREDENTIALS');

        // Wrong password
        const wrongPasswordRes = await fetch(`${baseUrl}/v1/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                email: 'coordinator@yourcargocontact.com',
                password: 'WrongPassword!',
            }),
        });
        const wrongPasswordData = await wrongPasswordRes.json();
        assert(wrongPasswordRes.status === 401 && wrongPasswordData.error.code === 'INVALID_CREDENTIALS', 'Wrong password returns 401 INVALID_CREDENTIALS');

        // Valid Coordinator login
        const coordLoginRes = await fetch(`${baseUrl}/v1/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                email: 'coordinator@yourcargocontact.com',
                password: 'Password123!',
            }),
        });
        const coordLoginData = await coordLoginRes.json();
        assert(coordLoginRes.status === 200, 'Coordinator login returns status 200');
        assert(Boolean(coordLoginData.data.access_token), 'Returns JWT access token');
        assert(coordLoginData.data.user.roles.includes('Sea Freight Coordinator'), 'Identifies Sea Freight Coordinator role');
        assert(coordLoginData.data.user.permissions.includes('freight.file.create'), 'Permissions include freight.file.create');

        const coordinatorToken = coordLoginData.data.access_token;

        // Valid Customs login
        const customsLoginRes = await fetch(`${baseUrl}/v1/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                email: 'customs@yourcargocontact.com',
                password: 'Password123!',
            }),
        });
        const customsLoginData = await customsLoginRes.json();
        assert(customsLoginRes.status === 200, 'Customs officer login returns status 200');
        assert(customsLoginData.data.user.roles.includes('Customs'), 'Identifies Customs role');
        assert(!customsLoginData.data.user.permissions.includes('freight.file.create'), 'Customs lacks freight.file.create permission');
        assert(customsLoginData.data.user.permissions.includes('freight.file.clear'), 'Customs holds freight.file.clear permission');

        const customsToken = customsLoginData.data.access_token;

        // Valid Manager login
        const managerLoginRes = await fetch(`${baseUrl}/v1/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                email: 'manager@yourcargocontact.com',
                password: 'Password123!',
            }),
        });
        const managerLoginData = await managerLoginRes.json();
        assert(managerLoginRes.status === 200, 'Operations Manager login returns status 200');
        assert(managerLoginData.data.user.roles.includes('Operations Manager'), 'Identifies Operations Manager role');

        const managerToken = managerLoginData.data.access_token;

        // --------------------------------------------------------------------
        // 2. Profile & Token Verification (/v1/auth/me)
        // --------------------------------------------------------------------
        console.log('\n--- 2. Profile & JWT Middleware (/v1/auth/me) ---');

        // Request without token
        const noTokenRes = await fetch(`${baseUrl}/v1/auth/me`);
        const noTokenData = await noTokenRes.json();
        assert(noTokenRes.status === 401 && noTokenData.error.code === 'UNAUTHORIZED', 'Unauthenticated request to /v1/auth/me rejected with 401 UNAUTHORIZED');

        // Request with invalid/tampered token
        const invalidTokenRes = await fetch(`${baseUrl}/v1/auth/me`, {
            headers: { Authorization: 'Bearer invalid.token.value' },
        });
        const invalidTokenData = await invalidTokenRes.json();
        assert(invalidTokenRes.status === 401 && invalidTokenData.error.code === 'UNAUTHORIZED', 'Tampered token rejected with 401 UNAUTHORIZED');

        // Request with valid coordinator token
        const meRes = await fetch(`${baseUrl}/v1/auth/me`, {
            headers: { Authorization: `Bearer ${coordinatorToken}` },
        });
        const meData = await meRes.json();
        assert(meRes.status === 200 && meData.data.email === 'coordinator@yourcargocontact.com', 'Authenticated profile /v1/auth/me returns user data');

        // --------------------------------------------------------------------
        // 3. RBAC Route Guard Checks
        // --------------------------------------------------------------------
        console.log('\n--- 3. RBAC Permission Guards ---');

        // Customs officer trying to CREATE a file (lacks freight.file.create) -> 403 Forbidden
        const customsCreateRes = await fetch(`${baseUrl}/v1/freight/files`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${customsToken}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                mode: 'sea',
                direction: 'import',
            }),
        });
        const customsCreateData = await customsCreateRes.json();
        assert(customsCreateRes.status === 403 && customsCreateData.error.code === 'FORBIDDEN', 'Customs officer blocked with 403 FORBIDDEN when attempting file creation');

        // Coordinator with freight.file.create -> 201 Created
        const coordCreateRes = await fetch(`${baseUrl}/v1/freight/files`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${coordinatorToken}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                mode: 'sea',
                direction: 'import',
            }),
        });
        const coordCreateData = await coordCreateRes.json();
        assert(coordCreateRes.status === 201 && coordCreateData.data.file_no.startsWith('SF-2026-'), 'Coordinator successfully creates file with 201');

        // Operations Manager (super-role) bypasses permission checks -> 201 Created
        const managerCreateRes = await fetch(`${baseUrl}/v1/freight/files`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${managerToken}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                mode: 'sea',
                direction: 'export',
            }),
        });
        const managerCreateData = await managerCreateRes.json();
        assert(managerCreateRes.status === 201 && managerCreateData.data.file_no.startsWith('SF-2026-'), 'Operations Manager bypasses checks and creates file with 201');

        // --------------------------------------------------------------------
        // 4. Token Refresh & Logout Tests (/v1/auth/refresh & /v1/auth/logout)
        // --------------------------------------------------------------------
        console.log('\n--- 4. Token Refresh & Logout Flow ---');

        const coordinatorRefreshToken = coordLoginData.data.refresh_token;

        // Refresh without token
        const noRefreshRes = await fetch(`${baseUrl}/v1/auth/refresh`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
        });
        const noRefreshData = await noRefreshRes.json();
        assert(noRefreshRes.status === 401 && noRefreshData.error.code === 'UNAUTHORIZED', 'Refresh request without token returns 401 UNAUTHORIZED');

        // Refresh with invalid token
        const invalidRefreshRes = await fetch(`${baseUrl}/v1/auth/refresh`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ refresh_token: 'invalid-refresh-jwt' }),
        });
        const invalidRefreshData = await invalidRefreshRes.json();
        assert(invalidRefreshRes.status === 401 && invalidRefreshData.error.code === 'INVALID_TOKEN', 'Invalid refresh token returns 401 INVALID_TOKEN');

        // Refresh via JSON body
        const bodyRefreshRes = await fetch(`${baseUrl}/v1/auth/refresh`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ refresh_token: coordinatorRefreshToken }),
        });
        const bodyRefreshData = await bodyRefreshRes.json();
        assert(bodyRefreshRes.status === 200, 'Refresh via JSON body returns status 200');
        assert(Boolean(bodyRefreshData.data.access_token), 'Returns a new access token');
        assert(bodyRefreshData.data.user.email === 'coordinator@yourcargocontact.com', 'Refreshed session preserves user identity and permissions');

        // Refresh via Cookie header
        const cookieRefreshRes = await fetch(`${baseUrl}/v1/auth/refresh`, {
            method: 'POST',
            headers: {
                Cookie: `refresh_token=${coordinatorRefreshToken}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({}),
        });
        const cookieRefreshData = await cookieRefreshRes.json();
        assert(cookieRefreshRes.status === 200, 'Refresh via Cookie header returns status 200');
        assert(Boolean(cookieRefreshData.data.access_token), 'Returns new access token from cookie session');

        // Logout
        const logoutRes = await fetch(`${baseUrl}/v1/auth/logout`, {
            method: 'POST',
        });
        const logoutData = await logoutRes.json();
        assert(logoutRes.status === 200 && logoutData.data.logged_out === true, 'Logout clears session and returns 200');
    } catch (err) {
        console.error('Test execution error:', err);
        failed++;
    } finally {
        server.close();
        console.log(`\n======================================================`);
        console.log(`📊 Auth & RBAC Test Suite Summary: ${passed} passed, ${failed} failed.`);
        console.log(`======================================================\n`);
        process.exit(failed > 0 ? 1 : 0);
    }
}

runAuthTests();
