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
} as const;

export const ConsumedEvents = {
    DECLARATION_ACCEPTED: 'declaration.accepted',
    DECLARATION_REJECTED: 'declaration.rejected',
    DECLARATION_UNDER_CONTROL: 'declaration.under_control',
    SALES_QUOTE_WON: 'sales.quote.won',
    DOCUMENT_OCR_COMPLETED: 'document.ocr.completed',
    DOCUMENT_GENERATE_COMPLETED: 'document.generate.completed',
    TRUCKING_STATUS_UPDATED: 'trucking.order.updated',
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
