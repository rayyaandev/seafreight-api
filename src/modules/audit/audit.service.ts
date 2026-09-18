import { randomUUID } from 'crypto';
import db from '../../db/connection.js';

export interface AuditEntry {
    workspaceId: string;
    actorId: string;
    entityType: string;
    entityId: string;
    action: string;
    fromState?: string | null;
    toState?: string | null;
    payload?: Record<string, unknown> | null;
}

export class AuditService {
    public static async log(entry: AuditEntry): Promise<void> {
        try {
            await db('audit_log').insert({
                id: randomUUID(),
                workspace_id: entry.workspaceId,
                actor_id: entry.actorId,
                entity_type: entry.entityType,
                entity_id: entry.entityId,
                action: entry.action,
                from_state: entry.fromState || null,
                to_state: entry.toState || null,
                payload: entry.payload ? JSON.stringify(entry.payload) : null,
                created_at: db.fn.now(),
            });
        } catch (err) {
            console.error('[AuditService] Failed to write audit log:', err);
            // Non-blocking error for audit logging
        }
    }
}
