import { z } from 'zod';
import {
    Mode,
    Direction,
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
    ChargeLineType,
} from './enums.js';

// ----------------------------------------------------------------------------
// Auth Schemas
// ----------------------------------------------------------------------------
export const LoginRequestSchema = z.object({
    email: z.email(),
    password: z.string().min(6),
});

export const RefreshTokenRequestSchema = z.object({
    refresh_token: z.string().optional(),
});

// ----------------------------------------------------------------------------
// Freight File Query & Mutation Schemas
// ----------------------------------------------------------------------------
export const ListFreightFilesQuerySchema = z.object({
    mode: z.enum([Mode.SEA, Mode.AIR]).default(Mode.SEA),
    direction: z.enum([Direction.IMPORT, Direction.EXPORT]).optional(),
    status: z.string().optional(),
    customer_id: z.uuid().optional(),
    pol_id: z.string().optional(),
    pod_id: z.string().optional(),
    eta_from: z.iso.datetime().optional(),
    eta_to: z.iso.datetime().optional(),
    special_handling: z.enum([SpecialType.NONE, SpecialType.IMDG, SpecialType.REEFER, SpecialType.OOG]).optional(),
    special_status: z.enum([SpecialStatus.GREEN, SpecialStatus.ORANGE, SpecialStatus.RED]).optional(),
    overdue: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
    carrier_id: z.uuid().optional(),
    q: z.string().optional(),
    cursor: z.string().optional(),
    limit: z.coerce.number().min(1).max(100).default(20),
});

export const CreateFreightFileSchema = z.object({
    mode: z.enum([Mode.SEA, Mode.AIR]).default(Mode.SEA),
    direction: z.enum([Direction.IMPORT, Direction.EXPORT]),
    customer_id: z.uuid().nullish(),
    shipper_id: z.uuid().nullish(),
    consignee_id: z.uuid().nullish(),
    notify_party_id: z.uuid().nullish(),
    carrier_id: z.uuid().nullish(),
    pol_id: z.uuid().nullish(),
    pod_id: z.uuid().nullish(),
    incoterm_id: z.uuid().nullish(),
    vessel: z.string().max(120).nullish(),
    voyage: z.string().max(40).nullish(),
    etd: z.iso.datetime().nullish(),
    eta: z.iso.datetime().nullish(),
    ata: z.iso.datetime().nullish(),
    doc_cutoff: z.iso.datetime().nullish(),
    vgm_cutoff: z.iso.datetime().nullish(),
    gate_cutoff: z.iso.datetime().nullish(),
    special_handling: z.enum([SpecialType.NONE, SpecialType.IMDG, SpecialType.REEFER, SpecialType.OOG]).default(SpecialType.NONE),
    free_time_days: z.number().int().min(0).default(5),
    declaration_id: z.string().max(64).nullish(),
    declaration_status: z.enum([
        CustomsDeclarationStatus.NONE,
        CustomsDeclarationStatus.SUBMITTED,
        CustomsDeclarationStatus.ACCEPTED,
        CustomsDeclarationStatus.REJECTED,
        CustomsDeclarationStatus.UNDER_CONTROL,
    ]).default(CustomsDeclarationStatus.NONE),
    mrn: z.string().max(64).nullish(),
    lc_flag: z.boolean().default(false),
    total_cost: z.number().nullish(),
    currency: z.string().max(3).default('EUR'),
});

// Status is NOT editable via PATCH per PDF rules!
export const UpdateFreightFileSchema = CreateFreightFileSchema.partial().extend({
    version: z.number().int().positive({ message: 'Version is required for optimistic concurrency control' }),
});

export const TransitionActionSchema = z.object({
    version: z.number().int().positive({ message: 'Version is required for optimistic concurrency control' }),
    reason: z.string().optional(),
});

export const RecordAtaSchema = z.object({
    version: z.number().int().positive(),
    ata: z.iso.datetime().optional(),
});

export const SpecialHandlingOverrideSchema = z.object({
    version: z.number().int().positive().optional(),
    special_handling: z.enum([SpecialType.NONE, SpecialType.IMDG, SpecialType.REEFER, SpecialType.OOG]),
    special_status: z.enum([SpecialStatus.GREEN, SpecialStatus.ORANGE, SpecialStatus.RED]),
    reason: z.string().optional(),
});


// ----------------------------------------------------------------------------
// Child Entity Schemas
// ----------------------------------------------------------------------------

export const CreateContainerSchema = z.object({
    container_number: z.string().min(3).max(20),
    type: z.enum([
        ContainerType.C20DV,
        ContainerType.C40DV,
        ContainerType.C40HC,
        ContainerType.C20RF,
        ContainerType.C40RF,
        ContainerType.FR,
        ContainerType.OT,
        ContainerType.LCL,
    ]).or(z.string().min(2).max(10)),
    seal_number: z.string().max(50).nullish(),
    tare_weight_kg: z.number().nullish(),
    gross_weight_kg: z.number().nullish(),
    vgm_kg: z.number().nullish(),
    vgm_submitted_at: z.iso.datetime().nullish(),
    vgm_method: z.enum([VgmMethod.METHOD_1, VgmMethod.METHOD_2]).nullish(),
    gate_in_at: z.iso.datetime().nullish(),
    gate_out_at: z.iso.datetime().nullish(),
    temperature_setpoint_c: z.number().nullish(),
    ventilation_cbm_hr: z.number().nullish(),
    humidity_percent: z.number().nullish(),
    pre_trip_inspection_passed: z.boolean().default(false),
    imdg_class: z.string().max(10).nullish(),
    un_number: z.string().max(10).nullish(),
    packing_group: z.enum([PackingGroup.I, PackingGroup.II, PackingGroup.III]).nullish(),
    proper_shipping_name: z.string().max(255).nullish(),
    msds_attached: z.boolean().default(false),
    dg_declaration_attached: z.boolean().default(false),
    carrier_dg_accepted: z.boolean().default(false),
    is_oog: z.boolean().default(false),
    oog_dimensions: z.string().nullish(),
});

export const CreateFreightLineSchema = z.object({
    description: z.string().min(1).max(255),
    commodity_code: z.string().max(20).nullish(),
    quantity: z.number().positive(),
    packages: z.number().int().positive().nullish(),
    weight_kg: z.number().positive().nullish(),
    volume_cbm: z.number().positive().nullish(),
    value_amount: z.number().nonnegative().nullish(),
    currency: z.string().max(3).default('EUR'),
});

export const CreateBillOfLadingSchema = z.object({
    type: z.enum(['MBL', 'HBL']),
    bl_number: z.string().min(3).max(50),
    issue_date: z.iso.datetime().nullish(),
    telex_release: z.boolean().default(false),
    original_received: z.boolean().default(false),
    released_at: z.iso.datetime().nullish(),
    shipping_instructions: z.record(z.string(), z.unknown()).nullish(),
    draft_approved: z.boolean().default(false),
});

export const CreateFileDocumentSchema = z.object({
    doc_type: z.enum([
        DocType.MBL,
        DocType.HBL,
        DocType.BOOKING_CONFIRMATION,
        DocType.ARRIVAL_NOTICE,
        DocType.COMMERCIAL_INVOICE,
        DocType.PACKING_LIST,
        DocType.VGM_CERTIFICATE,
        DocType.DELIVERY_ORDER,
        DocType.T1_DOCUMENT,
        DocType.IMDG_DECLARATION,
        DocType.MSDS,
        DocType.CUSTOMS_RELEASE_DOC,
        DocType.POD_RECEIPT,
        DocType.FILE_COVER,
        DocType.OTHER,
    ]),
    file_name: z.string().min(1).max(255),
    file_url: z.url().nullish(),
    storage_key: z.string().max(255).nullish(),
    integrity_hash: z.string().max(64).nullish(),
    mime_type: z.string().max(100).nullish(),
    file_size_bytes: z.number().int().nonnegative().nullish(),
    ocr_confidence: z.number().min(0).max(1).nullish(),
    ocr_extracted_data: z.record(z.string(), z.unknown()).nullish(),
});

export const CreateFileNoteSchema = z.object({
    note_text: z.string().min(1),
    show_on_open: z.boolean().default(false),
});

export const CreateDrayageOrderSchema = z.object({
    container_id: z.uuid().nullish(),
    type: z.enum([DrayageType.IMPORT_DELIVERY, DrayageType.EXPORT_POSITIONING, DrayageType.EMPTY_REPOSITION]),
    terminal_name: z.string().min(2).max(100),
    facility_address: z.string().min(5).max(255),
    trucking_company: z.string().max(100).nullish(),
    driver_name: z.string().max(100).nullish(),
    truck_plate: z.string().max(20).nullish(),
    chassis_number: z.string().max(30).nullish(),
    scheduled_at: z.iso.datetime().nullish(),
});

export const CreateExceptionCaseSchema = z.object({
    gate_code: z.string().max(50).nullish(),
    type: z.string().min(2).max(50).optional(),
    severity: z.enum([CaseSeverity.INFO, CaseSeverity.WARN, CaseSeverity.CRITICAL]).default(CaseSeverity.WARN),
    title: z.string().min(3).max(255),
    description: z.string().nullish(),
    assignee_id: z.uuid().nullish(),
});

export const UpdateExceptionCaseSchema = z.object({
    status: z.enum([CaseStatus.OPEN, CaseStatus.IN_PROGRESS, CaseStatus.RESOLVED, CaseStatus.CLOSED]),
    resolution_notes: z.string().nullish(),
    assignee_id: z.uuid().nullish(),
});

export const CreateChargeSchema = z.object({
    line_type: z.enum([ChargeLineType.SELL, ChargeLineType.BUY]),
    service_name: z.string().min(2).max(100),
    amount: z.number().nonnegative(),
    currency: z.string().max(3).default('EUR'),
    invoice_ref: z.string().max(50).nullish(),
});

// Simulation Event Schema
export const SimulateEventSchema = z.object({
    event_type: z.string().min(3),
    payload: z.record(z.string(), z.unknown()),
});
