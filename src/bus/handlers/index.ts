import type { EventEnvelope } from '../../common/events.js';
import { ConsumedEvents } from '../../common/events.js';
import { handleDeclarationAccepted } from './declarationAccepted.handler.js';
import { handleDeclarationRejected } from './declarationRejected.handler.js';
import { handleSalesQuoteWon } from './salesQuoteWon.handler.js';
import { handleDocumentOcr } from './documentOcr.handler.js';
import { handleTruckingStatus } from './truckingStatus.handler.js';
import { handleWmsEvent } from './wmsEvent.handler.js';
import { handleMasterdataUpdated } from './masterdataUpdated.handler.js';

export type EventHandler = (envelope: EventEnvelope) => Promise<void>;

/**
 * Registry mapping event type strings to their handler functions.
 * Wildcard patterns (e.g. `masterdata.*.updated`) are resolved
 * by the consumer engine at dispatch time.
 */
export const handlerRegistry = new Map<string, EventHandler>([
    [ConsumedEvents.DECLARATION_ACCEPTED, handleDeclarationAccepted],
    [ConsumedEvents.DECLARATION_REJECTED, handleDeclarationRejected],
    [ConsumedEvents.DECLARATION_UNDER_CONTROL, handleDeclarationRejected],
    [ConsumedEvents.SALES_QUOTE_WON, handleSalesQuoteWon],
    [ConsumedEvents.DOCUMENT_OCR_COMPLETED, handleDocumentOcr],
    [ConsumedEvents.DOCUMENT_GENERATE_COMPLETED, handleDocumentOcr], // Same handler for generated docs
    [ConsumedEvents.TRUCKING_STATUS_UPDATED, handleTruckingStatus],
    [ConsumedEvents.WMS_EVENT, handleWmsEvent],
    [ConsumedEvents.MASTERDATA_UPDATED, handleMasterdataUpdated],
]);
