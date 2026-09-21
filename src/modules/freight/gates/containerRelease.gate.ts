import { GateCode } from '../../../common/enums.js';
import type { FreightFileEntity } from '../../../common/types.js';
import type { GateContext, GateResult } from './gate.types.js';

export function containerReleaseGate(file: FreightFileEntity, _context?: GateContext): GateResult {
    if (file.container_release_received_at) {
        return {
            gate: GateCode.CONTAINER_RELEASE,
            pass: true,
            reason: null,
            details: {
                container_release_received_at: file.container_release_received_at,
            },
        };
    }

    return {
        gate: GateCode.CONTAINER_RELEASE,
        pass: false,
        reason: 'Container release not received from terminal / Portbase',
        details: { container_release_received_at: null },
    };
}
