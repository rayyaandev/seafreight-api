import type { FreightFileEntity } from '../state-machine/types.js';
import type { GateContext, GateResult } from './gate.types.js';
import { validationGate } from './validation.gate.js';
import { blReleaseGate } from './blRelease.gate.js';
import { customsReleaseGate } from './customsRelease.gate.js';
import { containerReleaseGate } from './containerRelease.gate.js';
import { vgmCutoffGate } from './vgmCutoff.gate.js';
import { specialHandlingGate, evaluateSpecialHandlingDetails } from './specialHandling.gate.js';

export * from './gate.types.js';
export { validationGate } from './validation.gate.js';
export { blReleaseGate } from './blRelease.gate.js';
export { customsReleaseGate } from './customsRelease.gate.js';
export { containerReleaseGate } from './containerRelease.gate.js';
export { vgmCutoffGate } from './vgmCutoff.gate.js';
export { specialHandlingGate, evaluateSpecialHandlingDetails } from './specialHandling.gate.js';

export function evaluateAllGates(file: FreightFileEntity, context?: GateContext): {
    gates: GateResult[];
    allPassed: boolean;
    failedGates: GateResult[];
} {
    const gates: GateResult[] = [
        validationGate(file, context),
        blReleaseGate(file, context),
        customsReleaseGate(file, context),
        containerReleaseGate(file, context),
        vgmCutoffGate(file, context),
        specialHandlingGate(file, context),
    ];

    const failedGates = gates.filter((g) => !g.pass);

    return {
        gates,
        allPassed: failedGates.length === 0,
        failedGates,
    };
}
