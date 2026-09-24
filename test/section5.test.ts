import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'crypto';
import type { Server } from 'http';
import db from '../src/db/connection.js';
import { createApp } from '../src/app.js';
import { seedDatabase, WORKSPACE_ID, USER_COORDINATOR_ID } from '../src/db/seeds/01_sea_freight_seed.js';
import { handleOperationalEvent } from '../src/bus/handlers/operational.handler.js';
import type { EventEnvelope } from '../src/common/events.js';
import { testPorts } from './helpers/ports.js';

const run = process.env.SECTION5_TEST_DB === '1';
const base = 'http://127.0.0.1:4992';
const headers = { 'Content-Type': 'application/json', 'x-actor-id': USER_COORDINATOR_ID,
    'x-workspace-id': WORKSPACE_ID, 'x-permissions': 'freight.file.create,freight.file.read,freight.file.update,freight.file.release_bl,freight.file.record_ata,freight.file.clear' };
let server: Server;
function event(type: string, payload: Record<string, unknown>, workspace = WORKSPACE_ID, id = randomUUID()): EventEnvelope {
    return { id, type, payload, workspace_id: workspace, actor: 'system',
        occurred_at: new Date().toISOString(), version: 1 };
}
async function request(method: string, path: string, body?: unknown) {
    const payload = method === 'POST' && path === '/v1/freight/files'
        ? { ...await testPorts(), ...(body as object) } : body;
    const res = await fetch(`${base}${path}`, { method, headers,
        ...(payload === undefined ? {} : { body: JSON.stringify(payload) }) });
    return { status: res.status, body: await res.json() as any };
}

describe.skipIf(!run)('Section 5 operational flow', () => {
    beforeAll(async () => {
        if (!process.env.DB_NAME?.startsWith('codex_section5_')) throw new Error('Isolated Section 5 database required');
        await seedDatabase();
        server = createApp().listen(4992);
    });
    afterAll(() => server?.close());

    it('creates Trucking request, links reply, records collected and delivered once', async () => {
        const file = await request('POST', '/v1/freight/files', { direction: 'import' });
        expect(file.status).toBe(201);
        const fileId = file.body.data.id;
        const container = await request('POST', `/v1/freight/files/${fileId}/containers`,
            { container_number: 'TSTU5550001', type: '40HC' });
        expect(container.status).toBe(201);
        const created = await request('POST', `/v1/freight/files/${fileId}/drayage-orders`, {
            type: 'import_delivery', terminal_name: 'Test Terminal', facility_address: '123 Terminal Road',
            pickup_address: '123 Terminal Road', delivery_address: '555 Customer Road',
            container_id: container.body.data.id,
        });
        expect(created.status).toBe(201);
        const orderId = created.body.data.id;
        const outgoing = await db('outbox').where({ event_type: 'trucking.order.create.requested' }).first();
        expect(JSON.parse(outgoing.payload).drayage_order_id).toBe(orderId);
        expect(JSON.parse(outgoing.payload).delivery_address).toBe('555 Customer Road');

        await expect(handleOperationalEvent(event('trucking.order.linked', {
            drayage_order_id: orderId, trucking_order_id: 'EXT-555' }, 'other-workspace'))).rejects.toThrow();
        const linked = event('trucking.order.linked', { drayage_order_id: orderId,
            trucking_order_id: 'EXT-555', status: 'scheduled' });
        await handleOperationalEvent(linked);
        await handleOperationalEvent(linked);
        expect((await db('drayage_order').where({ id: orderId }).first()).trucking_order_id).toBe('EXT-555');

        const placeholder = await request('POST', `/v1/freight/files/${fileId}/milestones`,
            { milestone_type: 'collected' });
        expect(placeholder.body.data.source).toBe('manual');

        const collected = event('trucking.order.updated', { trucking_order_id: 'EXT-555',
            status: 'collected', actual_pickup_at: '2026-09-24T09:00:00Z' });
        await handleOperationalEvent(collected);
        await handleOperationalEvent(collected);
        const gateIn = event('trucking.order.updated', { trucking_order_id: 'EXT-555',
            status: 'gate_in', gate_in_at: '2026-09-24T10:00:00Z' });
        await handleOperationalEvent(gateIn);
        expect((await db('freight_container').where({ id: container.body.data.id }).first()).gate_in_at).toBeTruthy();
        expect(await db('milestone').where({ freight_file_id: fileId, milestone_type: 'collected' }).count('id as n').first()).toMatchObject({ n: 1 });
        expect((await db('milestone').where({ freight_file_id: fileId, milestone_type: 'collected' }).first()).source).toBe('trucking');

        const edit = await request('PATCH', `/v1/freight/files/${fileId}/drayage-orders/${orderId}`,
            { version: (await db('drayage_order').where({ id: orderId }).first()).version,
                planned_delivery_at: '2026-09-25T12:00:00Z' });
        expect(edit.status).toBe(200);
        expect(await db('outbox').where({ event_type: 'trucking.order.update.requested' }).first()).toBeTruthy();

        // Physical delivery records milestone. Parent file moves only when Cleared with POD.
        await db('freight_file').where({ id: fileId }).update({ status: 'Cleared' });
        const deliveredWithoutPod = event('trucking.order.updated', { trucking_order_id: 'EXT-555',
            status: 'delivered', delivered_at: '2026-09-24T14:00:00Z' });
        await handleOperationalEvent(deliveredWithoutPod);
        expect((await db('freight_file').where({ id: fileId }).first()).status).toBe('Cleared');
        const deliveredWithPod = event('trucking.order.updated', { trucking_order_id: 'EXT-555',
            status: 'delivered', delivered_at: '2026-09-24T14:00:00Z', pod_signature_ref: 'POD-555' });
        await handleOperationalEvent(deliveredWithPod);
        await handleOperationalEvent(deliveredWithPod);
        expect((await db('freight_file').where({ id: fileId }).first()).status).toBe('Delivered');
        expect(await db('outbox').where({ event_type: 'freight.file.delivered' }).count('id as n').first()).toMatchObject({ n: 1 });
        expect(await db('milestone').where({ freight_file_id: fileId, milestone_type: 'delivered' }).count('id as n').first()).toMatchObject({ n: 1 });
    });

    it('cancels drayage order with version and emits request', async () => {
        const file = await request('POST', '/v1/freight/files', { direction: 'export' });
        const created = await request('POST', `/v1/freight/files/${file.body.data.id}/drayage-orders`, {
            type: 'export_positioning', terminal_name: 'Test Terminal', facility_address: '123 Terminal Road',
        });
        const cancelled = await request('POST', `/v1/freight/files/${file.body.data.id}/drayage-orders/${created.body.data.id}/cancel`,
            { version: 1 });
        expect(cancelled.status).toBe(200);
        expect(cancelled.body.data.status).toBe('cancelled');
        expect(await db('outbox').where({ event_type: 'trucking.order.cancel.requested' }).first()).toBeTruthy();
        const stale = await request('POST', `/v1/freight/files/${file.body.data.id}/drayage-orders/${created.body.data.id}/cancel`,
            { version: 1 });
        expect(stale.status).toBe(409);
    });

    it('shows T1 documents and bonded events on dossier; WMS enforces workspace and dedup', async () => {
        const file = await request('POST', '/v1/freight/files', { direction: 'import' });
        const fileId = file.body.data.id;
        const doc = await request('POST', `/v1/freight/files/${fileId}/documents`,
            { doc_type: 't1_document', file_name: 'transit.pdf' });
        expect(doc.status).toBe(201);
        const opened = await request('POST', `/v1/freight/files/${fileId}/bonded-events`, {
            event_type: 't1_open', mrn: 'T1-MRN-1', document_id: doc.body.data.id,
        });
        expect(opened.status).toBe(201);
        const inbound = event('wms.event', { file_id: fileId, event_type: 'inslag',
            bonded_warehouse_ref: 'WAREHOUSE-1', occurred_at: '2026-09-24T12:00:00Z' });
        await expect(handleOperationalEvent({ ...inbound, workspace_id: 'other-workspace' })).rejects.toThrow();
        await handleOperationalEvent(inbound);
        await handleOperationalEvent(inbound);
        const dossier = await request('GET', `/v1/freight/files/${fileId}`);
        expect(dossier.body.data.bonded_events).toHaveLength(2);
        expect(dossier.body.data.bonded_events[0].document_id).toBe(doc.body.data.id);
        const listed = await request('GET', `/v1/freight/files/${fileId}/bonded-events`);
        expect(listed.body.data).toHaveLength(2);
    });

    it('records sailed, arrived and customs-cleared milestones from real file actions', async () => {
        const file = await request('POST', '/v1/freight/files', { direction: 'import' });
        const id = file.body.data.id;
        const bl = await request('POST', `/v1/freight/files/${id}/bills-of-lading`,
            { type: 'MBL', bl_number: 'MILESTONE-BL', telex_release: true });
        expect(bl.status).toBe(201);
        const atd = await request('PATCH', `/v1/freight/files/${id}`,
            { version: 1, atd: '2026-09-23T08:00:00Z' });
        expect(atd.status).toBe(200);
        const release = await request('POST', `/v1/freight/files/${id}/release-bl`, { version: atd.body.data.version });
        expect(release.status).toBe(200);
        const arrival = await request('POST', `/v1/freight/files/${id}/record-ata`,
            { version: release.body.data.file.version, ata: '2026-09-24T08:00:00Z' });
        expect(arrival.status).toBe(200);
        const submit = await request('POST', `/v1/integrations/files/${id}/customs`,
            { version: arrival.body.data.file.version });
        expect(submit.status).toBe(202);
        const { handleSection4Event } = await import('../src/bus/handlers/section4.handler.js');
        await handleSection4Event(event('portbase.container.released',
            { file_id: id, released_at: '2026-09-24T09:00:00Z' }));
        await handleSection4Event(event('declaration.accepted', { file_id: id,
            declaration_id: submit.body.data.declaration_id, mrn: 'MRN-5' }));
        const milestones = await db('milestone').where({ freight_file_id: id }).orderBy('timestamp');
        expect(milestones.map((m) => m.milestone_type).sort()).toEqual(['arrived', 'customs_cleared', 'sailed']);
        const cleared = await db('freight_file').where({ id }).first();
        expect(cleared.status).toBe('Cleared');
        const manual = await request('POST', `/v1/freight/files/${id}/milestones`,
            { milestone_type: 'arrived', source: 'system' });
        expect(manual.status).toBe(201);
        expect(manual.body.data.source).toBe('vessel');
        expect(await db('milestone').where({ freight_file_id: id, milestone_type: 'arrived' }).count('id as n').first()).toMatchObject({ n: 1 });
    });
});
