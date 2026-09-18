import { Router } from 'express';
import { FreightController } from './freight.controller.js';
import { validateBody, validateQuery } from '../../middleware/validate.js';
import { requirePermission } from '../../middleware/rbac.js';
import {
    ListFreightFilesQuerySchema,
    CreateFreightFileSchema,
    UpdateFreightFileSchema,
    SpecialHandlingOverrideSchema,
    CreateContainerSchema,
    CreateFreightLineSchema,
    CreateBillOfLadingSchema,
    CreateFileDocumentSchema,
    CreateFileNoteSchema,
    CreateDrayageOrderSchema,
    CreateExceptionCaseSchema,
    CreateChargeSchema,
} from '../../common/schemas.js';

export const freightRouter = Router();

// Dossier CRUD & Gates
freightRouter.get('/files', validateQuery(ListFreightFilesQuerySchema), requirePermission('freight.file.read'), FreightController.listFiles);
freightRouter.post('/files', validateBody(CreateFreightFileSchema), requirePermission('freight.file.create'), FreightController.createFile);
freightRouter.get('/files/:id', requirePermission('freight.file.read'), FreightController.getFileDossier);
freightRouter.patch('/files/:id', validateBody(UpdateFreightFileSchema), requirePermission('freight.file.update'), FreightController.updateFile);
freightRouter.get('/files/:id/gates', requirePermission('freight.file.read'), FreightController.evaluateGates);
freightRouter.post('/files/:id/special-handling', validateBody(SpecialHandlingOverrideSchema), requirePermission('freight.file.special_handling'), FreightController.updateSpecialHandling);

// Child Collections
// 1. Containers
freightRouter.post('/files/:id/containers', validateBody(CreateContainerSchema), requirePermission('freight.file.update'), FreightController.addContainer);
freightRouter.delete('/files/:id/containers/:containerId', requirePermission('freight.file.update'), FreightController.deleteContainer);

// 2. Freight Lines
freightRouter.post('/files/:id/lines', validateBody(CreateFreightLineSchema), requirePermission('freight.file.update'), FreightController.addFreightLine);
freightRouter.delete('/files/:id/lines/:lineId', requirePermission('freight.file.update'), FreightController.deleteFreightLine);

// 3. Bills of Lading
freightRouter.post('/files/:id/bills-of-lading', validateBody(CreateBillOfLadingSchema), requirePermission('freight.file.update'), FreightController.addBillOfLading);

// 4. Documents
freightRouter.post('/files/:id/documents', validateBody(CreateFileDocumentSchema), requirePermission('freight.file.update'), FreightController.addDocument);
freightRouter.delete('/files/:id/documents/:docId', requirePermission('freight.file.update'), FreightController.deleteDocument);

// 5. Notes
freightRouter.post('/files/:id/notes', validateBody(CreateFileNoteSchema), requirePermission('freight.file.update'), FreightController.addNote);

// 6. Drayage Orders
freightRouter.post('/files/:id/drayage-orders', validateBody(CreateDrayageOrderSchema), requirePermission('freight.file.update'), FreightController.addDrayageOrder);

// 7. Milestones
freightRouter.post('/files/:id/milestones', requirePermission('freight.file.update'), FreightController.addMilestone);

// 8. Exception Cases
freightRouter.post('/files/:id/exceptions', validateBody(CreateExceptionCaseSchema), requirePermission('exceptions.write'), FreightController.addExceptionCase);

// 9. Charges
freightRouter.post('/files/:id/charges', validateBody(CreateChargeSchema), requirePermission('freight.file.update'), FreightController.addCharge);
freightRouter.delete('/files/:id/charges/:chargeId', requirePermission('freight.file.update'), FreightController.deleteCharge);
