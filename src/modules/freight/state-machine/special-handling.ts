import type { ContainerEntity } from '../../../common/types.js';
import { evaluateSpecialHandlingDetails } from '../gates/specialHandling.gate.js';
import type { FreightContainerEntity, SpecialHandlingType, SpecialHandlingStatus } from './types.js';

export interface SpecialHandlingEvaluation {
    type: SpecialHandlingType;
    status: SpecialHandlingStatus;
    issues: string[];
    canProceedWithBooking: boolean;
    canProceedWithLoading: boolean;
}

// Compatibility adapter for older callers; the active gate owns all checklist rules.
export class SpecialHandlingEngine {
    public static evaluate(type: SpecialHandlingType, containers: FreightContainerEntity[]): SpecialHandlingEvaluation {
        const adapted = containers.map((container) => ({
            ...container,
            type: container.container_type,
        })) as unknown as ContainerEntity[];
        const result = evaluateSpecialHandlingDetails(type.toUpperCase(), adapted);
        const status = result.status.toLowerCase() as SpecialHandlingStatus;
        return {
            type,
            status,
            issues: result.issues,
            canProceedWithBooking: status !== 'red',
            canProceedWithLoading: status !== 'red',
        };
    }
}
