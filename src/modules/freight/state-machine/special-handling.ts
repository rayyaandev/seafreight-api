import type {
    FreightContainerEntity,
    SpecialHandlingType,
    SpecialHandlingStatus,
} from './types.js';

export interface SpecialHandlingEvaluation {
    type: SpecialHandlingType;
    status: SpecialHandlingStatus;
    issues: string[];
    canProceedWithBooking: boolean;
    canProceedWithLoading: boolean;
}

export class SpecialHandlingEngine {
    public static evaluate(
        type: SpecialHandlingType,
        containers: FreightContainerEntity[]
    ): SpecialHandlingEvaluation {
        if (type === 'none' || containers.length === 0) {
            return {
                type: 'none',
                status: 'green',
                issues: [],
                canProceedWithBooking: true,
                canProceedWithLoading: true,
            };
        }

        const issues: string[] = [];
        let status: SpecialHandlingStatus = 'green';

        if (type === 'imdg') {
            for (const c of containers) {
                if (!c.imdg_class || !c.un_number) {
                    issues.push(`Container ${c.container_number}: Missing IMDG Class or UN Number.`);
                    status = 'red';
                }
                if (!c.msds_attached) {
                    issues.push(`Container ${c.container_number}: Material Safety Data Sheet (MSDS) is missing.`);
                    if (status !== 'red') status = 'orange';
                }
                if (!c.dg_declaration_attached) {
                    issues.push(`Container ${c.container_number}: Dangerous Goods (DG) Declaration not attached.`);
                    if (status !== 'red') status = 'orange';
                }
                if (!c.carrier_dg_accepted) {
                    issues.push(`Container ${c.container_number}: Carrier has not yet confirmed DG acceptance.`);
                    status = 'red';
                }
            }
        } else if (type === 'reefer') {
            for (const c of containers) {
                if (c.temperature_setpoint_c === null || c.temperature_setpoint_c === undefined) {
                    issues.push(`Container ${c.container_number}: Reefer temperature set-point is not configured.`);
                    status = 'red';
                }
                if (!c.pre_trip_inspection_passed) {
                    issues.push(`Container ${c.container_number}: Pre-trip inspection (PTI) has not passed.`);
                    if (status !== 'red') status = 'orange';
                }
            }
        } else if (type === 'oog') {
            for (const c of containers) {
                if (c.is_oog && !c.oog_dimensions) {
                    issues.push(`Container ${c.container_number}: Out-of-gauge dimensions are required.`);
                    status = 'orange';
                }
            }
        }

        return {
            type,
            status,
            issues,
            canProceedWithBooking: status !== 'red',
            canProceedWithLoading: status === 'green',
        };
    }
}
