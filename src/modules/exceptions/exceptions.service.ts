import db from '../../db/connection.js';
import { AppError } from '../../utils/response.js';
import { AuditService } from '../audit/audit.service.js';
import type { ListExceptionsQuery, UpdateExceptionCaseInput } from './exceptions.schema.js';

export interface ExceptionCaseItem {
    id: string;
    freight_file_id: string;
    file_no: string;
    file_direction: string;
    file_status: string;
    gate_code: string | null;
    type: string;
    severity: string;
    status: string;
    title: string;
    description: string | null;
    assignee_id: string | null;
    resolution_notes: string | null;
    resolved_by: string | null;
    resolved_at: Date | null;
    created_by: string;
    created_at: Date;
    updated_at: Date;
    version: number;
}

export class ExceptionsService {
    /**
     * List all exceptions across dossiers with filtering and cursor pagination.
     */
    static async listExceptions(
        query: ListExceptionsQuery,
        workspaceId: string
    ): Promise<{ data: ExceptionCaseItem[]; page: { next_cursor: string | null; total: number; limit: number } }> {
        const { status, severity, file_id, gate_code, limit = 50, cursor } = query;

        // Base query with join
        const buildBaseQuery = () => {
            const q = db('exception_case')
                .join('freight_file', 'exception_case.freight_file_id', 'freight_file.id')
                .where('exception_case.workspace_id', workspaceId);

            if (status) {
                q.where('exception_case.status', status);
            }
            if (severity) {
                q.where('exception_case.severity', severity);
            }
            if (file_id) {
                q.where('exception_case.freight_file_id', file_id);
            }
            if (gate_code) {
                q.where('exception_case.gate_code', gate_code);
            }

            return q;
        };

        // Total count matching filters
        const countResult = await buildBaseQuery().count<{ total: number }>('exception_case.id as total').first();
        const total = Number(countResult?.total) || 0;

        // Pagination query
        const dataQuery = buildBaseQuery()
            .select(
                'exception_case.id',
                'exception_case.freight_file_id',
                'freight_file.file_no',
                'freight_file.direction as file_direction',
                'freight_file.status as file_status',
                'exception_case.gate_code',
                'exception_case.type',
                'exception_case.severity',
                'exception_case.status',
                'exception_case.title',
                'exception_case.description',
                'exception_case.assignee_id',
                'exception_case.resolution_notes',
                'exception_case.resolved_by',
                'exception_case.resolved_at',
                'exception_case.created_by',
                'exception_case.created_at',
                'exception_case.updated_at',
                'exception_case.version'
            )
            .orderBy('exception_case.created_at', 'desc')
            .orderBy('exception_case.id', 'desc')
            .limit(limit + 1);

        if (cursor) {
            try {
                const decoded = JSON.parse(Buffer.from(cursor, 'base64').toString('utf8'));
                if (decoded.created_at && decoded.id) {
                    dataQuery.where((builder) => {
                        builder
                            .where('exception_case.created_at', '<', new Date(decoded.created_at))
                            .orWhere((inner) => {
                                inner
                                    .where('exception_case.created_at', '=', new Date(decoded.created_at))
                                    .andWhere('exception_case.id', '<', decoded.id);
                            });
                    });
                }
            } catch {
                // Invalid cursor, continue from top
            }
        }

        const rows = await dataQuery;
        let nextCursor: string | null = null;

        if (rows.length > limit) {
            const extra = rows.pop(); // Remove extra item
            const lastItem = rows[rows.length - 1];
            if (lastItem) {
                nextCursor = Buffer.from(
                    JSON.stringify({
                        created_at: lastItem.created_at,
                        id: lastItem.id,
                    })
                ).toString('base64');
            }
        }

        return {
            data: rows as ExceptionCaseItem[],
            page: {
                next_cursor: nextCursor,
                total,
                limit,
            },
        };
    }

    /**
     * Get single exception case by ID.
     */
    static async getExceptionById(id: string, workspaceId: string): Promise<ExceptionCaseItem> {
        const item = await db('exception_case')
            .join('freight_file', 'exception_case.freight_file_id', 'freight_file.id')
            .where('exception_case.id', id)
            .where('exception_case.workspace_id', workspaceId)
            .select(
                'exception_case.id',
                'exception_case.freight_file_id',
                'freight_file.file_no',
                'freight_file.direction as file_direction',
                'freight_file.status as file_status',
                'exception_case.gate_code',
                'exception_case.type',
                'exception_case.severity',
                'exception_case.status',
                'exception_case.title',
                'exception_case.description',
                'exception_case.assignee_id',
                'exception_case.resolution_notes',
                'exception_case.resolved_by',
                'exception_case.resolved_at',
                'exception_case.created_by',
                'exception_case.created_at',
                'exception_case.updated_at',
                'exception_case.version'
            )
            .first();

        if (!item) {
            throw new AppError(404, 'NOT_FOUND', `Exception case with ID '${id}' not found`);
        }

        return item as ExceptionCaseItem;
    }

    /**
     * Update an exception case (status transition, resolution notes, assignment).
     */
    static async updateException(
        id: string,
        workspaceId: string,
        actorId: string,
        input: UpdateExceptionCaseInput
    ): Promise<ExceptionCaseItem> {
        const existing = await db('exception_case')
            .where({ id, workspace_id: workspaceId })
            .first();

        if (!existing) {
            throw new AppError(404, 'NOT_FOUND', `Exception case with ID '${id}' not found`);
        }

        if (input.version !== undefined && existing.version !== input.version) {
            throw new AppError(
                409,
                'CONFLICT',
                `Conflict: exception case version is ${existing.version}, but provided version was ${input.version}. Please refresh and try again.`
            );
        }

        const updates: Record<string, unknown> = {
            updated_at: db.fn.now(),
            version: existing.version + 1,
        };

        if (input.title !== undefined) updates.title = input.title;
        if (input.description !== undefined) updates.description = input.description;
        if (input.severity !== undefined) updates.severity = input.severity;
        if (input.assignee_id !== undefined) updates.assignee_id = input.assignee_id;
        if (input.resolution_notes !== undefined) updates.resolution_notes = input.resolution_notes;

        if (input.status !== undefined) {
            updates.status = input.status;
            if (input.status === 'Resolved' || input.status === 'Closed') {
                let resolverId: string | null = null;
                if (actorId && actorId !== 'system') {
                    const user = await db('app_user').where({ id: actorId }).first();
                    if (user) resolverId = user.id;
                }
                updates.resolved_by = resolverId;
                updates.resolved_at = db.fn.now();
            } else if (input.status === 'Open' || input.status === 'InProgress') {
                // Reopening
                updates.resolved_by = null;
                updates.resolved_at = null;
            }
        }

        await db('exception_case')
            .where({ id, workspace_id: workspaceId, version: existing.version })
            .update(updates);

        // Audit log
        await AuditService.log({
            workspaceId,
            actorId,
            entityType: 'exception_case',
            entityId: id,
            action: input.status === 'Resolved' ? 'resolve' : 'update',
            fromState: existing.status,
            toState: (updates.status as string) || existing.status,
            payload: {
                title: updates.title || existing.title,
                severity: updates.severity || existing.severity,
                resolution_notes: updates.resolution_notes,
            },
        });

        return this.getExceptionById(id, workspaceId);
    }
}
