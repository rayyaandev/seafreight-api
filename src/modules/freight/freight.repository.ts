import { randomUUID } from 'crypto';
import db from '../../db/connection.js';
import type {
    FreightFileEntity,
    FreightContainerEntity,
    FreightLineEntity,
    BillOfLadingEntity,
    FileDocumentEntity,
    FileNoteEntity,
    DrayageOrderEntity,
    MilestoneEntity,
    ExceptionCaseEntity,
    ChargeEntity,
} from '../../common/types.js';

function sanitizeDates<T extends Record<string, any>>(obj: T): T {
    const result: any = { ...obj };
    const dateFields = [
        'etd', 'eta', 'ata', 'atd',
        'doc_cutoff', 'vgm_cutoff', 'gate_cutoff',
        'vgm_submitted_at', 'gate_in_at', 'gate_out_at',
        'container_release_received_at', 'issue_date', 'released_at',
        'scheduled_at', 'occurred_at', 'timestamp', 'delivered_at', 'resolved_at'
    ];
    for (const key of dateFields) {
        if (result[key] !== undefined && result[key] !== null && typeof result[key] === 'string') {
            result[key] = new Date(result[key]);
        }
    }
    return result;
}

export class FreightRepository {
    public static async generateHumanId(mode: 'sea' | 'air', year = new Date().getFullYear()): Promise<string> {
        const prefix = mode === 'sea' ? 'SF' : 'AF';
        const countResult = await db('freight_file')
            .where('mode', mode)
            .whereRaw('YEAR(created_at) = ?', [year])
            .count<{ count: number }>('id as count')
            .first();

        const seq = (countResult ? Number(countResult.count) : 0) + 1;
        return `${prefix}-${year}-${String(seq).padStart(5, '0')}`;
    }

    // ------------------------------------------------------------------------
    // Freight File Operations
    // ------------------------------------------------------------------------
    public static async findById(id: string, workspaceId: string): Promise<FreightFileEntity | null> {
        const row = await db<FreightFileEntity>('freight_file')
            .where({ id, workspace_id: workspaceId })
            .whereNull('deleted_at')
            .first();
        return row || null;
    }

    public static async listFiles(
        workspaceId: string,
        filters: {
            mode?: string;
            direction?: string;
            status?: string;
            customer_id?: string;
            pol_id?: string;
            pod_id?: string;
            special_handling?: string;
            special_status?: string;
            eta_from?: string;
            eta_to?: string;
            q?: string;
            limit?: number;
            offset?: number;
        }
    ): Promise<{ data: FreightFileEntity[]; total: number }> {
        const query = db<FreightFileEntity>('freight_file')
            .where('workspace_id', workspaceId)
            .whereNull('deleted_at');

        if (filters.mode) query.where('mode', filters.mode);
        if (filters.direction) query.where('direction', filters.direction);
        if (filters.status) query.where('status', filters.status);
        if (filters.customer_id) query.where('customer_id', filters.customer_id);
        if (filters.pol_id) query.where('pol_id', filters.pol_id);
        if (filters.pod_id) query.where('pod_id', filters.pod_id);
        if (filters.special_handling) query.where('special_handling', filters.special_handling);
        if (filters.special_status) query.where('special_status', filters.special_status);
        if (filters.eta_from) query.where('eta', '>=', filters.eta_from);
        if (filters.eta_to) query.where('eta', '<=', filters.eta_to);

        if (filters.q) {
            query.where((builder) => {
                builder
                    .where('file_no', 'like', `%${filters.q}%`)
                    .orWhere('vessel', 'like', `%${filters.q}%`)
                    .orWhere('voyage', 'like', `%${filters.q}%`)
                    .orWhere('mrn', 'like', `%${filters.q}%`);
            });
        }

        const countQuery = query.clone().clearSelect().clearOrder().count<{ total: number }>('id as total').first();
        const countRes = await countQuery;

        const limit = filters.limit || 50;
        const offset = filters.offset || 0;

        const rows = await query
            .orderBy('created_at', 'desc')
            .limit(limit)
            .offset(offset);

        return {
            data: rows,
            total: countRes ? Number(countRes.total) : rows.length,
        };
    }

    public static async create(fileData: Partial<FreightFileEntity>): Promise<FreightFileEntity> {
        const id = fileData.id || randomUUID();
        const payload = sanitizeDates(fileData);
        await db('freight_file').insert({
            ...payload,
            id,
            version: 1,
            created_at: db.fn.now(),
            updated_at: db.fn.now(),
        });
        const created = await db<FreightFileEntity>('freight_file').where('id', id).first();
        return created!;
    }

    public static async update(
        id: string,
        workspaceId: string,
        currentVersion: number,
        updates: Partial<FreightFileEntity>
    ): Promise<FreightFileEntity | null> {
        const payload = sanitizeDates(updates);
        const updatedCount = await db('freight_file')
            .where({ id, workspace_id: workspaceId, version: currentVersion })
            .update({
                ...payload,
                version: currentVersion + 1,
                updated_at: db.fn.now(),
            });

        if (updatedCount === 0) {
            return null;
        }

        return (await db<FreightFileEntity>('freight_file').where({ id }).first()) || null;
    }

    /**
     * Transaction-aware update. Same as update() but uses the provided Knex transaction
     * so the caller can atomically commit business mutations + outbox events.
     */
    public static async updateWithTrx(
        trx: import('knex').Knex.Transaction,
        id: string,
        workspaceId: string,
        currentVersion: number,
        updates: Partial<FreightFileEntity>
    ): Promise<FreightFileEntity | null> {
        const payload = sanitizeDates(updates);
        const updatedCount = await trx('freight_file')
            .where({ id, workspace_id: workspaceId, version: currentVersion })
            .update({
                ...payload,
                version: currentVersion + 1,
                updated_at: trx.fn.now(),
            });

        if (updatedCount === 0) {
            return null;
        }

        return (await trx<FreightFileEntity>('freight_file').where({ id }).first()) || null;
    }

    public static async deleteFile(id: string, workspaceId: string): Promise<boolean> {
        const affected = await db('freight_file')
            .where({ id, workspace_id: workspaceId })
            .update({
                deleted_at: db.fn.now(),
                updated_at: db.fn.now(),
            });
        return affected > 0;
    }

    // ------------------------------------------------------------------------
    // Containers
    // ------------------------------------------------------------------------
    public static async getContainers(freightFileId: string): Promise<FreightContainerEntity[]> {
        return db<FreightContainerEntity>('freight_container')
            .where('freight_file_id', freightFileId)
            .orderBy('created_at', 'asc');
    }

    public static async createContainer(data: Partial<FreightContainerEntity>): Promise<FreightContainerEntity> {
        const id = data.id || randomUUID();
        const payload = sanitizeDates(data);
        await db('freight_container').insert({
            ...payload,
            id,
            version: 1,
            created_at: db.fn.now(),
            updated_at: db.fn.now(),
        });
        return (await db<FreightContainerEntity>('freight_container').where('id', id).first())!;
    }

    public static async deleteContainer(containerId: string, freightFileId: string): Promise<boolean> {
        const affected = await db('freight_container')
            .where({ id: containerId, freight_file_id: freightFileId })
            .del();
        return affected > 0;
    }

    // ------------------------------------------------------------------------
    // Freight Lines (Cargo goods items)
    // ------------------------------------------------------------------------
    public static async getLines(freightFileId: string): Promise<FreightLineEntity[]> {
        return db<FreightLineEntity>('freight_line')
            .where('freight_file_id', freightFileId)
            .orderBy('created_at', 'asc');
    }

    public static async createLine(data: Partial<FreightLineEntity>): Promise<FreightLineEntity> {
        const id = data.id || randomUUID();
        const payload = sanitizeDates(data);
        await db('freight_line').insert({
            ...payload,
            id,
            version: 1,
            created_at: db.fn.now(),
            updated_at: db.fn.now(),
        });
        return (await db<FreightLineEntity>('freight_line').where('id', id).first())!;
    }

    public static async deleteLine(lineId: string, freightFileId: string): Promise<boolean> {
        const affected = await db('freight_line')
            .where({ id: lineId, freight_file_id: freightFileId })
            .del();
        return affected > 0;
    }

    // ------------------------------------------------------------------------
    // Bills of Lading
    // ------------------------------------------------------------------------
    public static async getBillsOfLading(freightFileId: string): Promise<BillOfLadingEntity[]> {
        return db<BillOfLadingEntity>('bill_of_lading')
            .where('freight_file_id', freightFileId)
            .orderBy('created_at', 'asc');
    }

    public static async createBillOfLading(data: Partial<BillOfLadingEntity>): Promise<BillOfLadingEntity> {
        const id = data.id || randomUUID();
        const payload = sanitizeDates(data);
        await db('bill_of_lading').insert({
            ...payload,
            id,
            version: 1,
            created_at: db.fn.now(),
            updated_at: db.fn.now(),
        });
        return (await db<BillOfLadingEntity>('bill_of_lading').where('id', id).first())!;
    }

    // ------------------------------------------------------------------------
    // Documents
    // ------------------------------------------------------------------------
    public static async getDocuments(freightFileId: string): Promise<FileDocumentEntity[]> {
        return db<FileDocumentEntity>('file_document')
            .where('freight_file_id', freightFileId)
            .orderBy('created_at', 'asc');
    }

    public static async createDocument(data: Partial<FileDocumentEntity>): Promise<FileDocumentEntity> {
        const id = data.id || randomUUID();
        const payload = sanitizeDates(data);
        await db('file_document').insert({
            ...payload,
            id,
            version: 1,
            created_at: db.fn.now(),
            updated_at: db.fn.now(),
        });
        return (await db<FileDocumentEntity>('file_document').where('id', id).first())!;
    }

    public static async deleteDocument(docId: string, freightFileId: string): Promise<boolean> {
        const affected = await db('file_document')
            .where({ id: docId, freight_file_id: freightFileId })
            .del();
        return affected > 0;
    }

    // ------------------------------------------------------------------------
    // Notes
    // ------------------------------------------------------------------------
    public static async getNotes(freightFileId: string): Promise<FileNoteEntity[]> {
        return db<FileNoteEntity>('file_note')
            .where('freight_file_id', freightFileId)
            .orderBy('created_at', 'asc');
    }

    public static async createNote(data: Partial<FileNoteEntity>): Promise<FileNoteEntity> {
        const id = data.id || randomUUID();
        const payload = sanitizeDates(data);
        await db('file_note').insert({
            ...payload,
            id,
            version: 1,
            created_at: db.fn.now(),
            updated_at: db.fn.now(),
        });
        return (await db<FileNoteEntity>('file_note').where('id', id).first())!;
    }

    // ------------------------------------------------------------------------
    // Drayage Transport Orders
    // ------------------------------------------------------------------------
    public static async getDrayageOrders(freightFileId: string): Promise<DrayageOrderEntity[]> {
        return db<DrayageOrderEntity>('drayage_order')
            .where('freight_file_id', freightFileId)
            .orderBy('created_at', 'asc');
    }

    public static async createDrayageOrder(data: Partial<DrayageOrderEntity>): Promise<DrayageOrderEntity> {
        const id = data.id || randomUUID();
        const payload = sanitizeDates(data);
        const orderNumber = data.order_number || `TR-${new Date().getFullYear()}-${Math.floor(10000 + Math.random() * 90000)}`;

        await db('drayage_order').insert({
            ...payload,
            id,
            order_number: orderNumber,
            version: 1,
            created_at: db.fn.now(),
            updated_at: db.fn.now(),
        });
        return (await db<DrayageOrderEntity>('drayage_order').where('id', id).first())!;
    }

    // ------------------------------------------------------------------------
    // Milestones
    // ------------------------------------------------------------------------
    public static async getMilestones(freightFileId: string): Promise<MilestoneEntity[]> {
        return db<MilestoneEntity>('milestone')
            .where('freight_file_id', freightFileId)
            .orderBy('timestamp', 'asc');
    }

    public static async createMilestone(data: Partial<MilestoneEntity>): Promise<MilestoneEntity> {
        const id = data.id || randomUUID();
        const payload = sanitizeDates(data);
        await db('milestone').insert({
            ...payload,
            id,
            version: 1,
            timestamp: payload.timestamp ? payload.timestamp : db.fn.now(),
            created_at: db.fn.now(),
            updated_at: db.fn.now(),
        });
        return (await db<MilestoneEntity>('milestone').where('id', id).first())!;
    }

    // ------------------------------------------------------------------------
    // Exception Cases
    // ------------------------------------------------------------------------
    public static async getExceptions(freightFileId: string): Promise<ExceptionCaseEntity[]> {
        return db<ExceptionCaseEntity>('exception_case')
            .where('freight_file_id', freightFileId)
            .orderBy('created_at', 'desc');
    }

    public static async createException(data: Partial<ExceptionCaseEntity>): Promise<ExceptionCaseEntity> {
        const id = data.id || randomUUID();
        const payload = sanitizeDates(data);
        await db('exception_case').insert({
            ...payload,
            id,
            version: 1,
            created_at: db.fn.now(),
            updated_at: db.fn.now(),
        });
        return (await db<ExceptionCaseEntity>('exception_case').where('id', id).first())!;
    }

    // ------------------------------------------------------------------------
    // Charges (Sell & Buy)
    // ------------------------------------------------------------------------
    public static async getCharges(freightFileId: string): Promise<ChargeEntity[]> {
        return db<ChargeEntity>('charge')
            .where('freight_file_id', freightFileId)
            .orderBy('created_at', 'asc');
    }

    public static async createCharge(data: Partial<ChargeEntity>): Promise<ChargeEntity> {
        const id = data.id || randomUUID();
        const payload = sanitizeDates(data);
        await db('charge').insert({
            ...payload,
            id,
            version: 1,
            created_at: db.fn.now(),
            updated_at: db.fn.now(),
        });
        return (await db<ChargeEntity>('charge').where('id', id).first())!;
    }

    public static async deleteCharge(chargeId: string, freightFileId: string): Promise<boolean> {
        const affected = await db('charge')
            .where({ id: chargeId, freight_file_id: freightFileId })
            .del();
        return affected > 0;
    }

    // ------------------------------------------------------------------------
    // Metrics
    // ------------------------------------------------------------------------
    public static async getMetrics(workspaceId: string) {
        const stats = await db('freight_file')
            .where('workspace_id', workspaceId)
            .where('mode', 'sea')
            .whereNull('deleted_at')
            .select(
                db.raw('COUNT(id) as total_active'),
                db.raw("SUM(CASE WHEN direction = 'import' THEN 1 ELSE 0 END) as total_import"),
                db.raw("SUM(CASE WHEN direction = 'export' THEN 1 ELSE 0 END) as total_export"),
                db.raw("SUM(CASE WHEN special_status = 'RED' THEN 1 ELSE 0 END) as red_alerts"),
                db.raw("SUM(CASE WHEN status = 'Arrived' THEN 1 ELSE 0 END) as arrived_shipments")
            )
            .first();

        return stats;
    }
}
