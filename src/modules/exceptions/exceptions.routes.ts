import { Router } from 'express';
import { ExceptionsController } from './exceptions.controller.js';
import { validateBody, validateQuery } from '../../middleware/validate.js';
import { requirePermission } from '../../middleware/rbac.js';
import { ListExceptionsQuerySchema, UpdateExceptionCaseSchema } from './exceptions.schema.js';

export const exceptionsRouter = Router();

// GET /v1/exceptions - List all exceptions across dossiers
exceptionsRouter.get(
    '/',
    validateQuery(ListExceptionsQuerySchema),
    requirePermission('exceptions.read'),
    ExceptionsController.listExceptions
);

// GET /v1/exceptions/:id - View single exception details
exceptionsRouter.get(
    '/:id',
    requirePermission('exceptions.read'),
    ExceptionsController.getException
);

// PATCH /v1/exceptions/:id - Update status / resolve exception
exceptionsRouter.patch(
    '/:id',
    validateBody(UpdateExceptionCaseSchema),
    requirePermission('exceptions.write'),
    ExceptionsController.updateException
);
