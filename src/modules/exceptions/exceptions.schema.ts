import { z } from 'zod';
import { CaseStatus, CaseSeverity } from '../../common/enums.js';

export const ListExceptionsQuerySchema = z.object({
    status: z.enum([
        CaseStatus.OPEN,
        CaseStatus.IN_PROGRESS,
        CaseStatus.RESOLVED,
        CaseStatus.CLOSED,
    ]).optional(),
    severity: z.enum([
        CaseSeverity.INFO,
        CaseSeverity.WARN,
        CaseSeverity.CRITICAL,
    ]).optional(),
    file_id: z.string().uuid().optional(),
    gate_code: z.string().max(50).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    cursor: z.string().optional(),
});

export type ListExceptionsQuery = z.infer<typeof ListExceptionsQuerySchema>;

export const UpdateExceptionCaseSchema = z.object({
    status: z.enum([
        CaseStatus.OPEN,
        CaseStatus.IN_PROGRESS,
        CaseStatus.RESOLVED,
        CaseStatus.CLOSED,
    ]).optional(),
    title: z.string().min(1).max(255).optional(),
    description: z.string().optional(),
    severity: z.enum([
        CaseSeverity.INFO,
        CaseSeverity.WARN,
        CaseSeverity.CRITICAL,
    ]).optional(),
    assignee_id: z.string().uuid().nullable().optional(),
    resolution_notes: z.string().optional(),
    version: z.number().int().optional(),
});

export type UpdateExceptionCaseInput = z.infer<typeof UpdateExceptionCaseSchema>;
