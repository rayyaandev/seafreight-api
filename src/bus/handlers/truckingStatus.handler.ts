import type { EventEnvelope } from '../../common/events.js';
import { handleOperationalEvent } from './operational.handler.js';

export async function handleTruckingStatus(envelope: EventEnvelope): Promise<void> {
    await handleOperationalEvent(envelope);
}
