import { GateCode, CustomsDeclarationStatus } from '../../../common/enums.js';
import type { FreightFileEntity } from '../state-machine/types.js';
import type { GateContext, GateResult } from './gate.types.js';

export function customsReleaseGate(file: FreightFileEntity, _context?: GateContext): GateResult {
    if (file.declaration_status === CustomsDeclarationStatus.ACCEPTED) {
        return {
            gate: GateCode.CUSTOMS_RELEASE,
            pass: true,
            reason: null,
            details: {
                declaration_id: file.declaration_id,
                mrn: file.mrn,
                status: file.declaration_status,
            },
        };
    }

    return {
        gate: GateCode.CUSTOMS_RELEASE,
        pass: false,
        reason: `Customs declaration is '${file.declaration_status || 'none'}'; must be 'accepted' to pass customs release`,
        details: {
            current_status: file.declaration_status,
            declaration_id: file.declaration_id,
            mrn: file.mrn,
        },
    };
}
