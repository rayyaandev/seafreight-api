import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Server } from 'http';
import { createApp } from '../src/app.js';
import { seedDatabase } from '../src/db/seeds/01_sea_freight_seed.js';
import db from '../src/db/connection.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const json = (res: Response): Promise<any> => res.json();

const PORT = 4998;
const baseUrl = `http://localhost:${PORT}`;

let server: Server;
let coordinatorHeaders: Record<string, string>;
let customsHeaders: Record<string, string>;
let managerHeaders: Record<string, string>;

beforeAll(async () => {
    await seedDatabase();
    const app = createApp();
    server = app.listen(PORT);

    // Login as Coordinator
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

    // Login as Customs (Lacks dev.simulate)
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

    // Login as Operations Manager (Has dev.simulate)
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

describe('Dev Event Simulator API (/v1/dev)', () => {
    it('GET /v1/dev/templates returns list of canned event templates', async () => {
        const res = await fetch(`${baseUrl}/v1/dev/templates`, {
            headers: coordinatorHeaders,
        });
        const data = await json(res);

        expect(res.status).toBe(200);
        expect(data.data).toBeInstanceOf(Array);
        expect(data.data.length).toBeGreaterThanOrEqual(5);

        const types = data.data.map((t: { event_type: string }) => t.event_type);
        expect(types).toContain('declaration.accepted');
        expect(types).toContain('sales.quote.won');
        expect(types).toContain('document.ocr.completed');
    });

    it('POST /v1/dev/simulate without auth returns 401 UNAUTHORIZED', async () => {
        const res = await fetch(`${baseUrl}/v1/dev/simulate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                event_type: 'declaration.accepted',
                payload: {},
            }),
        });
        const data = await json(res);

        expect(res.status).toBe(401);
        expect(data.error.code).toBe('UNAUTHORIZED');
    });

    it('POST /v1/dev/simulate with role lacking dev.simulate returns 403 FORBIDDEN', async () => {
        const res = await fetch(`${baseUrl}/v1/dev/simulate`, {
            method: 'POST',
            headers: customsHeaders,
            body: JSON.stringify({
                event_type: 'declaration.accepted',
                payload: {},
            }),
        });
        const data = await json(res);

        expect(res.status).toBe(403);
        expect(data.error.code).toBe('FORBIDDEN');
    });

    it('POST /v1/dev/simulate with invalid body returns 422 VALIDATION_ERROR', async () => {
        const res = await fetch(`${baseUrl}/v1/dev/simulate`, {
            method: 'POST',
            headers: managerHeaders,
            body: JSON.stringify({
                event_type: 'ab', // Min length 3
                payload: 'not-an-object',
            }),
        });
        const data = await json(res);

        expect(res.status).toBe(422);
        expect(data.error.code).toBe('VALIDATION_ERROR');
    });

    it('POST /v1/dev/simulate creates new Draft export file from sales.quote.won', async () => {
        const quoteId = `Q-${Date.now()}`;
        const res = await fetch(`${baseUrl}/v1/dev/simulate`, {
            method: 'POST',
            headers: managerHeaders,
            body: JSON.stringify({
                event_type: 'sales.quote.won',
                direct_dispatch: true,
                payload: {
                    quote_id: quoteId,
                    customer_name: 'Heineken Supply Chain B.V.',
                    pol: 'NLRTM',
                    pod: 'USNYC',
                    cargo_description: 'Simulated Export Cargo',
                    container_type: '40HC',
                    agreed_rate: 3450.0,
                    currency: 'EUR',
                },
            }),
        });
        const data = await json(res);

        expect(res.status).toBe(200);
        expect(data.data.simulated).toBe(true);
        expect(data.data.event_type).toBe('sales.quote.won');
        expect(data.data.dispatched_via).toBe('direct_handler');

        // Verify newly created file in DB
        const createdFile = await db('freight_file')
            .where('mode', 'sea')
            .where('direction', 'export')
            .orderBy('created_at', 'desc')
            .first();

        expect(createdFile).toBeDefined();
        expect(createdFile.status).toBe('Draft');
    });

    it('POST /v1/dev/simulate updates file status on declaration.accepted', async () => {
        // Target seeded import file SF-2026-00001
        const file = await db('freight_file').where('file_no', 'SF-2026-00001').first();
        expect(file).toBeDefined();

        const testMrn = `26NL${Date.now()}`;
        const res = await fetch(`${baseUrl}/v1/dev/simulate`, {
            method: 'POST',
            headers: managerHeaders,
            body: JSON.stringify({
                event_type: 'declaration.accepted',
                direct_dispatch: true,
                payload: {
                    file_id: file.id,
                    declaration_id: 'DEC-SIM-001',
                    mrn: testMrn,
                    accepted_at: new Date().toISOString(),
                },
            }),
        });
        const data = await json(res);

        expect(res.status).toBe(200);
        expect(data.data.simulated).toBe(true);

        // Verify dossier updated
        const updatedFile = await db('freight_file').where('id', file.id).first();
        expect(updatedFile.declaration_status).toBe('accepted');
        expect(updatedFile.mrn).toBe(testMrn);
    });
});
