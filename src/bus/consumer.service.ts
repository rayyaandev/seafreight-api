import { randomUUID } from 'crypto';
import { getChannel, CONSUMER_QUEUE } from './rabbitmq.config';
import { handlerRegistry } from './handlers/index';
import db from '../db/connection';
import type { EventEnvelope } from '../common/events';

// Used to stop the consumer in a controlled manner
let consumerTag: string | null = null;

/**
 * Start consuming messages from the inbound queue.
 * Each message is deduplicated, dispatched to the matching handler, and ACK'd.
 */
export async function startConsumers(): Promise<void> {
    const channel = getChannel();
    if (!channel) {
        console.warn('[Consumer] Cannot start — channel not available. Will retry on reconnect.');
        return;
    }

    const result = await channel.consume(CONSUMER_QUEUE, async (msg) => {
        if (!msg) return;

        let envelope: EventEnvelope;
        try {
            envelope = JSON.parse(msg.content.toString()) as EventEnvelope;
        } catch {
            console.error('[Consumer] Failed to parse message — sending to DLQ');
            channel.nack(msg, false, false); // No requeue → DLQ
            return;
        }

        const eventId = envelope.id;
        const eventType = envelope.type;

        try {
            // ── Idempotency check ────────────────────────────────────────
            const existing = await db('processed_message')
                .where('message_id', eventId)
                .first();

            if (existing) {
                console.log(`[Consumer] Duplicate event ${eventId} (${eventType}) — skipping`);
                channel.ack(msg);
                return;
            }

            // ── Dispatch to handler ──────────────────────────────────────
            const handler = handlerRegistry.get(eventType);
            if (!handler) {
                // Check for wildcard patterns (e.g. masterdata.*.updated)
                const wildcardHandler = findWildcardHandler(eventType);
                if (wildcardHandler) {
                    await wildcardHandler(envelope);
                } else {
                    console.warn(`[Consumer] No handler for event type '${eventType}' — ACKing to clear queue`);
                }
            } else {
                await handler(envelope);
            }

            // ── Record as processed ──────────────────────────────────────
            await db('processed_message').insert({
                id: randomUUID(),
                workspace_id: envelope.workspace_id || 'unknown',
                message_id: eventId,
                event_type: eventType,
                processed_at: db.fn.now(),
            });

            channel.ack(msg);
            console.log(`[Consumer] Processed event ${eventId} (${eventType})`);
        } catch (err: any) {
            console.error(`[Consumer] Handler error for event ${eventId} (${eventType}):`, err.message);

            // On first crash, requeue once to retry, then send the event to DLQ
            const redelivered = msg.fields.redelivered;
            if (redelivered) {
                console.error(`[Consumer] Event ${eventId} already redelivered — sending to DLQ`);
                channel.nack(msg, false, false);
            } else {
                channel.nack(msg, false, true); // Requeue for one retry
            }
        }
    }, { noAck: false });

    consumerTag = result.consumerTag;
    console.log('[Consumer] Listening on queue:', CONSUMER_QUEUE);
}

/**
 * Find a handler that matches wildcard patterns like "masterdata.*.updated".
 */
function findWildcardHandler(eventType: string): ((envelope: EventEnvelope) => Promise<void>) | null {
    for (const [pattern, handler] of handlerRegistry.entries()) {
        if (pattern.includes('*')) {
            const regex = new RegExp('^' + pattern.replace(/\./g, '\\.').replace(/\*/g, '[^.]+') + '$');
            if (regex.test(eventType)) {
                return handler;
            }
        }
    }
    return null;
}

export async function stopConsumers(): Promise<void> {
    const channel = getChannel();
    if (channel && consumerTag) {
        try {
            await channel.cancel(consumerTag);
            consumerTag = null;
            console.log('[Consumer] Stopped');
        } catch {
            // Channel may already be closed
        }
    }
}
