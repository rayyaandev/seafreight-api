import type {
    FreightFileEntity,
    FreightContainerEntity,
    SeaExportStatus,
} from './types.js';
import { AppError } from '../../../utils/response.js';
import { SpecialHandlingEngine } from './special-handling.js';

export interface ExportTransitionResult {
    fromStatus: string;
    toStatus: SeaExportStatus;
    actionTaken: string;
    eventsToPublish: string[];
}

export class SeaExportStateMachine {
    public static readonly ALLOWED_TRANSITIONS: Record<SeaExportStatus, SeaExportStatus[]> = {
        draft: ['booked'],
        booked: ['vgm_si_submitted', 'loaded'],
        vgm_si_submitted: ['loaded'],
        loaded: ['bl_issued'],
        bl_issued: ['closed'],
        closed: [],
    };

    public static validateTransition(
        file: FreightFileEntity,
        targetStatus: SeaExportStatus,
        containers: FreightContainerEntity[]
    ): ExportTransitionResult {
        const currentStatus = file.status as SeaExportStatus;

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

        // Gate 1: Special Handling Evaluation (Blocks booking & loading if RED)
        const evaluation = SpecialHandlingEngine.evaluate(file.special_handling_type, containers);

        if (targetStatus === 'booked') {
            if (!evaluation.canProceedWithBooking) {
                throw new AppError(
                    422,
                    'SPECIAL_HANDLING_GATE_FAILED',
                    `Special Handling Gate Blocked: ${evaluation.issues.join('; ')}`
                );
            }
            eventsToPublish.push('freight.file.booked');
            actionTaken = 'Carrier booking confirmed and cut-off deadlines registered.';
        }

        // Gate 2: VGM / Cut-off & Loading Gate
        if (targetStatus === 'loaded') {
            // Must have containers
            if (containers.length === 0) {
                throw new AppError(422, 'CONTAINER_REQUIRED', 'Cannot load export file without container details.');
            }

            // Verify VGM for each container
            for (const c of containers) {
                if (!c.vgm_weight_kg || !c.vgm_submitted_at) {
                    throw new AppError(
                        422,
                        'VGM_REQUIRED',
                        `Container ${c.container_number} is missing Verified Gross Mass (VGM) submission.`
                    );
                }
            }

            // Check if VGM was submitted before cut-off
            if (file.vgm_cutoff_at) {
                const cutoff = new Date(file.vgm_cutoff_at).getTime();
                const now = Date.now();
                if (now > cutoff && !file.vgm_cutoff_gate_passed) {
                    throw new AppError(
                        422,
                        'VGM_CUTOFF_EXCEEDED',
                        'VGM Cut-off deadline has passed. Container cannot be loaded without cut-off exception authorization.'
                    );
                }
            }

            // Check special handling compliance
            if (!evaluation.canProceedWithLoading) {
                throw new AppError(
                    422,
                    'SPECIAL_HANDLING_GATE_FAILED',
                    `Cannot load containers on board: ${evaluation.issues.join('; ')}`
                );
            }

            eventsToPublish.push('freight.file.departed');
            actionTaken = 'Containers loaded on board and vessel departed.';
        }

        if (targetStatus === 'vgm_si_submitted') {
            eventsToPublish.push('freight.file.vgm_submitted');
            actionTaken = 'VGM and Shipping Instructions approved and submitted to carrier.';
        }

        if (targetStatus === 'bl_issued') {
            eventsToPublish.push('freight.file.bl_issued');
            actionTaken = 'Original / Sea Waybill issued and shared with shipper/agent.';
        }

        if (targetStatus === 'closed') {
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
