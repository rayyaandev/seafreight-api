import { GateCode } from '../../../common/enums.js';
import type { FreightFileEntity } from '../state-machine/types.js';
import type { GateContext, GateResult } from './gate.types.js';

export function blReleaseGate(_file: FreightFileEntity, context?: GateContext): GateResult {
    const bills = context?.billsOfLading || [];

    if (bills.length === 0) {
        return {
            gate: GateCode.BL_RELEASE,
            pass: false,
            reason: 'No Bill of Lading records attached to freight file',
            details: { count: 0 },
        };
    }

    const releasedBl = bills.find((b) => b.telex_release === true || b.original_received === true || Boolean(b.released_at));

    if (!releasedBl) {
        return {
            gate: GateCode.BL_RELEASE,
            pass: false,
            reason: 'Bill of Lading has not been released (neither Telex Release nor Original Received)',
            details: {
                bills_checked: bills.map((b) => ({
                    bl_number: b.bl_number,
                    telex_release: b.telex_release,
                    original_received: b.original_received,
                })),
            },
        };
    }

    return {
        gate: GateCode.BL_RELEASE,
        pass: true,
        reason: null,
        details: { released_bl_number: releasedBl.bl_number },
    };
}
