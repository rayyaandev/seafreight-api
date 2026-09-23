import { SeaExportStatus } from '../../../common/enums.js';
import type { FreightFileEntity, ContainerEntity } from '../../../common/types.js';
import { AppError } from '../../../utils/response.js';
import { specialHandlingGate } from '../gates/specialHandling.gate.js';
import { vgmCutoffGate } from '../gates/vgmCutoff.gate.js';

export interface ExportTransitionResult {
    fromStatus: string;
    toStatus: string;
    actionTaken: string;
    eventsToPublish: string[];
}

export class SeaExportStateMachine {
    public static readonly ALLOWED_TRANSITIONS: Record<string, string[]> = {
        [SeaExportStatus.DRAFT]: [SeaExportStatus.BOOKED],
        [SeaExportStatus.BOOKED]: [SeaExportStatus.VGM_SI_SUBMITTED],
        [SeaExportStatus.VGM_SI_SUBMITTED]: [SeaExportStatus.LOADED],
        [SeaExportStatus.LOADED]: [SeaExportStatus.BL_ISSUED],
        [SeaExportStatus.BL_ISSUED]: [SeaExportStatus.CLOSED],
        [SeaExportStatus.CLOSED]: [],
    };

    public static validateTransition(
        file: FreightFileEntity,
        targetStatus: string,
        containers: ContainerEntity[]
    ): ExportTransitionResult {
        const currentStatus = file.status;

        if (currentStatus === targetStatus) {
            throw new AppError(400, 'NOOP_TRANSITION', `File is already in status '${targetStatus}'`);
        }

        const allowedNext = this.ALLOWED_TRANSITIONS[currentStatus] || [];
        if (!allowedNext.includes(targetStatus)) {
            throw new AppError(
                400,
                'INVALID_TRANSITION',
                `Cannot transition Sea Export file from '${currentStatus}' to '${targetStatus}'. Allowed: [${allowedNext.join(', ')}]`
            );
        }

        const eventsToPublish: string[] = [];
        let actionTaken = `Transitioned from ${currentStatus} to ${targetStatus}`;

        const specialHandling = specialHandlingGate(file, { containers: containers as any });

        if ((targetStatus === SeaExportStatus.BOOKED || targetStatus === SeaExportStatus.LOADED) && !specialHandling.pass) {
            throw new AppError(
                422,
                'SPECIAL_HANDLING_GATE_FAILED',
                specialHandling.reason || 'Special handling gate blocked',
                undefined,
                specialHandling.details
            );
        }

        if (targetStatus === SeaExportStatus.VGM_SI_SUBMITTED || targetStatus === SeaExportStatus.LOADED) {
            const vgmGate = vgmCutoffGate(file, { containers });
            if (!vgmGate.pass) {
                throw new AppError(
                    422,
                    'VGM_CUTOFF_GATE_FAILED',
                    `VGM / cut-off gate blocked: ${vgmGate.reason}`,
                    undefined,
                    vgmGate.details
                );
            }
        }

        if (targetStatus === SeaExportStatus.BOOKED) {
            eventsToPublish.push('freight.file.booked');
            actionTaken = 'Carrier booking confirmed and cut-off deadlines registered.';
        }

        if (targetStatus === SeaExportStatus.LOADED) {
            eventsToPublish.push('freight.file.departed');
            actionTaken = 'Containers loaded on board and vessel departed.';
        }

        if (targetStatus === SeaExportStatus.VGM_SI_SUBMITTED) {
            eventsToPublish.push('freight.file.vgm_submitted');
            actionTaken = 'VGM and Shipping Instructions approved and submitted to carrier.';
        }

        if (targetStatus === SeaExportStatus.BL_ISSUED) {
            eventsToPublish.push('freight.file.bl_issued');
            actionTaken = 'Original / Sea Waybill issued and shared with shipper/agent.';
        }

        if (targetStatus === SeaExportStatus.CLOSED) {
            eventsToPublish.push('freight.file.closed');
            actionTaken = 'Sea export file closed and handed over to billing.';
        }

        return {
            fromStatus: currentStatus,
            toStatus: targetStatus,
            actionTaken,
            eventsToPublish,
        };
    }
}
