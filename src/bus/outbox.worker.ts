import db from '../db/connection.js';
import { publish, isConnected } from './rabbitmq.config.js';
import type { OutboxEntity } from '../common/types.js';

const POLL_INTERVAL_MS = 2_000;
const MAX_RETRIES = 5;
const BATCH_SIZE = 20;

let pollingTimer: ReturnType<typeof setInterval> | null = null;
let isProcessing = false;

/**
 * Polls the outbox table for pending events and publishes them to RabbitMQ.
 */
async function processPendingOutbox(): Promise<void> {
    if (isProcessing) return;
    if (!isConnected()) return;

    isProcessing = true;

    try {
        const pendingRows = await db<OutboxEntity>('outbox')
            .where('status', 'pending')
            .orderBy('created_at', 'asc')
            .limit(BATCH_SIZE);

        for (const row of pendingRows) {
            try {
                const payload = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload;

                const published = await publish(row.event_type, {
                    id: row.event_id,
                    type: row.event_type,
                    occurred_at: new Date().toISOString(),
                    workspace_id: row.workspace_id,
                    actor: 'system',
                    version: 1,
                    payload,
                });

                if (published) {
                    await db('outbox')
                        .where('id', row.id)
                        .update({
                            status: 'published',
                            published_at: db.fn.now(),
                            updated_at: db.fn.now(),
                        });
                } else {
                    await incrementRetry(row, 'Channel publish returned false');
                }
            } catch (err: any) {
                await incrementRetry(row, err.message || 'Unknown publish error');
            }
        }
    } catch (err: any) {
        console.error('[OutboxWorker] Poll error:', err.message);
    } finally {
        isProcessing = false;
    }
}

async function incrementRetry(row: OutboxEntity, errorMessage: string): Promise<void> {
    const newRetryCount = (row.retry_count || 0) + 1;
    const newStatus = newRetryCount >= MAX_RETRIES ? 'failed' : 'pending';

    await db('outbox')
        .where('id', row.id)
        .update({
            retry_count: newRetryCount,
            error_message: errorMessage,
            status: newStatus,
            updated_at: db.fn.now(),
        });

    if (newStatus === 'failed') {
        console.error(`[OutboxWorker] Event ${row.event_id} permanently failed after ${MAX_RETRIES} retries: ${errorMessage}`);
    }
}

// ── Public API ───────────────────────────────────────────────────────────────

export function startOutboxWorker(): void {
    if (pollingTimer) return;

    console.log(`[OutboxWorker] Started — polling every ${POLL_INTERVAL_MS}ms`);
    pollingTimer = setInterval(processPendingOutbox, POLL_INTERVAL_MS);

    // Run immediately on start
    void processPendingOutbox();
}

export function stopOutboxWorker(): void {
    if (pollingTimer) {
        clearInterval(pollingTimer);
        pollingTimer = null;
        console.log('[OutboxWorker] Stopped');
    }
}
