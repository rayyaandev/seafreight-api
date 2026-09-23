export const Mode = {
    SEA: 'sea',
    AIR: 'air',
} as const;
export type Mode = (typeof Mode)[keyof typeof Mode];

export const Direction = {
    IMPORT: 'import',
    EXPORT: 'export',
} as const;
export type Direction = (typeof Direction)[keyof typeof Direction];

export const SeaImportStatus = {
    DRAFT: 'Draft',
    RELEASE_PENDING: 'ReleasePending',
    IN_TRANSIT: 'InTransit',
    ARRIVED: 'Arrived',
    CLEARED: 'Cleared',
    DELIVERED: 'Delivered',
    CLOSED: 'Closed',
} as const;
export type SeaImportStatus = (typeof SeaImportStatus)[keyof typeof SeaImportStatus];

export const SeaExportStatus = {
    DRAFT: 'Draft',
    BOOKED: 'Booked',
    VGM_SI_SUBMITTED: 'VgmSiSubmitted',
    LOADED: 'Loaded',
    BL_ISSUED: 'BlIssued',
    CLOSED: 'Closed',
} as const;
export type SeaExportStatus = (typeof SeaExportStatus)[keyof typeof SeaExportStatus];

export type FreightStatus = SeaImportStatus | SeaExportStatus;

export const SpecialStatus = {
    GREEN: 'GREEN',
    ORANGE: 'ORANGE',
    RED: 'RED',
} as const;
export type SpecialStatus = (typeof SpecialStatus)[keyof typeof SpecialStatus];

export const SpecialType = {
    IMDG: 'IMDG',
    REEFER: 'REEFER',
    OOG: 'OOG',
    NONE: 'NONE',
} as const;
export type SpecialType = (typeof SpecialType)[keyof typeof SpecialType];

export const CaseStatus = {
    OPEN: 'Open',
    IN_PROGRESS: 'InProgress',
    RESOLVED: 'Resolved',
    CLOSED: 'Closed',
} as const;
export type CaseStatus = (typeof CaseStatus)[keyof typeof CaseStatus];

export const CaseSeverity = {
    INFO: 'info',
    WARN: 'warn',
    CRITICAL: 'critical',
} as const;
export type CaseSeverity = (typeof CaseSeverity)[keyof typeof CaseSeverity];

export const ContainerType = {
    C20DV: '20DV',
    C40DV: '40DV',
    C40HC: '40HC',
    C20RF: '20RF',
    C40RF: '40RF',
    FR: 'FR',
    OT: 'OT',
    LCL: 'LCL',
} as const;
export type ContainerType = (typeof ContainerType)[keyof typeof ContainerType];

export const GateCode = {
    VALIDATION: 'VALIDATION',
    BL_RELEASE: 'BL_RELEASE',
    CUSTOMS_RELEASE: 'CUSTOMS_RELEASE',
    CONTAINER_RELEASE: 'CONTAINER_RELEASE',
    VGM_CUTOFF: 'VGM_CUTOFF',
    SPECIAL_HANDLING: 'SPECIAL_HANDLING',
} as const;
export type GateCode = (typeof GateCode)[keyof typeof GateCode];

export const CustomsDeclarationStatus = {
    NONE: 'none',
    SUBMITTED: 'submitted',
    ACCEPTED: 'accepted',
    REJECTED: 'rejected',
    UNDER_CONTROL: 'under_control',
} as const;
export type CustomsDeclarationStatus = (typeof CustomsDeclarationStatus)[keyof typeof CustomsDeclarationStatus];

export const VgmMethod = {
    METHOD_1: 'method_1',
    METHOD_2: 'method_2',
} as const;
export type VgmMethod = (typeof VgmMethod)[keyof typeof VgmMethod];

export const PackingGroup = {
    I: 'I',
    II: 'II',
    III: 'III',
} as const;
export type PackingGroup = (typeof PackingGroup)[keyof typeof PackingGroup];

export const DocType = {
    MBL: 'mbl',
    HBL: 'hbl',
    BOOKING_CONFIRMATION: 'booking_confirmation',
    ARRIVAL_NOTICE: 'arrival_notice',
    COMMERCIAL_INVOICE: 'commercial_invoice',
    PACKING_LIST: 'packing_list',
    VGM_CERTIFICATE: 'vgm_certificate',
    DELIVERY_ORDER: 'delivery_order',
    T1_DOCUMENT: 't1_document',
    IMDG_DECLARATION: 'imdg_declaration',
    MSDS: 'msds',
    CUSTOMS_RELEASE_DOC: 'customs_release_doc',
    POD_RECEIPT: 'pod_receipt',
    FILE_COVER: 'file_cover',
    OTHER: 'other',
} as const;
export type DocType = (typeof DocType)[keyof typeof DocType];

export const DrayageType = {
    IMPORT_DELIVERY: 'import_delivery',
    EXPORT_POSITIONING: 'export_positioning',
    EMPTY_REPOSITION: 'empty_reposition',
} as const;
export type DrayageType = (typeof DrayageType)[keyof typeof DrayageType];

export const DrayageStatus = {
    DRAFT: 'draft',
    SCHEDULED: 'scheduled',
    EN_ROUTE: 'en_route',
    COLLECTED: 'collected',
    GATE_IN: 'gate_in',
    GATE_OUT: 'gate_out',
    DELIVERED: 'delivered',
    CANCELLED: 'cancelled',
} as const;
export type DrayageStatus = (typeof DrayageStatus)[keyof typeof DrayageStatus];

export const MilestoneType = {
    COLLECTED: 'collected',
    CUSTOMS_CLEARED: 'customs_cleared',
    SAILED: 'sailed',
    ARRIVED: 'arrived',
    DELIVERED: 'delivered',
} as const;
export type MilestoneType = (typeof MilestoneType)[keyof typeof MilestoneType];

export const T1EventType = {
    T1_OPEN: 't1_open',
    T1_CLOSE: 't1_close',
    INSLAG: 'inslag',
    UITSLAG: 'uitslag',
} as const;
export type T1EventType = (typeof T1EventType)[keyof typeof T1EventType];

export const ChargeLineType = {
    SELL: 'sell',
    BUY: 'buy',
} as const;
export type ChargeLineType = (typeof ChargeLineType)[keyof typeof ChargeLineType];

export const OutboxStatus = {
    PENDING: 'pending',
    PUBLISHED: 'published',
    FAILED: 'failed',
} as const;
export type OutboxStatus = (typeof OutboxStatus)[keyof typeof OutboxStatus];
