import { Router } from 'express';
import { MasterDataController } from './masterData.controller.js';
import { requirePermission } from '../../middleware/rbac.js';

export const masterDataRouter = Router();

// GET /v1/masterdata/:entity?q=
masterDataRouter.get('/:entity', requirePermission('masterdata.read'), MasterDataController.search);
