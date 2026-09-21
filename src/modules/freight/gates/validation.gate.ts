import { GateCode } from '../../../common/enums.js';
import type { FreightFileEntity } from '../../../common/types.js';
import type { GateContext, GateResult } from './gate.types.js';

export function validationGate(file: FreightFileEntity, context?: GateContext): GateResult {
    const missing: string[] = [];

    if (!file.file_no) missing.push('file_no');
    if (!file.mode) missing.push('mode');
    if (!file.direction) missing.push('direction');
    if (!file.pol_id) missing.push('pol_id');
    if (!file.pod_id) missing.push('pod_id');

    if (file.pol_id && file.pod_id && file.pol_id === file.pod_id) {
        return {
            gate: GateCode.VALIDATION,
            pass: false,
            reason: 'Port of Loading (POL) and Port of Discharge (POD) cannot be the same location',
            details: { pol_id: file.pol_id, pod_id: file.pod_id },
        };
    }

    if (missing.length > 0) {
        return {
            gate: GateCode.VALIDATION,
            pass: false,
            reason: `Missing mandatory file fields: ${missing.join(', ')}`,
            details: { missing_fields: missing },
        };
    }

    if (context?.lines && context.lines.length > 0) {
        const invalidLines = context.lines.filter((l) => Number(l.quantity) <= 0);
        if (invalidLines.length > 0) {
            return {
                gate: GateCode.VALIDATION,
                pass: false,
                reason: 'Cargo lines must have quantity greater than 0',
                details: { invalid_lines_count: invalidLines.length },
            };
        }
    }

    return {
        gate: GateCode.VALIDATION,
        pass: true,
        reason: null,
    };
}
