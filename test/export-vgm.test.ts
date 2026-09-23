import { describe, expect, it } from 'vitest';
import type { ContainerEntity, FreightFileEntity } from '../src/common/types.js';
import { SeaExportStateMachine } from '../src/modules/freight/state-machine/export-state-machine.js';
import { vgmCutoffGate } from '../src/modules/freight/gates/vgmCutoff.gate.js';

const cutoff = '2026-09-23T12:00:00.000Z';

function file(status = 'Booked', vgmCutoff: string | null = cutoff): FreightFileEntity {
    return {
        status,
        direction: 'export',
        mode: 'sea',
        special_handling: 'NONE',
        special_status: 'GREEN',
        vgm_cutoff: vgmCutoff,
    } as FreightFileEntity;
}

function container(overrides: Partial<ContainerEntity> = {}): ContainerEntity {
    return {
        container_number: 'TEST1234567',
        type: '40HC',
        vgm_kg: 24000,
        vgm_submitted_at: '2026-09-23T11:00:00.000Z',
        ...overrides,
    } as ContainerEntity;
}

function expectGateFailure(action: () => unknown): void {
    expect(action).toThrowError(expect.objectContaining({ code: 'VGM_CUTOFF_GATE_FAILED' }));
}

describe('Sea export VGM / cut-off enforcement', () => {
    it('requires VgmSiSubmitted before Loaded', () => {
        expect(() => SeaExportStateMachine.validateTransition(file(), 'Loaded', [container()]))
            .toThrowError(expect.objectContaining({ code: 'INVALID_TRANSITION' }));
    });

    it('blocks VGM submission when the cut-off or containers are missing', () => {
        expectGateFailure(() => SeaExportStateMachine.validateTransition(file(), 'VgmSiSubmitted', []));
        expectGateFailure(() => SeaExportStateMachine.validateTransition(file('Booked', null), 'VgmSiSubmitted', [container()]));
    });

    it('blocks missing weight, missing submission time, and late submission', () => {
        expectGateFailure(() => SeaExportStateMachine.validateTransition(file(), 'VgmSiSubmitted', [container({ vgm_kg: null })]));
        expectGateFailure(() => SeaExportStateMachine.validateTransition(file(), 'VgmSiSubmitted', [container({ vgm_submitted_at: null })]));
        expectGateFailure(() => SeaExportStateMachine.validateTransition(file(), 'VgmSiSubmitted', [container({ vgm_submitted_at: '2026-09-23T12:01:00.000Z' })]));
    });

    it('applies the same gate at Loaded, even for an already-submitted file', () => {
        expectGateFailure(() => SeaExportStateMachine.validateTransition(file('VgmSiSubmitted'), 'Loaded', [container({ vgm_submitted_at: null })]));
        expectGateFailure(() => SeaExportStateMachine.validateTransition(file('VgmSiSubmitted'), 'Loaded', [container({ vgm_submitted_at: '2026-09-23T12:01:00.000Z' })]));
    });

    it('allows VGM submitted on time and loading after the cut-off has passed', () => {
        const containers = [container()];
        expect(vgmCutoffGate(file(), { containers }).pass).toBe(true);
        expect(SeaExportStateMachine.validateTransition(file(), 'VgmSiSubmitted', containers).toStatus)
            .toBe('VgmSiSubmitted');
        expect(SeaExportStateMachine.validateTransition(file('VgmSiSubmitted'), 'Loaded', containers).toStatus)
            .toBe('Loaded');
    });

    it('accepts a submission exactly at the cut-off', () => {
        expect(vgmCutoffGate(file(), { containers: [container({ vgm_submitted_at: cutoff })] }).pass)
            .toBe(true);
    });
});
