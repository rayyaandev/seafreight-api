import { randomUUID } from 'crypto';
import type { Knex } from 'knex';
import type { MilestoneType } from '../../common/enums.js';

/** Caller locks the freight file before writing a milestone. */
export async function recordMilestone(
    trx: Knex.Transaction,
    params: { workspaceId: string; fileId: string; type: MilestoneType;
        timestamp: Date | string; source: string; actorId: string }
) {
    const timestamp = params.timestamp instanceof Date ? params.timestamp : new Date(params.timestamp);
    if (Number.isNaN(timestamp.getTime())) throw new Error('Invalid milestone timestamp');
    const existing = await trx('milestone').where({ workspace_id: params.workspaceId,
        freight_file_id: params.fileId, milestone_type: params.type }).first();
    if (existing) {
        // Recorded operational evidence replaces an earlier operator-entered placeholder.
        if (existing.source === 'manual' && params.source !== 'manual') {
            await trx('milestone').where({ id: existing.id }).update({ timestamp, source: params.source,
                version: existing.version + 1, updated_at: trx.fn.now() });
            return trx('milestone').where({ id: existing.id }).first();
        }
        return existing;
    }
    const id = randomUUID();
    await trx('milestone').insert({ id, workspace_id: params.workspaceId, freight_file_id: params.fileId,
        milestone_type: params.type, timestamp, source: params.source, created_by: params.actorId,
        version: 1, created_at: trx.fn.now(), updated_at: trx.fn.now() });
    return trx('milestone').where({ id }).first();
}
