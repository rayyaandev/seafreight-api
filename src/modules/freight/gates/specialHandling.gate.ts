import { GateCode, SpecialStatus, SpecialType } from '../../../common/enums.js';
import type { FreightFileEntity, FreightContainerEntity } from '../../../common/types.js';
import type { GateContext, GateResult } from './gate.types.js';

export interface SpecialHandlingEvaluation {
    status: SpecialStatus;
    issues: string[];
    details: {
        imdg: { total: number; compliant: number };
        reefer: { total: number; compliant: number };
        oog: { total: number };
    };
}

export function evaluateSpecialHandlingDetails(
    specialHandlingType: string | undefined,
    containers: FreightContainerEntity[]
): SpecialHandlingEvaluation {
    const issues: string[] = [];
    let status: SpecialStatus = SpecialStatus.GREEN;

    const imdgContainers = containers.filter((c) => Boolean(c.imdg_class) || Boolean(c.un_number));
    const reeferContainers = containers.filter((c) => c.type === '20RF' || c.type === '40RF' || (c.temperature_setpoint_c != null && c.temperature_setpoint_c !== ''));
    const oogContainers = containers.filter((c) => Boolean(c.is_oog));

    let imdgCompliant = 0;
    for (const c of imdgContainers) {
        const cIssues: string[] = [];
        if (!c.imdg_class) cIssues.push('missing IMDG class');
        if (!c.un_number) cIssues.push('missing UN number');
        if (!Boolean(c.carrier_dg_accepted)) cIssues.push('carrier DG approval pending');
        if (!Boolean(c.dg_declaration_attached)) cIssues.push('DG declaration missing');

        if (cIssues.length > 0) {
            issues.push(`Container ${c.container_number}: ${cIssues.join(', ')}`);
            if (!Boolean(c.carrier_dg_accepted) || !c.imdg_class) {
                status = SpecialStatus.RED;
            } else if (status !== SpecialStatus.RED) {
                status = SpecialStatus.ORANGE;
            }
        } else {
            imdgCompliant++;
        }
    }

    let reeferCompliant = 0;
    for (const c of reeferContainers) {
        const cIssues: string[] = [];
        if (c.temperature_setpoint_c === null || c.temperature_setpoint_c === undefined || c.temperature_setpoint_c === '') {
            cIssues.push('temperature setpoint not defined');
        }
        if (!Boolean(c.pre_trip_inspection_passed)) {
            cIssues.push('PTI (Pre-Trip Inspection) not passed');
        }

        if (cIssues.length > 0) {
            issues.push(`Reefer Container ${c.container_number}: ${cIssues.join(', ')}`);
            if (c.temperature_setpoint_c === null || c.temperature_setpoint_c === undefined) {
                status = SpecialStatus.RED;
            } else if (status !== SpecialStatus.RED) {
                status = SpecialStatus.ORANGE;
            }
        } else {
            reeferCompliant++;
        }
    }

    if (specialHandlingType === SpecialType.IMDG && imdgContainers.length === 0) {
        issues.push('Shipment flagged as IMDG but no IMDG containers attached');
        status = SpecialStatus.RED;
    }

    if (specialHandlingType === SpecialType.REEFER && reeferContainers.length === 0) {
        issues.push('Shipment flagged as REEFER but no Reefer containers attached');
        status = SpecialStatus.RED;
    }

    return {
        status,
        issues,
        details: {
            imdg: { total: imdgContainers.length, compliant: imdgCompliant },
            reefer: { total: reeferContainers.length, compliant: reeferCompliant },
            oog: { total: oogContainers.length },
        },
    };
}

export function specialHandlingGate(file: FreightFileEntity, context?: GateContext): GateResult {
    const containers = context?.containers || [];
    const evaluation = evaluateSpecialHandlingDetails(file.special_handling, containers);

    if (file.special_status === SpecialStatus.RED || evaluation.status === SpecialStatus.RED) {
        return {
            gate: GateCode.SPECIAL_HANDLING,
            pass: false,
            reason: `Special Handling checklist has RED status: ${evaluation.issues.join('; ')}`,
            details: {
                declared_special_handling: file.special_handling,
                special_status: SpecialStatus.RED,
                issues: evaluation.issues,
                breakdown: evaluation.details,
            },
        };
    }

    return {
        gate: GateCode.SPECIAL_HANDLING,
        pass: true,
        reason: null,
        details: {
            declared_special_handling: file.special_handling,
            special_status: evaluation.status,
            breakdown: evaluation.details,
        },
    };
}
