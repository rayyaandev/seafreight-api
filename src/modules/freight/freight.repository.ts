import { randomUUID } from 'crypto';
import db from '../../db/connection.js';
import type {
    FreightFileEntity,
    FreightContainerEntity,
    DrayageOrderEntity,
    FileDocumentEntity,
    ExceptionCaseEntity,
} from './state-machine/types.js';

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
            special_handling_status?: string;
            carrier_name?: string;
            q?: string;
            limit: number;
        }
    ): Promise<{ data: FreightFileEntity[]; total: number }> {
        const query = db<FreightFileEntity>('freight_file')
            .where('workspace_id', workspaceId)
            .whereNull('deleted_at');

        if (filters.mode) query.where('mode', filters.mode);
        if (filters.direction) query.where('direction', filters.direction);
        if (filters.status) query.where('status', filters.status);
        if (filters.special_handling_status) query.where('special_handling_status', filters.special_handling_status);
        if (filters.carrier_name) query.whereILike('carrier_name', `%${filters.carrier_name}%`);
        if (filters.q) {
            query.andWhere((builder) => {
                builder
                    .whereILike('human_id', `%${filters.q}%`)
                    .orWhereILike('shipper_name', `%${filters.q}%`)
                    .orWhereILike('consignee_name', `%${filters.q}%`)
                    .orWhereILike('vessel_name', `%${filters.q}%`)
                    .orWhereILike('voyage_number', `%${filters.q}%`);
            });
        }

        const countQuery = query.clone().count<{ total: number }>('id as total').first();
        const limit = Number(filters.limit) || 20;
        const rowsQuery = query.clone().orderBy('created_at', 'desc').limit(limit);

        const [countRes, rows] = await Promise.all([countQuery, rowsQuery]);
        return {
            data: rows,
            total: countRes ? Number(countRes.total) : rows.length,
        };
    }

    public static async create(fileData: Partial<FreightFileEntity>): Promise<FreightFileEntity> {
        const id = fileData.id || randomUUID();
        await db('freight_file').insert({
            ...fileData,
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
        const updatedCount = await db('freight_file')
            .where({ id, workspace_id: workspaceId, version: currentVersion })
            .update({
                ...updates,
                version: currentVersion + 1,
                updated_at: db.fn.now(),
            });

        if (updatedCount === 0) {
            return null;
        }

        return (await db<FreightFileEntity>('freight_file').where({ id }).first()) || null;
    }

    public static async getContainers(freightFileId: string): Promise<FreightContainerEntity[]> {
        return db<FreightContainerEntity>('freight_container')
            .where('freight_file_id', freightFileId)
            .orderBy('created_at', 'asc');
    }

    public static async createContainer(data: Partial<FreightContainerEntity>): Promise<FreightContainerEntity> {
        const id = data.id || randomUUID();
        await db('freight_container').insert({
            ...data,
            id,
            created_at: db.fn.now(),
            updated_at: db.fn.now(),
        });
        return (await db<FreightContainerEntity>('freight_container').where('id', id).first())!;
    }

    public static async getDrayageOrders(freightFileId: string): Promise<DrayageOrderEntity[]> {
        return db<DrayageOrderEntity>('drayage_order')
            .where('freight_file_id', freightFileId)
            .orderBy('created_at', 'asc');
    }

    public static async createDrayageOrder(data: Partial<DrayageOrderEntity>): Promise<DrayageOrderEntity> {
        const id = data.id || randomUUID();
        await db('drayage_order').insert({
            ...data,
            id,
            created_at: db.fn.now(),
            updated_at: db.fn.now(),
        });
        return (await db<DrayageOrderEntity>('drayage_order').where('id', id).first())!;
    }

    public static async getDocuments(freightFileId: string): Promise<FileDocumentEntity[]> {
        return db<FileDocumentEntity>('file_document')
            .where('freight_file_id', freightFileId)
            .orderBy('created_at', 'asc');
    }

    public static async getExceptions(freightFileId: string): Promise<ExceptionCaseEntity[]> {
        return db<ExceptionCaseEntity>('exception_case')
            .where('freight_file_id', freightFileId)
            .orderBy('created_at', 'desc');
    }

    public static async createException(data: Partial<ExceptionCaseEntity>): Promise<ExceptionCaseEntity> {
        const id = data.id || randomUUID();
        await db('exception_case').insert({
            ...data,
            id,
            created_at: db.fn.now(),
            updated_at: db.fn.now(),
        });
        return (await db<ExceptionCaseEntity>('exception_case').where('id', id).first())!;
    }

    public static async getMetrics(workspaceId: string) {
        const stats = await db('freight_file')
            .where('workspace_id', workspaceId)
            .where('mode', 'sea')
            .whereNull('deleted_at')
            .select(
                db.raw('COUNT(id) as total_active'),
                db.raw("SUM(CASE WHEN direction = 'import' THEN 1 ELSE 0 END) as total_import"),
                db.raw("SUM(CASE WHEN direction = 'export' THEN 1 ELSE 0 END) as total_export"),
                db.raw("SUM(CASE WHEN special_handling_status = 'red' THEN 1 ELSE 0 END) as red_alerts"),
                db.raw("SUM(CASE WHEN status = 'arrived' AND free_time_expires_at <= DATE_ADD(NOW(), INTERVAL 2 DAY) THEN 1 ELSE 0 END) as demurrage_risks")
            )
            .first();

        return stats;
    }
}
