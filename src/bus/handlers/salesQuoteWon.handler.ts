import { randomUUID } from 'crypto';
import db from '../../db/connection.js';
import type { EventEnvelope, SalesQuoteWonPayload } from '../../common/events.js';
import { validationGate } from '../../modules/freight/gates/index.js';
import { AppError } from '../../utils/response.js';
import type { FreightFileEntity } from '../../common/types.js';

/**
 * Handles `sales.quote.won`:
 * - Creates a new freight_file in Draft status pre-populated from the quote
 */
export async function handleSalesQuoteWon(envelope: EventEnvelope): Promise<void> {
    const payload = envelope.payload as unknown as SalesQuoteWonPayload;
    const workspaceId = envelope.workspace_id;

    // Resolve POL / POD by UN/LOCODE if provided
    let polId: string | null = null;
    let podId: string | null = null;

    if (payload.pol) {
        const loc = await db('location')
            .where('un_locode', payload.pol)
            .where('workspace_id', workspaceId)
            .first();
        polId = loc?.id || null;
    }
    if (payload.pod) {
        const loc = await db('location')
            .where('un_locode', payload.pod)
            .where('workspace_id', workspaceId)
            .first();
        podId = loc?.id || null;
    }

    // Generate file number
    const year = new Date().getFullYear();
    const countResult = await db('freight_file')
        .where('mode', 'sea')
        .whereRaw('YEAR(created_at) = ?', [year])
        .count<{ count: number }>('id as count')
        .first();
    const seq = (countResult ? Number(countResult.count) : 0) + 1;
    const fileNo = `SF-${year}-${String(seq).padStart(5, '0')}`;

    const validation = validationGate({
        file_no: fileNo,
        mode: 'sea',
        direction: 'export',
        pol_id: polId,
        pod_id: podId,
    } as FreightFileEntity);
    if (!validation.pass) {
        throw new AppError(422, 'VALIDATION_GATE_FAILED', validation.reason || 'File validation failed',
            undefined, validation.details);
    }

    const fileId = randomUUID();

    await db('freight_file').insert({
        id: fileId,
        workspace_id: workspaceId,
        file_no: fileNo,
        mode: 'sea',
        direction: 'export',
        status: 'Draft',
        customer_id: payload.customer_id || null,
        pol_id: polId,
        pod_id: podId,
        special_handling: 'NONE',
        special_status: 'GREEN',
        free_time_days: 7,
        declaration_status: 'none',
        total_cost: payload.agreed_rate || null,
        currency: payload.currency || 'EUR',
        created_by: envelope.actor || 'system',
        created_at: db.fn.now(),
        updated_at: db.fn.now(),
        version: 1,
    });

    console.log(`[Handler:sales.quote.won] Created Draft export file ${fileNo} (${fileId}) from quote ${payload.quote_id}`);
}
