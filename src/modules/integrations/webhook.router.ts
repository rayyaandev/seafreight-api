import { createHash, createHmac, timingSafeEqual } from 'crypto';
import { isDeepStrictEqual } from 'util';
import { Router, type Request, type Response, type NextFunction } from 'express';
import db from '../../db/connection.js';
import { OutboxService } from '../../bus/outbox.service.js';
import { AppError, sendSuccess } from '../../utils/response.js';

export const webhookRouter = Router();
const types: Record<string, string> = {
    'portbase/container-release': 'portbase.container.released',
    'portbase/message-accepted': 'portbase.message.accepted',
    'portbase/message-rejected': 'portbase.message.rejected',
    'carrier/booking-confirmed': 'carrier.booking.confirmed',
    'carrier/schedule-updated': 'carrier.schedule.updated',
    'terminal/gate-in': 'terminal.container.gated_in',
    'terminal/gate-out': 'terminal.container.gated_out',
};

webhookRouter.post('/:provider/:event', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const provider = req.params.provider as string;
        const key = `${provider}/${req.params.event}`;
        const eventType = types[key];
        if (!eventType) throw new AppError(404, 'NOT_FOUND', 'Unknown webhook event');
        const secret = process.env[`${provider.toUpperCase()}_WEBHOOK_SECRET`];
        if (!secret) throw new AppError(503, 'WEBHOOK_NOT_CONFIGURED', 'Webhook secret is not configured');
        const signature = req.header('x-webhook-signature') || '';
        const expected = createHmac('sha256', secret)
            .update((req as Request & { rawBody?: Buffer }).rawBody || Buffer.alloc(0)).digest();
        const suppliedHex = signature.startsWith('sha256=') ? signature.slice(7) : '';
        const supplied = /^[a-f0-9]{64}$/i.test(suppliedHex) ? Buffer.from(suppliedHex, 'hex') : Buffer.alloc(0);
        if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
            throw new AppError(401, 'INVALID_SIGNATURE', 'Webhook signature invalid');
        }
        const { event_id, workspace_id, ...payload } = req.body || {};
        if (typeof event_id !== 'string' || event_id.length < 1 || event_id.length > 100 ||
            typeof workspace_id !== 'string' || workspace_id.length < 1 ||
            typeof payload.file_id !== 'string' || payload.file_id.length < 1) {
            throw new AppError(422, 'INVALID_WEBHOOK', 'event_id, workspace_id and file_id are required');
        }
        if (eventType === 'portbase.container.released' &&
            (typeof payload.released_at !== 'string' || Number.isNaN(Date.parse(payload.released_at)))) {
            throw new AppError(422, 'INVALID_WEBHOOK', 'released_at is required');
        }
        if (eventType.startsWith('portbase.message.') && typeof payload.reference !== 'string') {
            throw new AppError(422, 'INVALID_WEBHOOK', 'Portbase message reference is required');
        }
        if (eventType === 'carrier.booking.confirmed' && typeof payload.reference !== 'string') {
            throw new AppError(422, 'INVALID_WEBHOOK', 'Booking reference is required');
        }
        if (eventType.startsWith('terminal.') &&
            (typeof payload.container_number !== 'string' || typeof payload.occurred_at !== 'string' ||
                Number.isNaN(Date.parse(payload.occurred_at)))) {
            throw new AppError(422, 'INVALID_WEBHOOK', 'Container number and occurred_at are required');
        }
        // Stable id across webhook redeliveries; unique constraint on outbox.event_id enforces dedup.
        const internalId = createHash('sha256').update(`${provider}:${event_id}`).digest('hex').slice(0, 36);
        const duplicate = await db('outbox').where({ event_id: internalId }).first();
        if (duplicate) {
            const same = duplicate.workspace_id === workspace_id && duplicate.event_type === eventType &&
                isDeepStrictEqual(JSON.parse(duplicate.payload), payload);
            if (!same) throw new AppError(409, 'WEBHOOK_EVENT_CONFLICT', 'Event ID was already used for different content');
            sendSuccess(res, { event_id: internalId, duplicate: true }, 202);
            return;
        }
        await db.transaction(async (trx) => {
            await OutboxService.enqueue(trx, { workspaceId: workspace_id, eventType,
                eventId: internalId, payload });
        });
        sendSuccess(res, { event_id: internalId, queued: true }, 202);
    } catch (error) { next(error); }
});
