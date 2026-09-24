import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Server } from 'http';
import { createApp } from '../src/app.js';
import db from '../src/db/connection.js';
import { requireIsolatedTestDatabase } from './helpers/database.js';
import { testPorts } from './helpers/ports.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const json = (res: Response): Promise<any> => res.json();

const PORT = 4997;
const baseUrl = `http://localhost:${PORT}`;

let server: Server;
let coordinatorHeaders: Record<string, string>;
let customsHeaders: Record<string, string>;
let managerHeaders: Record<string, string>;

beforeAll(async () => {
    requireIsolatedTestDatabase();
    const app = createApp();
    server = app.listen(PORT);

    // 1. Coordinator: has exceptions.read and exceptions.write
    const coordRes = await fetch(`${baseUrl}/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            email: 'coordinator@yourcargocontact.com',
            password: 'Password123!',
        }),
    });
    const coordData = await json(coordRes);
    coordinatorHeaders = {
        Authorization: `Bearer ${coordData.data.access_token}`,
        'Content-Type': 'application/json',
    };

    // 2. Customs: has exceptions.read but NOT exceptions.write
    const customsRes = await fetch(`${baseUrl}/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            email: 'customs@yourcargocontact.com',
            password: 'Password123!',
        }),
    });
    const customsData = await json(customsRes);
    customsHeaders = {
        Authorization: `Bearer ${customsData.data.access_token}`,
        'Content-Type': 'application/json',
    };

    // 3. Operations Manager: admin authority
    const mgrRes = await fetch(`${baseUrl}/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            email: 'manager@yourcargocontact.com',
            password: 'Password123!',
        }),
    });
    const mgrData = await json(mgrRes);
    managerHeaders = {
        Authorization: `Bearer ${mgrData.data.access_token}`,
        'Content-Type': 'application/json',
    };
});

afterAll(() => {
    server.close();
});

describe('Cross-Dossier Exception Hub API (/v1/exceptions)', () => {
    let existingCaseId: string;
    let existingCaseVersion: number;
    let testFileId: string;

    it('GET /v1/exceptions without auth returns 401 UNAUTHORIZED', async () => {
        const res = await fetch(`${baseUrl}/v1/exceptions`);
        const data = await json(res);
        expect(res.status).toBe(401);
        expect(data.error.code).toBe('UNAUTHORIZED');
    });

    it('GET /v1/exceptions returns list of exceptions with pagination and joined file metadata', async () => {
        const res = await fetch(`${baseUrl}/v1/exceptions`, {
            headers: coordinatorHeaders,
        });
        const data = await json(res);

        expect(res.status).toBe(200);
        expect(data.data).toBeInstanceOf(Array);
        expect(data.data.length).toBeGreaterThan(0);
        expect(data.page).toBeDefined();
        expect(data.page.total).toBeGreaterThan(0);

        const first = data.data[0];
        expect(first.id).toBeDefined();
        expect(first.file_no).toBeDefined();
        expect(first.file_direction).toBeDefined();
        expect(first.file_status).toBeDefined();

        existingCaseId = first.id;
        existingCaseVersion = first.version;
        testFileId = first.freight_file_id;
    });

    it('GET /v1/exceptions?status=Open filters by Open status', async () => {
        const res = await fetch(`${baseUrl}/v1/exceptions?status=Open`, {
            headers: coordinatorHeaders,
        });
        const data = await json(res);

        expect(res.status).toBe(200);
        for (const item of data.data) {
            expect(item.status).toBe('Open');
        }
    });

    it('GET /v1/exceptions?file_id=:file_id filters by dossier', async () => {
        const res = await fetch(`${baseUrl}/v1/exceptions?file_id=${testFileId}`, {
            headers: coordinatorHeaders,
        });
        const data = await json(res);

        expect(res.status).toBe(200);
        for (const item of data.data) {
            expect(item.freight_file_id).toBe(testFileId);
        }
    });

    it('GET /v1/exceptions/:id returns single exception details', async () => {
        const res = await fetch(`${baseUrl}/v1/exceptions/${existingCaseId}`, {
            headers: customsHeaders, // Customs has exceptions.read
        });
        const data = await json(res);

        expect(res.status).toBe(200);
        expect(data.data.id).toBe(existingCaseId);
        expect(data.data.file_no).toBeDefined();
    });

    it('GET /v1/exceptions/:id with invalid ID returns 404 NOT_FOUND', async () => {
        const res = await fetch(`${baseUrl}/v1/exceptions/00000000-0000-0000-0000-000000000999`, {
            headers: coordinatorHeaders,
        });
        const data = await json(res);

        expect(res.status).toBe(404);
        expect(data.error.code).toBe('NOT_FOUND');
    });

    it('PATCH /v1/exceptions/:id by user without exceptions.write returns 403 FORBIDDEN', async () => {
        const res = await fetch(`${baseUrl}/v1/exceptions/${existingCaseId}`, {
            method: 'PATCH',
            headers: customsHeaders, // Customs lacks exceptions.write
            body: JSON.stringify({
                status: 'InProgress',
            }),
        });
        const data = await json(res);

        expect(res.status).toBe(403);
        expect(data.error.code).toBe('FORBIDDEN');
    });

    it('PATCH /v1/exceptions/:id with stale version returns 409 CONFLICT', async () => {
        const res = await fetch(`${baseUrl}/v1/exceptions/${existingCaseId}`, {
            method: 'PATCH',
            headers: coordinatorHeaders,
            body: JSON.stringify({
                status: 'InProgress',
                version: existingCaseVersion + 99,
            }),
        });
        const data = await json(res);

        expect(res.status).toBe(409);
        expect(data.error.code).toBe('CONFLICT');
    });

    it('PATCH /v1/exceptions/:id resolves exception and records resolver', async () => {
        const res = await fetch(`${baseUrl}/v1/exceptions/${existingCaseId}`, {
            method: 'PATCH',
            headers: coordinatorHeaders,
            body: JSON.stringify({
                status: 'Resolved',
                resolution_notes: 'Issue verified and resolved with shipping carrier.',
                version: existingCaseVersion,
            }),
        });
        const data = await json(res);

        expect(res.status).toBe(200);
        expect(data.data.status).toBe('Resolved');
        expect(data.data.resolution_notes).toBe('Issue verified and resolved with shipping carrier.');
        expect(data.data.resolved_by).toBeDefined();
        expect(data.data.resolved_at).toBeDefined();
    });

    // ── Critical Exception Blocking Tests ────────────────────────────────────

    it('Active critical exception blocks file transition with 422 CRITICAL_EXCEPTION_BLOCKED', async () => {
        const created = await fetch(`${baseUrl}/v1/freight/files`, {
            method: 'POST', headers: coordinatorHeaders,
            body: JSON.stringify({ direction: 'export', ...await testPorts(),
                vgm_cutoff: new Date(Date.now() + 24 * 3600 * 1000).toISOString() }),
        });
        expect(created.status).toBe(201);
        const file = (await json(created)).data;
        const booked = await fetch(`${baseUrl}/v1/freight/files/${file.id}/book`, {
            method: 'POST', headers: coordinatorHeaders, body: JSON.stringify({ version: file.version }),
        });
        expect(booked.status).toBe(200);
        const container = await fetch(`${baseUrl}/v1/freight/files/${file.id}/containers`, {
            method: 'POST', headers: coordinatorHeaders,
            body: JSON.stringify({ container_number: 'CRIT1234567', type: '40HC', vgm_kg: 24000,
                vgm_submitted_at: new Date().toISOString() }),
        });
        expect(container.status).toBe(201);
        const readyFile = await json(await fetch(`${baseUrl}/v1/freight/files/${file.id}`, {
            headers: coordinatorHeaders,
        }));
        const submitted = await fetch(`${baseUrl}/v1/freight/files/${file.id}/submit-vgm`, {
            method: 'POST', headers: coordinatorHeaders,
            body: JSON.stringify({ version: readyFile.data.version }),
        });
        expect(submitted.status).toBe(200);
        const readyVersion = (await json(submitted)).data.file.version;

        // 1. Add critical exception case to the file
        const addCaseRes = await fetch(`${baseUrl}/v1/freight/files/${file.id}/exceptions`, {
            method: 'POST',
            headers: coordinatorHeaders,
            body: JSON.stringify({
                type: 'carrier_hold',
                severity: 'critical',
                title: 'Carrier critical hold: Missing hazmat declaration certification',
                description: 'Vessel operator placed hard stop on loading.',
            }),
        });
        const addCaseData = await json(addCaseRes);
        expect(addCaseRes.status).toBe(201);
        const criticalCaseId = addCaseData.data.id;

        // 2. Attempt transition to Loaded -> MUST be blocked by critical exception
        const transRes = await fetch(`${baseUrl}/v1/freight/files/${file.id}/transition`, {
            method: 'POST',
            headers: coordinatorHeaders,
            body: JSON.stringify({
                target_status: 'loaded',
                version: readyVersion,
            }),
        });
        const transData = await json(transRes);

        expect(transRes.status).toBe(422);
        expect(transData.error.code).toBe('CRITICAL_EXCEPTION_BLOCKED');

        // 3. Resolve the critical exception via Exception Hub
        const resolveRes = await fetch(`${baseUrl}/v1/exceptions/${criticalCaseId}`, {
            method: 'PATCH',
            headers: coordinatorHeaders,
            body: JSON.stringify({
                status: 'Resolved',
                resolution_notes: 'Hazmat certificate signed and verified by compliance team.',
            }),
        });
        expect(resolveRes.status).toBe(200);

        // 4. Retry transition -> now proceeds without critical blockage
        const retryTransRes = await fetch(`${baseUrl}/v1/freight/files/${file.id}/transition`, {
            method: 'POST',
            headers: coordinatorHeaders,
            body: JSON.stringify({
                target_status: 'loaded',
                version: readyVersion,
            }),
        });
        const retryData = await json(retryTransRes);

        expect(retryTransRes.status).toBe(200);
        expect(retryData.data.file.status).toBe('Loaded');
    });

    it('Failing gate auto-records an Open exception case on dossier', async () => {
        const created = await fetch(`${baseUrl}/v1/freight/files`, {
            method: 'POST', headers: coordinatorHeaders,
            body: JSON.stringify({ direction: 'import', ...await testPorts() }),
        });
        expect(created.status).toBe(201);
        const file = (await json(created)).data;
        const bill = await fetch(`${baseUrl}/v1/freight/files/${file.id}/bills-of-lading`, {
            method: 'POST', headers: coordinatorHeaders,
            body: JSON.stringify({ type: 'MBL', bl_number: 'EXCEPTION-BL', telex_release: true }),
        });
        expect(bill.status).toBe(201);
        const released = await fetch(`${baseUrl}/v1/freight/files/${file.id}/release-bl`, {
            method: 'POST', headers: coordinatorHeaders, body: JSON.stringify({ version: file.version }),
        });
        expect(released.status).toBe(200);
        const releaseVersion = (await json(released)).data.file.version;

        // 1. Advance to Arrived
        const arrivedRes = await fetch(`${baseUrl}/v1/freight/files/${file.id}/record-ata`, {
            method: 'POST',
            headers: coordinatorHeaders,
            body: JSON.stringify({
                version: releaseVersion,
            }),
        });
        expect(arrivedRes.status).toBe(200);
        const arrivalVersion = (await json(arrivedRes)).data.file.version;

        // 2. Attempt transition to Cleared -> fails CUSTOMS_RELEASE gate with 422
        const transRes = await fetch(`${baseUrl}/v1/freight/files/${file.id}/transition`, {
            method: 'POST',
            headers: coordinatorHeaders,
            body: JSON.stringify({
                target_status: 'cleared',
                version: arrivalVersion,
            }),
        });
        const transData = await json(transRes);
        expect(transRes.status).toBe(422);
        expect(transData.error.code).toBe('CUSTOMS_RELEASE_GATE_FAILED');

        // 3. Verify that an exception case for CUSTOMS_RELEASE gate was auto-created
        const exRes = await fetch(`${baseUrl}/v1/exceptions?file_id=${file.id}&gate_code=CUSTOMS_RELEASE`, {
            headers: coordinatorHeaders,
        });
        const exData = await json(exRes);

        expect(exRes.status).toBe(200);
        expect(exData.data.length).toBeGreaterThanOrEqual(1);
        expect(exData.data[0].gate_code).toBe('CUSTOMS_RELEASE');
        expect(exData.data[0].status).toBe('Open');
    });
});
