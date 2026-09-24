import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'crypto';
import type { Server } from 'http';
import db from '../src/db/connection.js';
import { WORKSPACE_ID, USER_COORDINATOR_ID } from '../src/db/seeds/01_sea_freight_seed.js';
import { createApp } from '../src/app.js';
import { connectRabbitMQ, isConnected, publish, setOnConnected, shutdownRabbitMQ } from '../src/bus/rabbitmq.config.js';
import { startConsumers, stopConsumers } from '../src/bus/consumer.service.js';
import { startOutboxWorker, stopOutboxWorker } from '../src/bus/outbox.worker.js';
import { startIntegrationWorker, stopIntegrationWorker } from '../src/modules/integrations/integration.worker.js';
import { testPorts } from './helpers/ports.js';
import { requireIsolatedTestDatabase } from './helpers/database.js';

const run = process.env.SECTION4_BUS_TEST === '1';
const base = 'http://127.0.0.1:4993';
const headers = { 'Content-Type': 'application/json', 'x-actor-id': USER_COORDINATOR_ID,
    'x-workspace-id': WORKSPACE_ID, 'x-permissions': 'freight.file.create,freight.file.read,freight.file.update,freight.file.clear' };
let server: Server;
async function post(path: string, body: unknown) {
    const payload = path === '/v1/freight/files' ? { ...await testPorts(), ...(body as object) } : body;
    const response = await fetch(`${base}${path}`, { method: 'POST', headers, body: JSON.stringify(payload) });
    return { status: response.status, body: await response.json() as any };
}
async function until<T>(read: () => Promise<T>, ready: (value: T) => boolean): Promise<T> {
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
        const value = await read();
        if (ready(value)) return value;
        await new Promise((resolve) => setTimeout(resolve, 150));
    }
    throw new Error('Timed out waiting for integration event');
}

describe.skipIf(!run)('Section 4 isolated RabbitMQ path', () => {
    beforeAll(async () => {
        requireIsolatedTestDatabase();
        if (!process.env.AMQP_URL?.endsWith(`/${process.env.DB_NAME}`)) {
            throw new Error('A RabbitMQ vhost matching the disposable test database is required');
        }
        server = createApp().listen(4993);
        setOnConnected(startConsumers);
        await connectRabbitMQ();
        expect(isConnected()).toBe(true);
        startOutboxWorker();
        startIntegrationWorker();
    });
    afterAll(async () => {
        stopIntegrationWorker();
        stopOutboxWorker();
        await stopConsumers();
        await shutdownRabbitMQ();
        server?.close();
    });

    it('confirms a mock carrier booking through outbox and consumer', async () => {
        const file = await post('/v1/freight/files', { direction: 'export' });
        expect(file.status).toBe(201);
        const job = await post(`/v1/integrations/files/${file.body.data.id}/booking`, {});
        expect(job.status).toBe(202);
        const booked = await until(() => db('freight_file').where({ id: file.body.data.id }).first(), (row) => row.status === 'Booked');
        expect(booked.carrier_booking_ref).toBeTruthy();
        const jobRow = await db('integration_job').where({ id: job.body.data.id }).first();
        expect(jobRow.status).toBe('completed');
    }, 25000);

    it('routes customs requests to customs.events and clears after both replies', async () => {
        const file = await post('/v1/freight/files', { direction: 'import' });
        const id = file.body.data.id;
        await db('freight_file').where({ id }).update({ status: 'Arrived', ata: new Date() });
        await db('bill_of_lading').insert({ id: randomUUID(), workspace_id: WORKSPACE_ID,
            freight_file_id: id, type: 'MBL', bl_number: 'BUS-BL', telex_release: true,
            original_received: false, released_at: new Date(), draft_approved: false,
            created_by: USER_COORDINATOR_ID, version: 1 });
        const submitted = await post(`/v1/integrations/files/${id}/customs`, { version: 1 });
        expect(submitted.status).toBe(202);
        await until(() => db('outbox').where({ event_type: 'declaration.submit.requested' })
            .where({ workspace_id: WORKSPACE_ID }).orderBy('created_at', 'desc').first(), (row) => row?.status === 'published');
        const reply = (type: string, payload: Record<string, unknown>) => ({ id: randomUUID(), type,
            occurred_at: new Date().toISOString(), workspace_id: WORKSPACE_ID,
            actor: 'system', version: 1, payload });
        expect(await publish('portbase.container.released', reply('portbase.container.released',
            { file_id: id, released_at: new Date().toISOString() }))).toBe(true);
        expect(await publish('declaration.accepted', reply('declaration.accepted',
            { file_id: id, declaration_id: submitted.body.data.declaration_id, mrn: 'BUS-MRN' }))).toBe(true);
        const cleared = await until(() => db('freight_file').where({ id }).first(), (row) => row.status === 'Cleared');
        expect(cleared.mrn).toBe('BUS-MRN');
    }, 25000);
});
