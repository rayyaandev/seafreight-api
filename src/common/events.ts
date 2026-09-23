export interface EventEnvelope<T = Record<string, unknown>> {
    id: string; // UUID used for deduplication (processed_message table)
    type: string; // e.g. "freight.file.cleared"
    occurred_at: string; // ISO 8601 UTC timestamp
    workspace_id: string; // Tenant workspace scoping
    actor: string; // User UUID or "system"
    version: number; // Schema/event version
    payload: T;
}

export const PublishedEvents = {
    FILE_CREATED: 'freight.file.created',
    FILE_UPDATED: 'freight.file.updated',
    FILE_BOOKED: 'freight.file.booked',
    FILE_COLLECTED: 'freight.file.collected',
    FILE_DEPARTED: 'freight.file.departed',
    FILE_ARRIVED: 'freight.file.arrived',
    FILE_CLEARED: 'freight.file.cleared',
    FILE_DELIVERED: 'freight.file.delivered',
    FILE_CLOSED: 'freight.file.closed',
    CONTAINER_GATED_IN: 'freight.container.gated_in',
    CONTAINER_GATED_OUT: 'freight.container.gated_out',
    DECLARATION_SUBMIT_REQUESTED: 'declaration.submit.requested',
    CARRIER_BOOKING_CONFIRMED: 'carrier.booking.confirmed',
    CARRIER_SCHEDULE_UPDATED: 'carrier.schedule.updated',
    TRUCKING_ORDER_CREATE_REQUESTED: 'trucking.order.create.requested',
    TRUCKING_ORDER_UPDATE_REQUESTED: 'trucking.order.update.requested',
    TRUCKING_ORDER_CANCEL_REQUESTED: 'trucking.order.cancel.requested',
    BONDED_EVENT_RECORDED: 'freight.bonded_event.recorded',
} as const;

export const ConsumedEvents = {
    DECLARATION_ACCEPTED: 'declaration.accepted',
    DECLARATION_REJECTED: 'declaration.rejected',
    DECLARATION_UNDER_CONTROL: 'declaration.under_control',
    PORTBASE_CONTAINER_RELEASED: 'portbase.container.released',
    PORTBASE_MESSAGE_ACCEPTED: 'portbase.message.accepted',
    PORTBASE_MESSAGE_REJECTED: 'portbase.message.rejected',
    CARRIER_BOOKING_CONFIRMED: 'carrier.booking.confirmed',
    CARRIER_SCHEDULE_UPDATED: 'carrier.schedule.updated',
    TERMINAL_CONTAINER_GATED_IN: 'terminal.container.gated_in',
    TERMINAL_CONTAINER_GATED_OUT: 'terminal.container.gated_out',
    SALES_QUOTE_WON: 'sales.quote.won',
    DOCUMENT_OCR_COMPLETED: 'document.ocr.completed',
    DOCUMENT_GENERATE_COMPLETED: 'document.generate.completed',
    TRUCKING_STATUS_UPDATED: 'trucking.order.updated',
    TRUCKING_ORDER_LINKED: 'trucking.order.linked',
    WMS_EVENT: 'wms.event',
    MASTERDATA_UPDATED: 'masterdata.*.updated',
} as const;

// Event Payload Interfaces
export interface FileCreatedPayload {
    file_id: string;
    file_no: string;
    direction: 'import' | 'export';
    customer_id?: string | null;
    shipper_id?: string | null;
    consignee_id?: string | null;
    pol_id?: string | null;
    pod_id?: string | null;
}

export interface FileTransitionPayload {
    file_id: string;
    file_no: string;
    from_status: string;
    to_status: string;
    reason?: string | null;
}

export interface DeclarationAcceptedPayload {
    declaration_id: string;
    file_id?: string;
    file_no?: string;
    mrn: string;
    accepted_at: string;
}

export interface DeclarationRejectedPayload {
    declaration_id: string;
    file_id?: string;
    file_no?: string;
    mrn?: string;
    rejection_reason: string;
}

export interface SalesQuoteWonPayload {
    quote_id: string;
    customer_name: string;
    customer_id?: string;
    shipper_name?: string;
    consignee_name?: string;
    pol: string;
    pod: string;
    cargo_description?: string;
    container_type?: string;
    agreed_rate?: number;
    currency?: string;
}

export interface DocumentOcrCompletedPayload {
    document_id: string;
    file_id: string;
    doc_type: string;
    confidence: number;
    extracted_fields: Record<string, { value: any; confidence: number }>;
}
