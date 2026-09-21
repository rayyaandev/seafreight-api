import type { GateCode } from '../../../common/enums.js';
import type {
    FreightFileEntity,
    FreightContainerEntity,
    BillOfLadingEntity,
    FreightLineEntity,
} from '../../../common/types.js';

export interface GateContext {
    containers?: FreightContainerEntity[];
    lines?: FreightLineEntity[];
    billsOfLading?: BillOfLadingEntity[];
}

export interface GateResult {
    gate: GateCode;
    pass: boolean;
    reason: string | null;
    details?: Record<string, unknown> | null;
}
