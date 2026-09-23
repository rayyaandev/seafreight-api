export type FreightMode = 'sea' | 'air';
export type FreightDirection = 'import' | 'export';

export type SeaImportStatus =
    | 'draft'
    | 'release_pending'
    | 'in_transit'
    | 'arrived'
    | 'cleared'
    | 'delivered'
    | 'closed';

export type SeaExportStatus =
    | 'draft'
    | 'booked'
    | 'vgm_si_submitted'
    | 'loaded'
    | 'bl_issued'
    | 'closed';

export type FreightStatus = SeaImportStatus | SeaExportStatus;

export type SpecialHandlingType = 'none' | 'imdg' | 'reefer' | 'oog';
export type SpecialHandlingStatus = 'green' | 'orange' | 'red';
export type CustomsDeclarationStatus = 'none' | 'submitted' | 'accepted' | 'rejected' | 'under_control';

export interface FreightFileEntity {
    id: string;
    human_id: string;
    workspace_id: string;
    mode: FreightMode;
    direction: FreightDirection;
    status: string;
    shipper_name?: string | null;
    consignee_name?: string | null;
    notify_party_name?: string | null;
    carrier_name?: string | null;
    pol?: string | null;
    pod?: string | null;
    incoterm?: string | null;
    vessel_name?: string | null;
    voyage_number?: string | null;
    eta?: Date | string | null;
    ata?: Date | string | null;
    etd?: Date | string | null;
    atd?: Date | string | null;
    bl_release_gate_passed: boolean | number;
    customs_release_gate_passed: boolean | number;
    container_release_gate_passed: boolean | number;
    vgm_cutoff_gate_passed: boolean | number;
    vgm_cutoff_at?: Date | string | null;
    special_handling_type: SpecialHandlingType;
    special_handling_status: SpecialHandlingStatus;
    free_time_expires_at?: Date | string | null;
    customs_declaration_id?: string | null;
    customs_declaration_status: CustomsDeclarationStatus;
    total_cost?: number | string | null;
    currency?: string | null;
    created_by: string;
    version: number;
    created_at: Date | string;
    updated_at: Date | string;
    deleted_at?: Date | string | null;
}

export interface FreightContainerEntity {
    id: string;
    freight_file_id: string;
    container_number: string;
    container_type: string;
    seal_number?: string | null;
    tare_weight_kg?: number | string | null;
    cargo_weight_kg?: number | string | null;
    vgm_weight_kg?: number | string | null;
    vgm_method?: 'method_1' | 'method_2' | null;
    vgm_submitted_at?: Date | string | null;
    vgm_verified_by?: string | null;
    temperature_setpoint_c?: number | string | null;
    ventilation_cbm_hr?: number | string | null;
    humidity_percent?: number | string | null;
    pre_trip_inspection_passed: boolean | number;
    imdg_class?: string | null;
    un_number?: string | null;
    packing_group?: 'I' | 'II' | 'III' | null;
    proper_shipping_name?: string | null;
    msds_attached: boolean | number;
    dg_declaration_attached: boolean | number;
    carrier_dg_accepted: boolean | number;
    dg_segregation_requirements?: string | null;
    reefer_monitoring_confirmed?: boolean | number;
    is_oog: boolean | number;
    oog_dimensions?: string | null;
    created_at: Date | string;
    updated_at: Date | string;
}

export interface DrayageOrderEntity {
    id: string;
    freight_file_id: string;
    container_id?: string | null;
    order_number: string;
    type: 'import_delivery' | 'export_positioning' | 'empty_reposition';
    terminal_name: string;
    facility_address: string;
    trucking_company?: string | null;
    driver_name?: string | null;
    truck_plate?: string | null;
    chassis_number?: string | null;
    status: 'draft' | 'scheduled' | 'en_route' | 'gate_in' | 'gate_out' | 'delivered' | 'cancelled';
    scheduled_at?: Date | string | null;
    gate_in_at?: Date | string | null;
    gate_out_at?: Date | string | null;
    delivered_at?: Date | string | null;
    pod_signature_ref?: string | null;
    created_at: Date | string;
    updated_at: Date | string;
}

export interface FileDocumentEntity {
    id: string;
    freight_file_id: string;
    doc_type: string;
    file_name: string;
    file_url: string;
    file_size_bytes?: number | null;
    mime_type?: string | null;
    is_ocr_processed: boolean | number;
    ocr_confidence?: number | null;
    ocr_extracted_data?: string | null;
    created_by: string;
    created_at: Date | string;
    updated_at: Date | string;
}

export interface ExceptionCaseEntity {
    id: string;
    workspace_id: string;
    freight_file_id: string;
    type: string;
    severity: 'info' | 'warn' | 'critical';
    status: 'open' | 'in_progress' | 'resolved' | 'closed';
    title: string;
    description?: string | null;
    resolution_notes?: string | null;
    assigned_to?: string | null;
    resolved_by?: string | null;
    resolved_at?: Date | string | null;
    created_at: Date | string;
    updated_at: Date | string;
}
