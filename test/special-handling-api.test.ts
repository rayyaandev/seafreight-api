import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApp } from '../src/app.js';
import { seedDatabase } from '../src/db/seeds/01_sea_freight_seed.js';

// The seed deletes rows. This suite must never run against the configured app database.
const isolated = process.env.SECTION3_TEST_DB === '1' && process.env.DB_NAME?.startsWith('codex_section3_');

describe.skipIf(!isolated)('Section 3 API in an isolated database', () => {
    let server: Server;
    let base: string;
    let token: string;

    async function request(method: string, path: string, body?: unknown) {
        const response = await fetch(`${base}${path}`, {
            method,
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
        return { status: response.status, body: await response.json() as any };
    }

    beforeAll(async () => {
        await seedDatabase();
        server = createApp().listen(0);
        await new Promise<void>((resolve) => server.once('listening', resolve));
        base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
        const login = await fetch(`${base}/v1/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: 'coordinator@yourcargocontact.com', password: 'Password123!' }),
        });
        const loginData = ((await login.json()) as any).data;
        token = loginData.access_token;
    });

    afterAll(async () => {
        if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
    });

    it('blocks DG booking and gate-in until checklist evidence is complete', async () => {
        const created = await request('POST', '/v1/freight/files', { direction: 'export', special_handling: 'IMDG' });
        expect(created.status).toBe(201);
        expect(created.body.data.special_status).toBe('RED');
        const id = created.body.data.id;

        const blockedBook = await request('POST', `/v1/freight/files/${id}/book`, { version: created.body.data.version });
        expect(blockedBook.status).toBe(422);
        expect(blockedBook.body.error.code).toBe('SPECIAL_HANDLING_GATE_FAILED');

        const added = await request('POST', `/v1/freight/files/${id}/containers`, {
            container_number: 'DGCU1234567', type: '20DV', imdg_class: '3', un_number: 'UN1993',
            packing_group: 'II', proper_shipping_name: 'Flammable liquid', carrier_dg_accepted: true,
        });
        expect(added.status).toBe(201);
        const containerId = added.body.data.id;

        const dossier = await request('GET', `/v1/freight/files/${id}`);
        expect(dossier.body.data.special_handling_evaluation.overlays.imdg.status).toBe('RED');
        expect(dossier.body.data.exceptions.some((item: any) => item.gate_code === 'SPECIAL_HANDLING')).toBe(true);

        const blockedGateIn = await request('POST', `/v1/freight/files/${id}/containers/${containerId}/gate-in`, { version: dossier.body.data.version });
        expect(blockedGateIn.status).toBe(422);
        expect(blockedGateIn.body.error.code).toBe('SPECIAL_HANDLING_GATE_FAILED');

        const evidence = await request('PATCH', `/v1/freight/files/${id}/containers/${containerId}/special-handling`, {
            version: added.body.data.version,
            msds_attached: true, dg_declaration_attached: true,
            dg_segregation_requirements: 'No additional segregation required',
        });
        expect(evidence.status).toBe(200);
        expect(evidence.body.data.special_handling_evaluation.status).toBe('GREEN');

        const booked = await request('POST', `/v1/freight/files/${id}/book`, { version: evidence.body.data.file_version });
        expect(booked.status).toBe(200);
        const gated = await request('POST', `/v1/freight/files/${id}/containers/${containerId}/gate-in`, { version: booked.body.data.file.version });
        expect(gated.status).toBe(200);
        expect(gated.body.data.container.gate_in_at).toBeTruthy();

        const bypass = await request('POST', `/v1/freight/files/${id}/special-handling`, {
            version: gated.body.data.file_version, special_handling: 'IMDG', special_status: 'GREEN',
        });
        expect(bypass.status).toBe(422);
        const directGate = await request('POST', `/v1/freight/files/${id}/containers`, {
            container_number: 'DGCU7654321', type: '20DV', gate_in_at: new Date().toISOString(),
        });
        expect(directGate.status).toBe(422);
    });

    it('blocks reefer loading after equipment confirmation is withdrawn, then permits it when restored', async () => {
        const now = new Date().toISOString();
        const cutoff = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
        const created = await request('POST', '/v1/freight/files', {
            direction: 'export', special_handling: 'REEFER', vgm_cutoff: cutoff,
        });
        const id = created.body.data.id;
        const added = await request('POST', `/v1/freight/files/${id}/containers`, {
            container_number: 'RFCU1234567', type: '40RF', temperature_setpoint_c: -18,
            ventilation_cbm_hr: 0, humidity_percent: 65, pre_trip_inspection_passed: true,
            reefer_monitoring_confirmed: true, vgm_kg: 24000, vgm_submitted_at: now,
        });
        expect(added.status).toBe(201);
        const containerId = added.body.data.id;
        const dossier = await request('GET', `/v1/freight/files/${id}`);
        expect(dossier.body.data.special_status).toBe('GREEN');

        const booked = await request('POST', `/v1/freight/files/${id}/book`, { version: dossier.body.data.version });
        expect(booked.status).toBe(200);
        const submitted = await request('POST', `/v1/freight/files/${id}/submit-vgm`, { version: booked.body.data.file.version });
        expect(submitted.status).toBe(200);

        const failedPti = await request('PATCH', `/v1/freight/files/${id}/containers/${containerId}/special-handling`, {
            version: added.body.data.version, pre_trip_inspection_passed: false,
        });
        expect(failedPti.body.data.special_handling_evaluation.status).toBe('RED');
        const blockedLoad = await request('POST', `/v1/freight/files/${id}/load`, { version: failedPti.body.data.file_version });
        expect(blockedLoad.status).toBe(422);
        expect(blockedLoad.body.error.code).toBe('SPECIAL_HANDLING_GATE_FAILED');

        const restored = await request('PATCH', `/v1/freight/files/${id}/containers/${containerId}/special-handling`, {
            version: failedPti.body.data.container.version, pre_trip_inspection_passed: true,
        });
        expect(restored.body.data.special_handling_evaluation.status).toBe('GREEN');
        const loaded = await request('POST', `/v1/freight/files/${id}/load`, { version: restored.body.data.file_version });
        expect(loaded.status).toBe(200);
        expect(loaded.body.data.file.status).toBe('Loaded');
    });

    it('marks missing OOG dimensions RED and clears after dimensions are recorded', async () => {
        const created = await request('POST', '/v1/freight/files', { direction: 'export', special_handling: 'OOG' });
        const id = created.body.data.id;
        const added = await request('POST', `/v1/freight/files/${id}/containers`, {
            container_number: 'OOGU1234567', type: 'FR', is_oog: true,
        });
        const failed = await request('GET', `/v1/freight/files/${id}`);
        expect(failed.body.data.special_handling_evaluation.overlays.oog.status).toBe('RED');
        const order = await request('POST', `/v1/freight/files/${id}/drayage-orders`, {
            container_id: added.body.data.id, type: 'export_positioning',
            terminal_name: 'Test terminal', facility_address: '123 Test Terminal Road',
        });
        expect(order.status).toBe(201);
        const gateEvent = { event_type: 'trucking.order.updated', direct_dispatch: true,
            payload: { order_id: order.body.data.id, status: 'gate_in', gate_in_at: new Date().toISOString() } };
        const blockedEvent = await request('POST', '/v1/dev/simulate', gateEvent);
        expect(blockedEvent.status).toBe(422);
        expect(blockedEvent.body.error.code).toBe('SPECIAL_HANDLING_GATE_FAILED');
        const stillBlocked = await request('GET', `/v1/freight/files/${id}`);
        expect(stillBlocked.body.data.containers[0].gate_in_at).toBeNull();
        const fixed = await request('PATCH', `/v1/freight/files/${id}/containers/${added.body.data.id}/special-handling`, {
            version: added.body.data.version, oog_dimensions: 'L 13m x W 3m x H 4m',
        });
        expect(fixed.status).toBe(200);
        expect(fixed.body.data.special_handling_evaluation.overlays.oog.status).toBe('GREEN');
        const acceptedEvent = await request('POST', '/v1/dev/simulate', gateEvent);
        expect(acceptedEvent.status).toBe(200);
        const gated = await request('GET', `/v1/freight/files/${id}`);
        expect(gated.body.data.containers[0].gate_in_at).toBeTruthy();
        expect(gated.body.data.drayage_orders[0].gate_in_at).toBeTruthy();
    });
});
