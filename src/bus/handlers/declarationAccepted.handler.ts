import type { EventEnvelope } from '../../common/events.js';
import { handleSection4Event } from './section4.handler.js';

export async function handleDeclarationAccepted(envelope: EventEnvelope): Promise<void> {
    await handleSection4Event(envelope);
}
