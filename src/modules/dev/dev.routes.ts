import { Router } from 'express';
import { DevController } from './dev.controller.js';
import { validateBody } from '../../middleware/validate.js';
import { requirePermission } from '../../middleware/rbac.js';
import { SimulateEventSchema } from '../../common/schemas.js';

export const devRouter = Router();

// Get canned templates (Coordinator, customs, manager, admin can view)
devRouter.get('/templates', DevController.getTemplates);

// Simulate event endpoint (Guarded strictly by dev.simulate permission)
devRouter.post(
    '/simulate',
    validateBody(SimulateEventSchema),
    requirePermission('dev.simulate'),
    DevController.simulate
);
