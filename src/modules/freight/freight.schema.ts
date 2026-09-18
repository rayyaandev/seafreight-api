import { z } from 'zod';

export const ListFreightFilesQuerySchema = z.object({
    mode: z.enum(['sea', 'air']).default('sea'),
    direction: z.enum(['import', 'export']).optional(),
    status: z.string().optional(),
    special_handling_status: z.enum(['green', 'orange', 'red']).optional(),
    carrier_name: z.string().optional(),
    q: z.string().optional(),
    limit: z.coerce.number().min(1).max(100).default(20),
    cursor: z.string().optional(),
});

export const CreateFreightFileSchema = z.object({
    mode: z.enum(['sea', 'air']).default('sea'),
    direction: z.enum(['import', 'export']),
    shipper_name: z.string().max(255).optional(),
    consignee_name: z.string().max(255).optional(),
    notify_party_name: z.string().max(255).optional(),
    carrier_name: z.string().max(255).optional(),
    pol: z.string().max(10).optional(),
    pod: z.string().max(10).optional(),
    incoterm: z.string().max(10).optional(),
    vessel_name: z.string().max(120).optional(),
    voyage_number: z.string().max(40).optional(),
    eta: z.string().datetime().optional().nullable(),
    etd: z.string().datetime().optional().nullable(),
    vgm_cutoff_at: z.string().datetime().optional().nullable(),
    special_handling_type: z.enum(['none', 'imdg', 'reefer', 'oog']).default('none'),
    total_cost: z.number().optional().nullable(),
    currency: z.string().max(3).default('EUR'),
});

export const UpdateFreightFileSchema = CreateFreightFileSchema.partial().extend({
    version: z.number().int().positive(),
    bl_release_gate_passed: z.boolean().optional(),
    customs_release_gate_passed: z.boolean().optional(),
    container_release_gate_passed: z.boolean().optional(),
    vgm_cutoff_gate_passed: z.boolean().optional(),
    customs_declaration_id: z.string().max(64).optional().nullable(),
    customs_declaration_status: z.enum(['none', 'submitted', 'accepted', 'rejected', 'under_control']).optional(),
    free_time_expires_at: z.string().datetime().optional().nullable(),
});

export const TransitionStateSchema = z.object({
    target_status: z.string(),
    reason: z.string().optional(),
    version: z.number().int().positive(),
});

export const CreateContainerSchema = z.object({
    container_number: z.string().min(3).max(20),
    container_type: z.string().min(2).max(10), // e.g., 20GP, 40HC, 40RF
    seal_number: z.string().max(50).optional().nullable(),
    tare_weight_kg: z.number().optional().nullable(),
    cargo_weight_kg: z.number().optional().nullable(),
    vgm_weight_kg: z.number().optional().nullable(),
    vgm_method: z.enum(['method_1', 'method_2']).optional().nullable(),
    vgm_submitted_at: z.string().datetime().optional().nullable(),
    vgm_verified_by: z.string().max(100).optional().nullable(),
    temperature_setpoint_c: z.number().optional().nullable(),
    ventilation_cbm_hr: z.number().optional().nullable(),
    humidity_percent: z.number().optional().nullable(),
    pre_trip_inspection_passed: z.boolean().default(false),
    imdg_class: z.string().max(10).optional().nullable(),
    un_number: z.string().max(10).optional().nullable(),
    packing_group: z.enum(['I', 'II', 'III']).optional().nullable(),
    proper_shipping_name: z.string().max(255).optional().nullable(),
    msds_attached: z.boolean().default(false),
    dg_declaration_attached: z.boolean().default(false),
    carrier_dg_accepted: z.boolean().default(false),
    is_oog: z.boolean().default(false),
    oog_dimensions: z.string().optional().nullable(),
});

export const CreateDrayageOrderSchema = z.object({
    container_id: z.string().uuid().optional().nullable(),
    type: z.enum(['import_delivery', 'export_positioning', 'empty_reposition']),
    terminal_name: z.string().min(2).max(100),
    facility_address: z.string().min(5).max(255),
    trucking_company: z.string().max(100).optional().nullable(),
    driver_name: z.string().max(100).optional().nullable(),
    truck_plate: z.string().max(20).optional().nullable(),
    chassis_number: z.string().max(30).optional().nullable(),
    scheduled_at: z.string().datetime().optional().nullable(),
});

export const CreateExceptionCaseSchema = z.object({
    type: z.enum([
        'missing_bl',
        'carrier_hold',
        'demurrage_risk',
        'container_damage',
        'missed_cutoff',
        'vgm_discrepancy',
        'dg_non_acceptance',
        'customs_hold',
        'other',
    ]),
    severity: z.enum(['info', 'warn', 'critical']).default('warn'),
    title: z.string().min(3).max(255),
    description: z.string().optional().nullable(),
});
