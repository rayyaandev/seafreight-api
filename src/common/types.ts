import type {
    Mode,
    Direction,
    SeaImportStatus,
    SeaExportStatus,
    SpecialStatus,
    SpecialType,
    CaseStatus,
    CaseSeverity,
    ContainerType,
    CustomsDeclarationStatus,
    VgmMethod,
    PackingGroup,
    DocType,
    DrayageType,
    DrayageStatus,
    MilestoneType,
    T1EventType,
    ChargeLineType,
    OutboxStatus,
} from './enums.js';

// Base 6-Column Standard interface
export interface BaseEntity {
    id: string; // CHAR(36) UUID
    workspace_id: string; // CHAR(36)
    created_at: Date | string; // DATETIME
    updated_at: Date | string; // DATETIME
    created_by: string; // CHAR(36)
    version: number; // INT (Optimistic Concurrency)
}

// Master Data Entities
export interface WorkspaceEntity extends BaseEntity {
    name: string;
    code: string;
    domain?: string | null;
}

export interface AppUserEntity extends BaseEntity {
    email: string;
    password_hash: string;
    name: string;
    role_id: string;
    is_active: boolean | number;
}

export interface RoleEntity extends BaseEntity {
    name: string; // 'Sea Freight Coordinator', 'Customs', etc.
    description?: string | null;
}

export interface PermissionEntity extends BaseEntity {
    code: string; // 'freight.file.create', 'freight.file.release_bl'
    description?: string | null;
}

export interface ClientEntity extends BaseEntity {
    name: string;
    code: string;
    type: 'customer' | 'shipper' | 'consignee' | 'notify_party' | 'partner';
    tax_number?: string | null;
    address?: string | null;
    country?: string | null;
}

export interface LocationEntity extends BaseEntity {
    un_locode: string; // e.g. 'NLRTM'
    name: string; // 'Rotterdam'
    country_code: string; // 'NL'
    type: 'port' | 'inland_terminal' | 'airport' | 'warehouse';
}

export interface IncotermEntity extends BaseEntity {
    code: string; // 'FOB', 'CIF', 'DAP'
    description: string;
}

export interface CurrencyEntity extends BaseEntity {
    code: string; // 'EUR', 'USD'
    name: string;
    symbol: string;
}

export interface CarrierEntity extends BaseEntity {
    name: string; // 'Maersk', 'MSC'
    scac_code?: string | null;
    line_code?: string | null;
}

// Core Freight File Entity
export interface FreightFileEntity extends BaseEntity {
    file_no: string; // 'SF-2026-00042'
    mode: Mode;
    direction: Direction;
    status: SeaImportStatus | SeaExportStatus | string;
    customer_id?: string | null;
    shipper_id?: string | null;
    consignee_id?: string | null;
    notify_party_id?: string | null;
    carrier_id?: string | null;
    carrier_booking_ref?: string | null;
    pol_id?: string | null;
    pod_id?: string | null;
    incoterm_id?: string | null;
    vessel?: string | null;
    voyage?: string | null;
    etd?: Date | string | null;
    eta?: Date | string | null;
    ata?: Date | string | null;
    atd?: Date | string | null;
    doc_cutoff?: Date | string | null;
    vgm_cutoff?: Date | string | null;
    gate_cutoff?: Date | string | null;
    special_handling: SpecialType;
    special_status: SpecialStatus;
    free_time_days: number;
    declaration_id?: string | null;
    declaration_status: CustomsDeclarationStatus;
    mrn?: string | null;
    container_release_received_at?: Date | string | null;
    lc_flag: boolean | number;
    total_cost?: number | string | null;
    currency?: string | null;
    deleted_at?: Date | string | null;
}

// Child Entities
export interface ContainerEntity extends BaseEntity {
    freight_file_id: string;
    container_number: string;
    type: ContainerType | string;
    seal_number?: string | null;
    tare_weight_kg?: number | string | null;
    gross_weight_kg?: number | string | null;
    vgm_kg?: number | string | null;
    vgm_submitted_at?: Date | string | null;
    vgm_method?: VgmMethod | string | null;
    gate_in_at?: Date | string | null;
    gate_out_at?: Date | string | null;
    temperature_setpoint_c?: number | string | null;
    ventilation_cbm_hr?: number | string | null;
    humidity_percent?: number | string | null;
    pre_trip_inspection_passed: boolean | number;
    imdg_class?: string | null;
    un_number?: string | null;
    packing_group?: PackingGroup | string | null;
    proper_shipping_name?: string | null;
    msds_attached: boolean | number;
    dg_declaration_attached: boolean | number;
    carrier_dg_accepted: boolean | number;
    dg_segregation_requirements?: string | null;
    reefer_monitoring_confirmed: boolean | number;
    is_oog: boolean | number;
    oog_dimensions?: string | null;
}

export type FreightContainerEntity = ContainerEntity;

export interface FreightLineEntity extends BaseEntity {
    freight_file_id: string;
    description: string;
    commodity_code?: string | null;
    quantity: number;
    packages?: number | null;
    weight_kg?: number | string | null;
    volume_cbm?: number | string | null;
    value_amount?: number | string | null;
    currency: string;
}

export interface BillOfLadingEntity extends BaseEntity {
    freight_file_id: string;
    type: 'MBL' | 'HBL';
    bl_number: string;
    issue_date?: Date | string | null;
    telex_release: boolean | number;
    original_received: boolean | number;
    released_at?: Date | string | null;
    shipping_instructions?: Record<string, unknown> | null;
    draft_approved: boolean | number;
}

export interface FileDocumentEntity extends BaseEntity {
    freight_file_id: string;
    doc_type: DocType | string;
    file_name: string;
    file_url?: string | null;
    storage_key?: string | null;
    integrity_hash?: string | null;
    mime_type?: string | null;
    file_size_bytes?: number | null;
    ocr_confidence?: number | string | null;
    ocr_extracted_data?: Record<string, unknown> | string | null;
}

export interface FileNoteEntity extends BaseEntity {
    freight_file_id: string;
    note_text: string;
    show_on_open: boolean | number;
}

export interface DrayageOrderEntity extends BaseEntity {
    freight_file_id: string;
    container_id?: string | null;
    order_number: string;
    trucking_order_id?: string | null;
    type: DrayageType | string;
    terminal_name: string;
    facility_address: string;
    pickup_address?: string | null;
    delivery_address?: string | null;
    planned_pickup_at?: Date | string | null;
    planned_delivery_at?: Date | string | null;
    actual_pickup_at?: Date | string | null;
    actual_delivery_at?: Date | string | null;
    trucking_company?: string | null;
    driver_name?: string | null;
    truck_plate?: string | null;
    chassis_number?: string | null;
    status: DrayageStatus | string;
    scheduled_at?: Date | string | null;
    gate_in_at?: Date | string | null;
    gate_out_at?: Date | string | null;
    delivered_at?: Date | string | null;
    pod_signature_ref?: string | null;
}

export interface T1BondedEventEntity extends BaseEntity {
    freight_file_id: string;
    event_type: T1EventType | string;
    mrn?: string | null;
    bonded_warehouse_ref?: string | null;
    document_id?: string | null;
    occurred_at: Date | string;
}

export interface MilestoneEntity extends BaseEntity {
    freight_file_id: string;
    milestone_type: MilestoneType | string;
    timestamp: Date | string;
    source: string;
}

export interface ExceptionCaseEntity extends BaseEntity {
    freight_file_id: string;
    gate_code?: string | null;
    type: string;
    severity: CaseSeverity | string;
    status: CaseStatus | string;
    title: string;
    description?: string | null;
    assignee_id?: string | null;
    resolution_notes?: string | null;
    resolved_by?: string | null;
    resolved_at?: Date | string | null;
}

export interface ChargeEntity extends BaseEntity {
    freight_file_id: string;
    line_type: ChargeLineType | string;
    service_name: string;
    amount: number | string;
    currency: string;
    invoice_ref?: string | null;
}

// Cross-Cutting Entities
export interface AuditLogEntity {
    id: string;
    workspace_id: string;
    actor_id: string;
    entity_type: string;
    entity_id: string;
    action: string;
    from_state?: string | null;
    to_state?: string | null;
    payload?: string | null;
    created_at: Date | string;
}

export interface OutboxEntity {
    id: string;
    workspace_id: string;
    event_id: string;
    event_type: string;
    payload: string;
    status: OutboxStatus | string;
    retry_count: number;
    error_message?: string | null;
    published_at?: Date | string | null;
    created_at: Date | string;
    updated_at: Date | string;
}

export interface ProcessedMessageEntity {
    id: string;
    workspace_id: string;
    message_id: string;
    event_type: string;
    processed_at: Date | string;
}

export interface DocumentRefEntity {
    id: string;
    workspace_id: string;
    storage_key: string;
    integrity_hash: string;
    file_name: string;
    mime_type?: string | null;
    file_size_bytes?: number | null;
    created_by: string;
    created_at: Date | string;
}

export interface TargetEntity extends BaseEntity {
    metric_name: string;
    target_value: number | string;
    effective_from: Date | string;
    effective_to?: Date | string | null;
}

export interface FreightMetricsResponse {
    // Legacy top-level aliases for test compatibility
    total_active: number;
    total_import: number;
    total_export: number;
    red_alerts: number;
    arrived_shipments: number;

    // Rich Dashboard KPI Tiles (per Implementation Guide)
    tiles: {
        open_files: number;
        awaiting_release: number;
        arriving_this_week: number;
        demurrage_at_risk: number;
        blocked_by_gate: number;
        open_exceptions: number;
    };
    breakdown: {
        by_direction: {
            import: number;
            export: number;
        };
        by_status: Record<string, number>;
        by_special_status: {
            green: number;
            orange: number;
            red: number;
        };
    };
    recent_alerts: Array<{
        id: string;
        file_id: string;
        file_no: string;
        gate_code?: string | null;
        title: string;
        severity: string;
        created_at: string;
    }>;
}
