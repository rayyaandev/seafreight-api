import { Router } from 'express';
import { FreightController } from './freight.controller.js';
import { validateBody, validateQuery } from '../../middleware/validate.js';
import { requirePermission } from '../../middleware/rbac.js';
import {
    ListFreightFilesQuerySchema,
    CreateFreightFileSchema,
    UpdateFreightFileSchema,
    TransitionActionSchema,
    RecordAtaSchema,
    ActionVersionSchema,
    SpecialHandlingOverrideSchema,
    CreateContainerSchema,
    UpdateContainerHandlingSchema,
    GateInContainerSchema,
    CreateFreightLineSchema,
    CreateBillOfLadingSchema,
    CreateFileDocumentSchema,
    CreateFileNoteSchema,
    CreateDrayageOrderSchema,
    UpdateDrayageOrderSchema,
    CreateBondedEventSchema,
    CreateMilestoneSchema,
    CreateExceptionCaseSchema,
    CreateChargeSchema,
} from '../../common/schemas.js';

export const freightRouter = Router();

// Metrics KPI Endpoint
freightRouter.get('/metrics', requirePermission('freight.file.read'), FreightController.getMetrics);

// Dossier CRUD & Gates
freightRouter.get('/files', validateQuery(ListFreightFilesQuerySchema), requirePermission('freight.file.read'), FreightController.listFiles);
freightRouter.post('/files', validateBody(CreateFreightFileSchema), requirePermission('freight.file.create'), FreightController.createFile);
freightRouter.get('/files/:id', requirePermission('freight.file.read'), FreightController.getFileDossier);
freightRouter.patch('/files/:id', validateBody(UpdateFreightFileSchema), requirePermission('freight.file.update'), FreightController.updateFile);
freightRouter.get('/files/:id/gates', requirePermission('freight.file.read'), FreightController.evaluateGates);
freightRouter.post('/files/:id/special-handling', validateBody(SpecialHandlingOverrideSchema), requirePermission('freight.file.special_handling'), FreightController.updateSpecialHandling);

// Generic Transition Route
freightRouter.post('/files/:id/transition', validateBody(TransitionActionSchema), requirePermission('freight.file.update'), FreightController.transitionFile);

// Sea Import Explicit Action Endpoints
freightRouter.post('/files/:id/release-bl', validateBody(ActionVersionSchema), requirePermission('freight.file.release_bl'), FreightController.releaseBl);
freightRouter.post('/files/:id/record-ata', validateBody(RecordAtaSchema), requirePermission('freight.file.record_ata'), FreightController.recordAta);
freightRouter.post('/files/:id/clear', validateBody(ActionVersionSchema), requirePermission('freight.file.clear'), FreightController.clearCustoms);
freightRouter.post('/files/:id/deliver', validateBody(ActionVersionSchema), requirePermission('freight.file.deliver'), FreightController.deliverFile);

// Sea Export Explicit Action Endpoints
freightRouter.post('/files/:id/book', validateBody(ActionVersionSchema), requirePermission('freight.file.book'), FreightController.bookExport);
freightRouter.post('/files/:id/submit-vgm', validateBody(ActionVersionSchema), requirePermission('freight.file.submit_vgm'), FreightController.submitVgm);
freightRouter.post('/files/:id/load', validateBody(ActionVersionSchema), requirePermission('freight.file.load'), FreightController.loadExport);
freightRouter.post('/files/:id/issue-bl', validateBody(ActionVersionSchema), requirePermission('freight.file.issue_bl'), FreightController.issueBl);

// Common Close Endpoint
freightRouter.post('/files/:id/close', validateBody(ActionVersionSchema), requirePermission('freight.file.close'), FreightController.closeFile);

// Child Collections
// 1. Containers
freightRouter.post('/files/:id/containers', validateBody(CreateContainerSchema), requirePermission('freight.file.update'), FreightController.addContainer);
freightRouter.patch('/files/:id/containers/:containerId/special-handling', validateBody(UpdateContainerHandlingSchema), requirePermission('freight.file.special_handling'), FreightController.updateContainerHandling);
freightRouter.post('/files/:id/containers/:containerId/gate-in', validateBody(GateInContainerSchema), requirePermission('freight.file.update'), FreightController.gateInContainer);
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
freightRouter.post('/files/:id/drayage', validateBody(CreateDrayageOrderSchema), requirePermission('freight.file.update'), FreightController.addDrayageOrder);
freightRouter.patch('/files/:id/drayage-orders/:orderId', validateBody(UpdateDrayageOrderSchema), requirePermission('freight.file.update'), FreightController.updateDrayageOrder);
freightRouter.post('/files/:id/drayage-orders/:orderId/cancel', validateBody(ActionVersionSchema), requirePermission('freight.file.update'), FreightController.cancelDrayageOrder);

// T1 transit and bonded warehouse events
freightRouter.get('/files/:id/bonded-events', requirePermission('freight.file.read'), FreightController.listBondedEvents);
freightRouter.post('/files/:id/bonded-events', validateBody(CreateBondedEventSchema), requirePermission('freight.file.update'), FreightController.addBondedEvent);

// 7. Milestones
freightRouter.post('/files/:id/milestones', validateBody(CreateMilestoneSchema), requirePermission('freight.file.update'), FreightController.addMilestone);

// 8. Exception Cases
freightRouter.post('/files/:id/exceptions', validateBody(CreateExceptionCaseSchema), requirePermission('exceptions.write'), FreightController.addExceptionCase);

// 9. Charges
freightRouter.post('/files/:id/charges', validateBody(CreateChargeSchema), requirePermission('freight.file.update'), FreightController.addCharge);
freightRouter.delete('/files/:id/charges/:chargeId', requirePermission('freight.file.update'), FreightController.deleteCharge);
