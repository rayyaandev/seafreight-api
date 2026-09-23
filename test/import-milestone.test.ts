import { describe, expect, it } from 'vitest';
import { SeaImportStateMachine } from '../src/modules/freight/state-machine/import-state-machine.js';

describe('Sea import milestone timestamps', () => {
    it('blocks InTransit without valid ATD', () => {
        expect(() => SeaImportStateMachine.validateMilestoneTimestamp({ atd: null }, 'InTransit'))
            .toThrowError(/ATD/);
        expect(() => SeaImportStateMachine.validateMilestoneTimestamp({ atd: 'invalid' }, 'InTransit'))
            .toThrowError(/ATD/);
    });

    it('allows InTransit after ATD is recorded', () => {
        expect(() => SeaImportStateMachine.validateMilestoneTimestamp({ atd: '2026-09-23T10:00:00Z' }, 'InTransit'))
            .not.toThrow();
    });

    it('blocks Arrived without valid ATA', () => {
        expect(() => SeaImportStateMachine.validateMilestoneTimestamp({ ata: null }, 'Arrived'))
            .toThrowError(/ATA/);
        expect(() => SeaImportStateMachine.validateMilestoneTimestamp({ ata: 'invalid' }, 'Arrived'))
            .toThrowError(/ATA/);
    });

    it('allows Arrived when ATA is recorded', () => {
        expect(() => SeaImportStateMachine.validateMilestoneTimestamp({ ata: '2026-09-24T08:00:00Z' }, 'Arrived'))
            .not.toThrow();
    });
});
