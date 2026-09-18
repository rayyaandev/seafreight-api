import type {
    FreightFileEntity,
    FreightContainerEntity,
    SeaImportStatus,
} from './types.js';
import { AppError } from '../../../utils/response.js';

export interface TransitionResult {
    fromStatus: string;
    toStatus: SeaImportStatus;
    actionTaken: string;
    eventsToPublish: string[];
    demurrageWarning?: boolean;
}

export class SeaImportStateMachine {
    public static readonly ALLOWED_TRANSITIONS: Record<SeaImportStatus, SeaImportStatus[]> = {
        draft: ['release_pending', 'in_transit'],
        release_pending: ['in_transit', 'arrived'],
        in_transit: ['arrived'],
        arrived: ['cleared'],
        cleared: ['delivered'],
        delivered: ['closed'],
        closed: [],
    };

    public static validateTransition(
        file: FreightFileEntity,
        targetStatus: SeaImportStatus,
        containers: FreightContainerEntity[]
    ): TransitionResult {
        const currentStatus = file.status as SeaImportStatus;

        if (currentStatus === targetStatus) {
            throw new AppError(400, 'NOOP_TRANSITION', `File is already in status '${targetStatus}'`);
        }

        const allowedNext = this.ALLOWED_TRANSITIONS[currentStatus] || [];
        if (!allowedNext.includes(targetStatus)) {
            throw new AppError(
                400,
                'INVALID_TRANSITION',
                `Cannot transition Sea Import file from '${currentStatus}' to '${targetStatus}'. Allowed: [${allowedNext.join(', ')}]`
            );
        }

        const eventsToPublish: string[] = [];
        let actionTaken = `Transitioned from ${currentStatus} to ${targetStatus}`;
        let demurrageWarning = false;

        // Gate 1: B/L Release Gate (Checking when moving to release_pending or issuing delivery order)
        if (targetStatus === 'release_pending' || targetStatus === 'cleared') {
            const blPassed = Boolean(file.bl_release_gate_passed);
            if (!blPassed) {
                throw new AppError(
                    422,
                    'BL_RELEASE_GATE_FAILED',
                    'B/L Release Gate Failed: Original/Telex B/L has not been surrendered or carrier charges have not been settled.'
                );
            }
        }

        // Gate 2: Customs Release & Portbase Container Release Gates
        if (targetStatus === 'cleared') {
            const customsPassed =
                Boolean(file.customs_release_gate_passed) || file.customs_declaration_status === 'accepted';
            if (!customsPassed) {
                throw new AppError(
                    422,
                    'CUSTOMS_RELEASE_GATE_FAILED',
                    'Customs Release Gate Failed: Declaration has not been accepted by Douane/Customs.'
                );
            }

            const containerPassed = Boolean(file.container_release_gate_passed);
            if (!containerPassed) {
                throw new AppError(
                    422,
                    'CONTAINER_RELEASE_GATE_FAILED',
                    'Container Release Gate Failed: Portbase container release has not been received from the terminal.'
                );
            }

            eventsToPublish.push('freight.file.cleared');
            actionTaken = 'Customs and terminal release verified. File cleared for drayage.';
        }

        // Gate 3: Demurrage / Arrival milestone
        if (targetStatus === 'arrived') {
            eventsToPublish.push('freight.file.arrived');
            actionTaken = 'Vessel arrived recorded. Demurrage and free-time clock initiated.';

            if (file.free_time_expires_at) {
                const freeTimeDate = new Date(file.free_time_expires_at).getTime();
                const now = Date.now();
                const hoursRemaining = (freeTimeDate - now) / (1000 * 60 * 60);
                if (hoursRemaining < 48) {
                    demurrageWarning = true;
                }
            }
        }

        if (targetStatus === 'delivered') {
            eventsToPublish.push('freight.file.delivered');
            actionTaken = 'Cargo delivered to consignee. POD captured.';
        }

        if (targetStatus === 'closed') {
            eventsToPublish.push('freight.file.closed');
            actionTaken = 'File cost captured and handed over to Finance/Invoicing.';
        }

        return {
            fromStatus: currentStatus,
            toStatus: targetStatus,
            actionTaken,
            eventsToPublish,
            demurrageWarning,
        };
    }
}
