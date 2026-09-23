import { GateCode, SpecialStatus, SpecialType } from '../../../common/enums.js';
import type { FreightFileEntity, FreightContainerEntity } from '../../../common/types.js';
import type { GateContext, GateResult } from './gate.types.js';

interface OverlayResult {
    status: SpecialStatus;
    issues: string[];
    total: number;
    compliant: number;
}

export interface SpecialHandlingEvaluation {
    status: SpecialStatus;
    issues: string[];
    overlays: {
        imdg: OverlayResult;
        reefer: OverlayResult;
        oog: OverlayResult;
    };
    details: {
        imdg: { total: number; compliant: number };
        reefer: { total: number; compliant: number };
        oog: { total: number; compliant: number };
    };
}

function checked(value: boolean | number | undefined): boolean {
    return value === true || value === 1;
}

function evaluateOverlay(
    containers: FreightContainerEntity[],
    declared: boolean,
    label: string,
    check: (container: FreightContainerEntity) => string[]
): OverlayResult {
    const issues: string[] = [];
    let compliant = 0;
    if (declared && containers.length === 0) {
        issues.push(`Shipment declared ${label} but no ${label} container is attached`);
    }
    for (const container of containers) {
        const missing = check(container);
        if (missing.length) {
            issues.push(`Container ${container.container_number}: ${missing.join(', ')}`);
        } else {
            compliant++;
        }
    }
    return {
        status: issues.length ? SpecialStatus.RED : SpecialStatus.GREEN,
        issues,
        total: containers.length,
        compliant,
    };
}

export function evaluateSpecialHandlingDetails(
    specialHandlingType: string | undefined,
    containers: FreightContainerEntity[]
): SpecialHandlingEvaluation {
    // Detect each overlay independently. A container may be DG and reefer at once.
    const imdgContainers = containers.filter((c) => Boolean(c.imdg_class || c.un_number || c.packing_group || c.proper_shipping_name || checked(c.msds_attached) || checked(c.dg_declaration_attached) || checked(c.carrier_dg_accepted)));
    const reeferContainers = containers.filter((c) => c.type === '20RF' || c.type === '40RF' || c.temperature_setpoint_c != null);
    const oogContainers = containers.filter((c) => checked(c.is_oog) || Boolean(c.oog_dimensions));

    const imdg = evaluateOverlay(imdgContainers, specialHandlingType === SpecialType.IMDG, 'IMDG', (c) => {
        const missing: string[] = [];
        if (!c.imdg_class) missing.push('IMDG class missing');
        if (!c.un_number) missing.push('UN number missing');
        if (!c.packing_group) missing.push('packing group missing');
        if (!c.proper_shipping_name) missing.push('proper shipping name missing');
        if (!checked(c.msds_attached)) missing.push('MSDS missing');
        if (!checked(c.dg_declaration_attached)) missing.push('DG declaration missing');
        if (!checked(c.carrier_dg_accepted)) missing.push('carrier DG acceptance missing or rejected');
        if (!c.dg_segregation_requirements?.trim()) missing.push('segregation requirements not confirmed');
        return missing;
    });
    const reefer = evaluateOverlay(reeferContainers, specialHandlingType === SpecialType.REEFER, 'reefer', (c) => {
        const missing: string[] = [];
        if (c.temperature_setpoint_c == null || c.temperature_setpoint_c === '') missing.push('temperature setpoint missing');
        if (!checked(c.pre_trip_inspection_passed)) missing.push('equipment PTI not confirmed');
        if (!checked(c.reefer_monitoring_confirmed)) missing.push('temperature monitoring not confirmed');
        return missing;
    });
    for (const c of reeferContainers) {
        const advisory: string[] = [];
        if (c.ventilation_cbm_hr == null) advisory.push('ventilation setting not recorded');
        if (c.humidity_percent == null) advisory.push('humidity setting not recorded');
        if (advisory.length) {
            reefer.issues.push(`Container ${c.container_number}: ${advisory.join(', ')} (advisory)`);
            if (reefer.status === SpecialStatus.GREEN) reefer.status = SpecialStatus.ORANGE;
        }
    }
    const oog = evaluateOverlay(oogContainers, specialHandlingType === SpecialType.OOG, 'OOG', (c) => {
        const missing: string[] = [];
        if (!checked(c.is_oog)) missing.push('OOG flag missing');
        if (!c.oog_dimensions?.trim()) missing.push('OOG dimensions missing');
        return missing;
    });

    const issues = [...imdg.issues, ...reefer.issues, ...oog.issues];
    return {
        status: [imdg, reefer, oog].some((overlay) => overlay.status === SpecialStatus.RED)
            ? SpecialStatus.RED
            : [imdg, reefer, oog].some((overlay) => overlay.status === SpecialStatus.ORANGE)
                ? SpecialStatus.ORANGE : SpecialStatus.GREEN,
        issues,
        overlays: { imdg, reefer, oog },
        details: {
            imdg: { total: imdg.total, compliant: imdg.compliant },
            reefer: { total: reefer.total, compliant: reefer.compliant },
            oog: { total: oog.total, compliant: oog.compliant },
        },
    };
}

export function specialHandlingGate(file: FreightFileEntity, context?: GateContext): GateResult {
    const evaluation = evaluateSpecialHandlingDetails(file.special_handling, context?.containers || []);
    const isRed = file.special_status === SpecialStatus.RED || evaluation.status === SpecialStatus.RED;
    return {
        gate: GateCode.SPECIAL_HANDLING,
        pass: !isRed,
        reason: isRed ? `Special handling RED: ${evaluation.issues.join('; ') || 'stored RED status requires review'}` : null,
        details: {
            declared_special_handling: file.special_handling,
            special_status: isRed ? SpecialStatus.RED : evaluation.status,
            issues: evaluation.issues,
            overlays: evaluation.overlays,
            breakdown: evaluation.details,
        },
    };
}
