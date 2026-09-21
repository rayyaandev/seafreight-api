import type { EventEnvelope } from '../../common/events.js';

/**
 * Handles `masterdata.*.updated`:
 * - Stub handler for master data cache invalidation.
 * - No in-memory cache exists yet, so this logs the event for future use.
 */
export async function handleMasterdataUpdated(envelope: EventEnvelope): Promise<void> {
    const entityType = envelope.type.replace('masterdata.', '').replace('.updated', '');

    console.log(
        `[Handler:masterdata.updated] Received update for entity '${entityType}'`,
        `workspace=${envelope.workspace_id}`,
        `payload keys: [${Object.keys(envelope.payload || {}).join(', ')}]`
    );

    // Future: invalidate in-memory cache for the affected entity type
    // e.g. MasterdataCache.invalidate(entityType, envelope.workspace_id);
}
