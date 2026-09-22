import amqplib from 'amqplib';
import type { ChannelModel, Channel } from 'amqplib';

// ── Topology Constants ───────────────────────────────────────────────────────
export const EXCHANGE = 'seafreight.events';
export const DLQ_EXCHANGE = 'seafreight.events.dlq';
export const CONSUMER_QUEUE = 'seafreight.inbound';
export const DLQ_QUEUE = 'seafreight.dlq';

// ── State ────────────────────────────────────────────────────────────────────
let connection: ChannelModel | null = null;
let channel: Channel | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let shutdownRequested = false;

const MAX_RECONNECT_DELAY_MS = 30_000;
let reconnectAttempt = 0;

// ── Connect & Declare Topology ───────────────────────────────────────────────
export async function connectRabbitMQ(): Promise<void> {
    if (shutdownRequested) return;

    const url = process.env.AMQP_URL || 'amqp://guest:guest@127.0.0.1:5672';

    try {
        const conn = await amqplib.connect(url);
        connection = conn;
        console.log('[RabbitMQ] Connected to', url.replace(/\/\/.*@/, '//<credentials>@'));

        conn.on('error', (err: Error) => {
            console.error('[RabbitMQ] Connection error:', err.message);
        });

        conn.on('close', () => {
            console.warn('[RabbitMQ] Connection closed');
            channel = null;
            connection = null;
            scheduleReconnect();
        });

        const ch = await conn.createChannel();
        channel = ch;

        /**
         * Dead-letter exchange and queue
         * This is used to store messages that failed to process
         */
        await ch.assertExchange(DLQ_EXCHANGE, 'fanout', { durable: true });
        await ch.assertQueue(DLQ_QUEUE, { durable: true });
        await ch.bindQueue(DLQ_QUEUE, DLQ_EXCHANGE, '');

        /**
         * Main topic exchange
         * Exchange here is basically a router that routes the events
         * to their respective queues.
         * 
         * For example,
         * freight.files.* events are routed to a different queue AND
         * trucking.order.* events are routed to another queue
         */

        await ch.assertExchange(EXCHANGE, 'topic', { durable: true });

        // Consumer queue bound to all routing keys, with DLQ on rejection
        await ch.assertQueue(CONSUMER_QUEUE, {
            durable: true,
            arguments: {
                'x-dead-letter-exchange': DLQ_EXCHANGE, // automatically sends rejected and corrupted messages to DLQ queue
            },
        });
        // Specific inbound event routing patterns consumed by Sea Freight module
        const inboundRoutingKeys = [
            'declaration.#',
            'sales.#',
            'document.#',
            'trucking.#',
            'wms.#',
            'masterdata.#',
        ];

        // Clean up legacy catch-all binding if present
        try {
            await ch.unbindQueue(CONSUMER_QUEUE, EXCHANGE, '#');
        } catch {
            // Ignore if binding did not exist
        }

        for (const pattern of inboundRoutingKeys) {
            await ch.bindQueue(CONSUMER_QUEUE, EXCHANGE, pattern);
        }

        // Only push one message at a time to nodejs server
        await ch.prefetch(1);

        reconnectAttempt = 0;
        console.log('[RabbitMQ] Topology declared — exchange:', EXCHANGE, '| queue:', CONSUMER_QUEUE);
    } catch (err: any) {
        console.error('[RabbitMQ] Failed to connect:', err.message);
        channel = null;
        connection = null;
        scheduleReconnect();
    }
}

function scheduleReconnect(): void {
    if (shutdownRequested || reconnectTimer) return;

    reconnectAttempt++;
    const delay = Math.min(1000 * Math.pow(2, reconnectAttempt), MAX_RECONNECT_DELAY_MS);
    console.log(`[RabbitMQ] Reconnecting in ${delay}ms (attempt ${reconnectAttempt})...`);

    reconnectTimer = setTimeout(async () => {
        reconnectTimer = null;
        await connectRabbitMQ();
    }, delay);
}

// ── Public API ───────────────────────────────────────────────────────────────
export function getChannel(): Channel | null {
    return channel;
}

export function isConnected(): boolean {
    return channel !== null && connection !== null;
}

/**
 * Publish a message to the main topic exchange.
 * Returns true if published, false if channel unavailable.
 */
export function publish(routingKey: string, payload: Record<string, unknown>): boolean {
    if (!channel) {
        console.warn('[RabbitMQ] Cannot publish — channel not available. routingKey:', routingKey);
        return false;
    }

    const buffer = Buffer.from(JSON.stringify(payload));
    return channel.publish(EXCHANGE, routingKey, buffer, {
        persistent: true,
        contentType: 'application/json',
        timestamp: Math.floor(Date.now() / 1000),
    });
}

/**
 * Gracefully shut down channel and connection.
 */
export async function shutdownRabbitMQ(): Promise<void> {
    shutdownRequested = true;

    if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
    }

    try {
        if (channel) {
            await channel.close();
            channel = null;
        }
    } catch {
        // Channel may already be closed
    }

    try {
        if (connection) {
            await connection.close();
            connection = null;
        }
    } catch {
        // Connection may already be closed
    }

    console.log('[RabbitMQ] Shutdown complete');
}
