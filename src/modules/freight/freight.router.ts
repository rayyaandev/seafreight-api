import { Router } from 'express';
import { FreightController } from './freight.controller.js';
import { validateBody, validateQuery } from '../../middleware/validate.js';
import {
    ListFreightFilesQuerySchema,
    CreateFreightFileSchema,
    UpdateFreightFileSchema,
    TransitionStateSchema,
    CreateContainerSchema,
    CreateDrayageOrderSchema,
    CreateExceptionCaseSchema,
} from './freight.schema.js';

export const freightRouter: Router = Router();

// Metrics
freightRouter.get('/metrics', FreightController.getMetrics);

// Files CRUD & List
freightRouter.get('/files', validateQuery(ListFreightFilesQuerySchema), FreightController.listFiles);
freightRouter.post('/files', validateBody(CreateFreightFileSchema), FreightController.createFile);
freightRouter.get('/files/:id', FreightController.getFileDossier);
freightRouter.patch('/files/:id', validateBody(UpdateFreightFileSchema), FreightController.updateFile);

// Workflow state transition & gates
freightRouter.post('/files/:id/transition', validateBody(TransitionStateSchema), FreightController.transitionState);

// Sub-resources: Containers, Drayage, Exceptions
freightRouter.post('/files/:id/containers', validateBody(CreateContainerSchema), FreightController.addContainer);
freightRouter.post('/files/:id/drayage', validateBody(CreateDrayageOrderSchema), FreightController.addDrayageOrder);
freightRouter.post('/files/:id/exceptions', validateBody(CreateExceptionCaseSchema), FreightController.addExceptionCase);
