import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHmac, randomUUID } from 'crypto';
import type { Server } from 'http';
import db from '../src/db/connection.js';
import { createApp } from '../src/app.js';
import { seedDatabase, WORKSPACE_ID, USER_COORDINATOR_ID } from '../src/db/seeds/01_sea_freight_seed.js';
import { IntegrationService } from '../src/modules/integrations/integration.service.js';
import { handleSection4Event } from '../src/bus/handlers/section4.handler.js';
import type { EventEnvelope } from '../src/common/events.js';

const run = process.env.SECTION4_TEST_DB === '1';
const base = 'http://127.0.0.1:4994';
const headers = { 'Content-Type': 'application/json', 'x-actor-id': USER_COORDINATOR_ID,
    'x-workspace-id': WORKSPACE_ID, 'x-permissions': 'freight.file.create,freight.file.read,freight.file.update,freight.file.clear' };
let server: Server;
const event = (type: string, payload: Record<string, unknown>, workspace = WORKSPACE_ID, id = randomUUID()): EventEnvelope =>
    ({ id, type, payload, workspace_id: workspace, actor: 'system', occurred_at: new Date().toISOString(), version: 1 });
async function post(path: string, body: unknown) {
    const res = await fetch(`${base}${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
    return { status: res.status, body: await res.json() as any };
}

describe.skipIf(!run)('Section 4 integrations', () => {
    beforeAll(async () => {
        if (!/^codex_section[45]_/.test(process.env.DB_NAME || '')) throw new Error('Isolated test database required');
        process.env.PORTBASE_WEBHOOK_SECRET = 'test-portbase-secret';
        process.env.TERMINAL_WEBHOOK_SECRET = 'test-terminal-secret';
        await seedDatabase();
        server = createApp().listen(4994);
    });
    afterAll(() => server?.close());

    it('requires a matching submitted customs reply; release can arrive first; dedup is atomic', async () => {
        const created = await post('/v1/freight/files', { direction: 'import' });
        expect(created.status).toBe(201);
        const fileId = created.body.data.id;
        await db('freight_file').where({ id: fileId }).update({ status: 'Arrived', ata: new Date() });
        await db('bill_of_lading').insert({ id: randomUUID(), workspace_id: WORKSPACE_ID,
            freight_file_id: fileId, type: 'MBL', bl_number: 'TEST-BL-4', telex_release: true,
            original_received: false, released_at: new Date(), draft_approved: false,
            created_by: USER_COORDINATOR_ID, version: 1 });

        const spoof = await fetch(`${base}/v1/freight/files/${fileId}`, { method: 'PATCH', headers,
            body: JSON.stringify({ version: 1, declaration_status: 'accepted' }) });
        expect(spoof.status).toBe(422);
        const createSpoof = await post('/v1/freight/files', { direction: 'import',
            container_release_received_at: new Date().toISOString() });
        expect(createSpoof.status).toBe(422);
        const submit = await post(`/v1/integrations/files/${fileId}/customs`, { version: 1 });
        expect(submit.status).toBe(202);
        const declarationId = submit.body.data.declaration_id;
        const request = await db('outbox').where({ event_type: 'declaration.submit.requested' })
            .where({ workspace_id: WORKSPACE_ID }).orderBy('created_at', 'desc').first();
        expect(JSON.parse(request.payload).declaration_id).toBe(declarationId);
        await expect(handleSection4Event(event('declaration.accepted', { file_id: fileId,
            declaration_id: 'other', mrn: 'MRN-4' }))).rejects.toThrow();
        await expect(handleSection4Event(event('declaration.accepted', { file_id: fileId,
            declaration_id: declarationId, mrn: 'MRN-4' }, 'wrong-workspace'))).rejects.toThrow();
        const release = event('portbase.container.released', { file_id: fileId, released_at: new Date().toISOString() });
        await handleSection4Event(release);
        expect((await db('freight_file').where({ id: fileId }).first()).status).toBe('Arrived');
        const accepted = event('declaration.accepted', { file_id: fileId, declaration_id: declarationId, mrn: 'MRN-4' });
        await handleSection4Event(accepted);
        await handleSection4Event(accepted);
        const cleared = await db('freight_file').where({ id: fileId }).first();
        expect(cleared.status).toBe('Cleared');
        expect(cleared.mrn).toBe('MRN-4');
        expect(await db('outbox').where({ event_type: 'freight.file.cleared' }).whereRaw("JSON_EXTRACT(payload, '$.file_id') = ?", [fileId]).count('id as n').first()).toMatchObject({ n: 1 });
    });

    it('runs mock Portbase, carrier and terminal jobs; booking confirmation updates the file', async () => {
        const created = await post('/v1/freight/files', { direction: 'export' });
        expect(created.status).toBe(201);
        const fileId = created.body.data.id;
        for (const operation of ['exa', 'booking', 'schedule', 'shipping_instructions', 'bl_request', 'availability'] as const) {
            const requested = await post(`/v1/integrations/files/${fileId}/${operation}`, {});
            expect(requested.status).toBe(202);
            await IntegrationService.processOne(requested.body.data.id);
            const job = await IntegrationService.getJob(requested.body.data.id, WORKSPACE_ID);
            expect(job.status).toBe('completed');
            expect(job.result_payload.reference).toBeTruthy();
            if (operation === 'exa') {
                const reply = JSON.stringify({ event_id: `exa-${job.id}`, workspace_id: WORKSPACE_ID,
                    file_id: fileId, reference: job.result_payload.reference });
                const signature = createHmac('sha256', 'test-portbase-secret').update(reply).digest('hex');
                const response = await fetch(`${base}/v1/webhooks/portbase/message-accepted`, { method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'x-webhook-signature': `sha256=${signature}` }, body: reply });
                expect(response.status).toBe(202);
                const queued = await db('outbox').where({ event_type: 'portbase.message.accepted' }).first();
                await handleSection4Event(event('portbase.message.accepted', JSON.parse(queued.payload), WORKSPACE_ID, queued.event_id));
                expect((await IntegrationService.getJob(job.id, WORKSPACE_ID)).reply_status).toBe('accepted');
            }
            if (operation === 'booking') {
                const confirmation = await db('outbox').where({ event_type: 'carrier.booking.confirmed' })
                    .where({ workspace_id: WORKSPACE_ID }).orderBy('created_at', 'desc').first();
                await handleSection4Event(event('carrier.booking.confirmed', JSON.parse(confirmation.payload)));
                const file = await db('freight_file').where({ id: fileId }).first();
                expect(file.status).toBe('Booked');
                expect(file.carrier_booking_ref).toBeTruthy();
                expect(file.doc_cutoff).toBeTruthy();
            }
        }
        const imaWrongDirection = await post(`/v1/integrations/files/${fileId}/ima`, {});
        expect(imaWrongDirection.status).toBe(422);
        const rate = process.env.INTEGRATION_MOCK_FAILURE_RATE;
        process.env.INTEGRATION_MOCK_FAILURE_RATE = '1';
        const mockFailure = await post(`/v1/integrations/files/${fileId}/schedule`, {});
        await IntegrationService.processOne(mockFailure.body.data.id);
        expect((await IntegrationService.getJob(mockFailure.body.data.id, WORKSPACE_ID)).attempts).toBe(1);
        expect((await IntegrationService.getJob(mockFailure.body.data.id, WORKSPACE_ID)).status).toBe('pending');
        if (rate === undefined) delete process.env.INTEGRATION_MOCK_FAILURE_RATE;
        else process.env.INTEGRATION_MOCK_FAILURE_RATE = rate;
        const http = process.env.CARRIER_ADAPTER;
        process.env.CARRIER_ADAPTER = 'http';
        const failure = await post(`/v1/integrations/files/${fileId}/schedule`, {});
        await IntegrationService.processOne(failure.body.data.id);
        const failedJob = await IntegrationService.getJob(failure.body.data.id, WORKSPACE_ID);
        expect(failedJob.status).toBe('pending');
        expect(failedJob.error_message).toContain('not configured');
        if (http === undefined) delete process.env.CARRIER_ADAPTER; else process.env.CARRIER_ADAPTER = http;
    });

    it('verifies HMAC, queues one webhook event, and records terminal gate movement', async () => {
        const created = await post('/v1/freight/files', { direction: 'export' });
        const fileId = created.body.data.id;
        await db('freight_container').insert({ id: randomUUID(), workspace_id: WORKSPACE_ID,
            freight_file_id: fileId, container_number: 'TEST4000001', type: '40HC',
            created_by: USER_COORDINATOR_ID, version: 1 });
        const body = JSON.stringify({ event_id: 'gate-test-1', workspace_id: WORKSPACE_ID,
            file_id: fileId, container_number: 'TEST4000001', occurred_at: new Date().toISOString() });
        const url = `${base}/v1/webhooks/terminal/gate-in`;
        const invalid = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json',
            'x-webhook-signature': 'sha256=bad' }, body });
        expect(invalid.status).toBe(401);
        const signature = createHmac('sha256', 'test-terminal-secret').update(body).digest('hex');
        const options = { method: 'POST', headers: { 'Content-Type': 'application/json',
            'x-webhook-signature': `sha256=${signature}` }, body };
        const queued = await fetch(url, options);
        expect(queued.status).toBe(202);
        const duplicate = await fetch(url, options);
        expect((await duplicate.json() as any).data.duplicate).toBe(true);
        const outbox = await db('outbox').where({ event_type: 'terminal.container.gated_in' })
            .orderBy('created_at', 'desc').first();
        await handleSection4Event(event('terminal.container.gated_in', JSON.parse(outbox.payload), WORKSPACE_ID, outbox.event_id));
        const container = await db('freight_container').where({ container_number: 'TEST4000001' }).first();
        expect(container.gate_in_at).toBeTruthy();
    });
});
