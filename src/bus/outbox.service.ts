import { randomUUID } from 'crypto';
import type { Knex } from 'knex';
import db from '../db/connection.js';

/**
 * Enqueue an event into the transactional outbox.
 *
 * MUST be called inside an existing Knex transaction so that the
 * business mutation and the outbox row commit or rollback atomically.
 */
export class OutboxService {
    public static async enqueue(
        trx: Knex.Transaction,
        params: {
            workspaceId: string;
            eventType: string;
            payload: Record<string, unknown>;
            eventId?: string;
        }
    ): Promise<string> {
        const eventId = params.eventId || randomUUID();
        const id = randomUUID();

        await trx('outbox').insert({
            id,
            workspace_id: params.workspaceId,
            event_id: eventId,
            event_type: params.eventType,
            payload: JSON.stringify(params.payload),
            status: 'pending',
            retry_count: 0,
            created_at: db.fn.now(),
            updated_at: db.fn.now(),
        });

        return eventId;
    }
}
