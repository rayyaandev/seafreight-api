import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'crypto';
import type { Server } from 'http';
import amqplib from 'amqplib';
import db from '../src/db/connection.js';
import { createApp } from '../src/app.js';
import { WORKSPACE_ID, USER_COORDINATOR_ID } from '../src/db/seeds/01_sea_freight_seed.js';
import { connectRabbitMQ, isConnected, publish, setOnConnected, shutdownRabbitMQ,
    EXCHANGE } from '../src/bus/rabbitmq.config.js';
import { startConsumers, stopConsumers } from '../src/bus/consumer.service.js';
import { startOutboxWorker, stopOutboxWorker } from '../src/bus/outbox.worker.js';
import { testPorts } from './helpers/ports.js';
import { requireIsolatedTestDatabase } from './helpers/database.js';

const run = process.env.SECTION5_BUS_TEST === '1';
const base = 'http://127.0.0.1:4991';
const headers = { 'Content-Type': 'application/json', 'x-actor-id': USER_COORDINATOR_ID,
    'x-workspace-id': WORKSPACE_ID, 'x-permissions': 'freight.file.create,freight.file.read,freight.file.update' };
let server: Server;
let tap: Awaited<ReturnType<typeof amqplib.connect>>;
let tapChannel: Awaited<ReturnType<typeof tap.createChannel>>;
async function until<T>(read: () => Promise<T>, done: (value: T) => boolean): Promise<T> {
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
        const value = await read();
        if (done(value)) return value;
        await new Promise((resolve) => setTimeout(resolve, 150));
    }
    throw new Error('Timed out waiting for Section 5 bus event');
}

describe.skipIf(!run)('Section 5 isolated RabbitMQ path', () => {
    beforeAll(async () => {
        requireIsolatedTestDatabase();
        if (!process.env.AMQP_URL?.endsWith(`/${process.env.DB_NAME}`)) {
            throw new Error('A RabbitMQ vhost matching the disposable test database is required');
        }
        server = createApp().listen(4991);
        setOnConnected(startConsumers);
        await connectRabbitMQ();
        expect(isConnected()).toBe(true);
        tap = await amqplib.connect(process.env.AMQP_URL!);
        tapChannel = await tap.createChannel();
        await tapChannel.assertExchange(EXCHANGE, 'topic', { durable: true });
        await tapChannel.assertQueue('codex.section5.requests', { durable: false });
        await tapChannel.bindQueue('codex.section5.requests', EXCHANGE, 'trucking.order.create.requested');
        startOutboxWorker();
    });
    afterAll(async () => {
        stopOutboxWorker();
        await stopConsumers();
        await shutdownRabbitMQ();
        await tapChannel?.close();
        await tap?.close();
        server?.close();
    });

    it('publishes drayage request and consumes Trucking and WMS replies', async () => {
        const create = await fetch(`${base}/v1/freight/files`, { method: 'POST', headers,
            body: JSON.stringify({ direction: 'import', ...await testPorts() }) });
        const file = (await create.json() as any).data;
        const orderResponse = await fetch(`${base}/v1/freight/files/${file.id}/drayage-orders`, {
            method: 'POST', headers, body: JSON.stringify({ type: 'import_delivery',
                terminal_name: 'Test Terminal', facility_address: '123 Terminal Road',
                pickup_address: '123 Terminal Road', delivery_address: '555 Customer Road' }) });
        expect(orderResponse.status).toBe(201);
        const order = (await orderResponse.json() as any).data;
        const message = await until(() => tapChannel.get('codex.section5.requests', { noAck: true }), (m) => Boolean(m));
        const sent = JSON.parse((message as Exclude<typeof message, false>).content.toString());
        expect(sent.payload.drayage_order_id).toBe(order.id);
        expect(sent.payload.delivery_address).toBe('555 Customer Road');
        expect(await db('processed_message').where({ message_id: sent.id }).first()).toBeUndefined();

        const envelope = (type: string, payload: Record<string, unknown>) => ({ id: randomUUID(), type,
            occurred_at: new Date().toISOString(), workspace_id: WORKSPACE_ID, actor: 'system', version: 1, payload });
        await publish('trucking.order.linked', envelope('trucking.order.linked',
            { drayage_order_id: order.id, trucking_order_id: 'BUS-TRUCK-1', status: 'scheduled' }));
        await until(() => db('drayage_order').where({ id: order.id }).first(), (row) => row.trucking_order_id === 'BUS-TRUCK-1');
        await publish('trucking.order.updated', envelope('trucking.order.updated',
            { trucking_order_id: 'BUS-TRUCK-1', status: 'collected' }));
        await publish('wms.event', envelope('wms.event', { file_id: file.id, event_type: 'inslag',
            bonded_warehouse_ref: 'BUS-WAREHOUSE' }));
        await until(() => db('milestone').where({ freight_file_id: file.id, milestone_type: 'collected' }).first(), Boolean);
        await until(() => db('t1_bonded_event').where({ freight_file_id: file.id, event_type: 'inslag' }).first(), Boolean);
    }, 25000);
});
