import { GateCode } from '../../../common/enums.js';
import type { FreightFileEntity } from '../../../common/types.js';
import type { GateContext, GateResult } from './gate.types.js';

export function vgmCutoffGate(file: FreightFileEntity, context?: GateContext): GateResult {
    const containers = context?.containers || [];

    if (!file.vgm_cutoff || Number.isNaN(new Date(file.vgm_cutoff).getTime())) {
        return {
            gate: GateCode.VGM_CUTOFF,
            pass: false,
            reason: 'A valid VGM cut-off deadline must be recorded before VGM submission',
            details: { vgm_cutoff: file.vgm_cutoff ?? null },
        };
    }

    if (containers.length === 0) {
        return {
            gate: GateCode.VGM_CUTOFF,
            pass: false,
            reason: 'No containers assigned to export file for VGM evaluation',
            details: { container_count: 0 },
        };
    }

    const unverifiedContainers = containers.filter((c) => !c.vgm_kg || !Number.isFinite(Number(c.vgm_kg)) || Number(c.vgm_kg) <= 0);
    if (unverifiedContainers.length > 0) {
        return {
            gate: GateCode.VGM_CUTOFF,
            pass: false,
            reason: `${unverifiedContainers.length} container(s) are missing valid VGM weights`,
            details: {
                unverified_containers: unverifiedContainers.map((c) => c.container_number),
            },
        };
    }

    const missingSubmissions = containers.filter((c) => !c.vgm_submitted_at || Number.isNaN(new Date(c.vgm_submitted_at).getTime()));
    if (missingSubmissions.length > 0) {
        return {
            gate: GateCode.VGM_CUTOFF,
            pass: false,
            reason: `${missingSubmissions.length} container(s) have no valid VGM submission timestamp`,
            details: { missing_submissions: missingSubmissions.map((c) => c.container_number) },
        };
    }

    const cutoffTime = new Date(file.vgm_cutoff).getTime();
    const overdueContainers = containers.filter((c) => new Date(c.vgm_submitted_at!).getTime() > cutoffTime);
    if (overdueContainers.length > 0) {
        return {
            gate: GateCode.VGM_CUTOFF,
            pass: false,
            reason: `${overdueContainers.length} container(s) submitted VGM after the VGM cut-off deadline`,
            details: {
                vgm_cutoff: file.vgm_cutoff,
                overdue_containers: overdueContainers.map((c) => c.container_number),
            },
        };
    }

    return {
        gate: GateCode.VGM_CUTOFF,
        pass: true,
        reason: null,
        details: { total_containers: containers.length },
    };
}
