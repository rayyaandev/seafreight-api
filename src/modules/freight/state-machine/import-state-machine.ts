import { SeaImportStatus } from '../../../common/enums.js';
import { AppError } from '../../../utils/response.js';

export interface ImportTransitionResult {
    fromStatus: string;
    toStatus: string;
    actionTaken: string;
    eventsToPublish: string[];
    demurrageWarning?: boolean;
}

/**
 * Sea Import lifecycle state machine.
 *
 * Statuses match the SeaImportStatus enum (PascalCase) which is what the DB stores.
 * Gate enforcement is handled by the service layer using the gate evaluation engine
 * before calling validateTransition.
 */
export class SeaImportStateMachine {
    public static readonly ALLOWED_TRANSITIONS: Record<string, string[]> = {
        [SeaImportStatus.DRAFT]: [SeaImportStatus.RELEASE_PENDING, SeaImportStatus.IN_TRANSIT],
        [SeaImportStatus.RELEASE_PENDING]: [SeaImportStatus.IN_TRANSIT, SeaImportStatus.ARRIVED],
        [SeaImportStatus.IN_TRANSIT]: [SeaImportStatus.ARRIVED],
        [SeaImportStatus.ARRIVED]: [SeaImportStatus.CLEARED],
        [SeaImportStatus.CLEARED]: [SeaImportStatus.DELIVERED],
        [SeaImportStatus.DELIVERED]: [SeaImportStatus.CLOSED],
        [SeaImportStatus.CLOSED]: [],
    };

    /**
     * Validates whether a status transition is structurally allowed.
     * Does NOT enforce gates — the caller must run gate evaluation separately.
     */
    public static validateTransition(
        currentStatus: string,
        targetStatus: string
    ): ImportTransitionResult {
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

        if (targetStatus === SeaImportStatus.RELEASE_PENDING) {
            actionTaken = 'B/L release confirmed. File pending vessel arrival.';
        }

        if (targetStatus === SeaImportStatus.IN_TRANSIT) {
            actionTaken = 'Vessel departed. Cargo in transit.';
        }

        if (targetStatus === SeaImportStatus.ARRIVED) {
            eventsToPublish.push('freight.file.arrived');
            actionTaken = 'Vessel arrived recorded. Demurrage and free-time clock initiated.';
        }

        if (targetStatus === SeaImportStatus.CLEARED) {
            eventsToPublish.push('freight.file.cleared');
            actionTaken = 'Customs and terminal release verified. File cleared for drayage.';
        }

        if (targetStatus === SeaImportStatus.DELIVERED) {
            eventsToPublish.push('freight.file.delivered');
            actionTaken = 'Cargo delivered to consignee. POD captured.';
        }

        if (targetStatus === SeaImportStatus.CLOSED) {
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

    /**
     * Returns gates that must pass for a given target status.
     * Used by the service layer to selectively enforce gates.
     */
    public static requiredGatesForTransition(targetStatus: string): string[] {
        switch (targetStatus) {
            case SeaImportStatus.RELEASE_PENDING:
                return ['BL_RELEASE'];
            case SeaImportStatus.CLEARED:
                return ['BL_RELEASE', 'CUSTOMS_RELEASE', 'CONTAINER_RELEASE'];
            default:
                return [];
        }
    }
}
