import { describe, expect, it } from 'vitest';
import type { ContainerEntity, FreightFileEntity } from '../src/common/types.js';
import { evaluateSpecialHandlingDetails, specialHandlingGate } from '../src/modules/freight/gates/specialHandling.gate.js';
import { SeaExportStateMachine } from '../src/modules/freight/state-machine/export-state-machine.js';
import { SpecialHandlingEngine } from '../src/modules/freight/state-machine/special-handling.js';
import { specialStatus as migrationStatus } from '../src/db/migrations/20260924000001_special_handling_evidence.js';
import { CreateContainerSchema, SpecialHandlingOverrideSchema, UpdateContainerHandlingSchema, UpdateFreightFileSchema } from '../src/common/schemas.js';

function file(overrides: Partial<FreightFileEntity> = {}): FreightFileEntity {
    return { status: 'Draft', direction: 'export', special_handling: 'NONE', special_status: 'GREEN', ...overrides } as FreightFileEntity;
}

function container(overrides: Partial<ContainerEntity> = {}): ContainerEntity {
    return { container_number: 'MSCU1234567', type: '40HC', ...overrides } as ContainerEntity;
}

const completeDg = container({
    imdg_class: '3', un_number: 'UN1993', packing_group: 'II', proper_shipping_name: 'Flammable liquid',
    msds_attached: true, dg_declaration_attached: true, carrier_dg_accepted: true,
    dg_segregation_requirements: 'No additional segregation required',
});

describe('section 3 special handling', () => {
    it('checks every DG safety item; missing document or carrier acceptance is RED', () => {
        expect(evaluateSpecialHandlingDetails('IMDG', [completeDg]).status).toBe('GREEN');
        for (const incomplete of [
            { msds_attached: false }, { dg_declaration_attached: false },
            { carrier_dg_accepted: false }, { dg_segregation_requirements: null },
            { imdg_class: null }, { un_number: null }, { packing_group: null }, { proper_shipping_name: null },
        ]) {
            const result = evaluateSpecialHandlingDetails('IMDG', [{ ...completeDg, ...incomplete }]);
            expect(result.overlays.imdg.status).toBe('RED');
            expect(result.issues.length).toBeGreaterThan(0);
        }
    });

    it('requires reefer setpoint, PTI, and monitoring before loading', () => {
        const reefer = container({ type: '40RF', temperature_setpoint_c: -18, ventilation_cbm_hr: 0, humidity_percent: 65, pre_trip_inspection_passed: true, reefer_monitoring_confirmed: true });
        expect(evaluateSpecialHandlingDetails('REEFER', [reefer]).status).toBe('GREEN');
        for (const incomplete of [
            { temperature_setpoint_c: null }, { pre_trip_inspection_passed: false }, { reefer_monitoring_confirmed: false },
        ]) {
            const result = evaluateSpecialHandlingDetails('REEFER', [{ ...reefer, ...incomplete }]);
            expect(result.overlays.reefer.status).toBe('RED');
        }
        expect(() => SeaExportStateMachine.validateTransition(
            file({ status: 'VgmSiSubmitted', special_handling: 'REEFER' }), 'Loaded', [
                { ...reefer, pre_trip_inspection_passed: false },
            ]
        )).toThrowError(expect.objectContaining({ code: 'SPECIAL_HANDLING_GATE_FAILED' }));
    });

    it('evaluates DG, reefer, and OOG independently on mixed cargo', () => {
        const result = evaluateSpecialHandlingDetails('IMDG', [
            completeDg,
            container({ container_number: 'MSCU7654321', type: '20RF', temperature_setpoint_c: 2, ventilation_cbm_hr: 10, humidity_percent: 65, pre_trip_inspection_passed: true, reefer_monitoring_confirmed: true }),
            container({ container_number: 'MSCU9999999', is_oog: true }),
        ]);
        expect(result.overlays.imdg.status).toBe('GREEN');
        expect(result.overlays.reefer.status).toBe('GREEN');
        expect(result.overlays.oog.status).toBe('RED');
        expect(result.status).toBe('RED');
        expect(evaluateSpecialHandlingDetails('OOG', [container({ is_oog: true, oog_dimensions: 'L 13m x W 3m x H 4m' })]).status).toBe('GREEN');
    });

    it('uses ORANGE for reefer setting advisories without blocking the gate', () => {
        const reefer = container({ type: '40RF', temperature_setpoint_c: -18, pre_trip_inspection_passed: true, reefer_monitoring_confirmed: true });
        expect(evaluateSpecialHandlingDetails('REEFER', [reefer]).status).toBe('ORANGE');
        expect(specialHandlingGate(file({ special_handling: 'REEFER', special_status: 'ORANGE' }), { containers: [reefer] }).pass).toBe(true);
        expect(migrationStatus('REEFER', [reefer])).toBe('ORANGE');
        expect(migrationStatus('IMDG', [completeDg])).toBe('GREEN');
    });

    it('blocks booking on computed or stored RED', () => {
        expect(() => SeaExportStateMachine.validateTransition(file({ special_handling: 'IMDG' }), 'Booked', [])).toThrowError(
            expect.objectContaining({ code: 'SPECIAL_HANDLING_GATE_FAILED' })
        );
        expect(specialHandlingGate(file({ special_status: 'RED' }), { containers: [] }).pass).toBe(false);
        expect(() => SeaExportStateMachine.validateTransition(file({ special_status: 'RED' }), 'Booked', [])).toThrowError(
            expect.objectContaining({ code: 'SPECIAL_HANDLING_GATE_FAILED' })
        );
        expect(SeaExportStateMachine.validateTransition(file({ special_handling: 'IMDG' }), 'Booked', [completeDg]).toStatus).toBe('Booked');
        expect(SpecialHandlingEngine.evaluate('imdg', []).canProceedWithBooking).toBe(false);
    });

    it('does not accept hand-set colour or gate-in timestamp in ordinary writes', () => {
        expect(SpecialHandlingOverrideSchema.safeParse({ version: 1, special_handling: 'IMDG', special_status: 'GREEN' }).success).toBe(false);
        expect(UpdateContainerHandlingSchema.safeParse({ version: 1, gate_in_at: new Date().toISOString() }).success).toBe(false);
        expect(CreateContainerSchema.safeParse({ container_number: 'MSCU1234567', type: '40HC', gate_in_at: new Date().toISOString() }).success).toBe(false);
        expect(UpdateFreightFileSchema.safeParse({ version: 1, special_handling: 'NONE' }).success).toBe(false);
        expect(UpdateContainerHandlingSchema.parse({ version: 1, msds_attached: true })).toEqual({ version: 1, msds_attached: true });
    });
});
