import type { EventEnvelope } from '../../common/events.js';
import { handleSection4Event } from './section4.handler.js';

export async function handleDeclarationRejected(envelope: EventEnvelope): Promise<void> {
    await handleSection4Event(envelope);
}
