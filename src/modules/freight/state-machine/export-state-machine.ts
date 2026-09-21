import { SeaExportStatus } from '../../../common/enums.js';
import type { FreightFileEntity, ContainerEntity } from '../../../common/types.js';
import { AppError } from '../../../utils/response.js';
import { evaluateSpecialHandlingDetails } from '../gates/specialHandling.gate.js';

export interface ExportTransitionResult {
    fromStatus: string;
    toStatus: string;
    actionTaken: string;
    eventsToPublish: string[];
}

export class SeaExportStateMachine {
    public static readonly ALLOWED_TRANSITIONS: Record<string, string[]> = {
        [SeaExportStatus.DRAFT]: [SeaExportStatus.BOOKED],
        [SeaExportStatus.BOOKED]: [SeaExportStatus.VGM_SI_SUBMITTED, SeaExportStatus.LOADED],
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

        // Special handling evaluation
        const specialHandling = evaluateSpecialHandlingDetails(file.special_handling, containers as any);

        if (targetStatus === SeaExportStatus.BOOKED) {
            if (specialHandling.status === 'RED') {
                throw new AppError(
                    422,
                    'SPECIAL_HANDLING_GATE_FAILED',
                    `Special Handling Gate Blocked: ${specialHandling.issues.join('; ')}`
                );
            }
            eventsToPublish.push('freight.file.booked');
            actionTaken = 'Carrier booking confirmed and cut-off deadlines registered.';
        }

        if (targetStatus === SeaExportStatus.LOADED) {
            if (containers.length === 0) {
                throw new AppError(422, 'CONTAINER_REQUIRED', 'Cannot load export file without container details.');
            }

            for (const c of containers) {
                if (!c.vgm_kg || !c.vgm_submitted_at) {
                    throw new AppError(
                        422,
                        'VGM_REQUIRED',
                        `Container ${c.container_number} is missing Verified Gross Mass (VGM) submission.`
                    );
                }
            }

            if (file.vgm_cutoff) {
                const cutoff = new Date(file.vgm_cutoff).getTime();
                const now = Date.now();
                if (now > cutoff) {
                    throw new AppError(
                        422,
                        'VGM_CUTOFF_EXCEEDED',
                        'VGM Cut-off deadline has passed. Container cannot be loaded without cut-off exception authorization.'
                    );
                }
            }

            if (specialHandling.status === 'RED') {
                throw new AppError(
                    422,
                    'SPECIAL_HANDLING_GATE_FAILED',
                    `Cannot load containers on board: ${specialHandling.issues.join('; ')}`
                );
            }

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
