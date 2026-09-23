import type { EventEnvelope } from '../../common/events.js';
import { handleOperationalEvent } from './operational.handler.js';

export async function handleWmsEvent(envelope: EventEnvelope): Promise<void> {
    await handleOperationalEvent(envelope);
}
