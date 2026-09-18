
/**
 * Validates ISO 6346 Container Number format (4 alpha characters + 7 digits)
 * E.g., MSKU9082341, MEDU1298471
 */
export function isValidContainerNumber(containerNumber: string): boolean {
    if (!containerNumber) return false;
    const clean = containerNumber.replace(/[\s-]/g, '').toUpperCase();
    const regex = /^[A-Z]{4}\d{7}$/;
    return regex.test(clean);
}

/**
 * Validates UN/LOCODE (5 characters, e.g. NLRTM, CNSHA, DEHAM)
 */
export function isValidUnLocode(code: string): boolean {
    if (!code) return false;
    return /^[A-Z]{2}[A-Z0-9]{3}$/.test(code.toUpperCase());
}

/**
 * Validates cross-field route consistency (Port of Loading != Port of Discharge)
 */
export function validateRouteConsistency(pol: string | null | undefined, pod: string | null | undefined): { valid: boolean; error?: string } {
    if (pol && pod && pol.trim().toUpperCase() === pod.trim().toUpperCase()) {
        return {
            valid: false,
            error: `Port of Loading (POL: ${pol}) cannot be identical to Port of Discharge (POD: ${pod}).`,
        };
    }
    return { valid: true };
}

/**
 * Validates weight relationships (Gross Weight >= Tare Weight + Cargo Weight)
 */
export function validateContainerWeights(
    tareWeightKg?: number | null,
    cargoWeightKg?: number | null,
    vgmKg?: number | null
): { valid: boolean; error?: string } {
    if (tareWeightKg && cargoWeightKg && vgmKg) {
        const expectedMin = tareWeightKg + cargoWeightKg;
        // Allow 5% variance due to dunnage / packing materials
        if (vgmKg < expectedMin * 0.95) {
            return {
                valid: false,
                error: `VGM Weight (${vgmKg} kg) is less than combined Tare (${tareWeightKg} kg) and Cargo (${cargoWeightKg} kg) weights.`,
            };
        }
    }
    return { valid: true };
}

/**
 * Validates cut-off schedule (Doc Cutoff <= VGM Cutoff <= Gate Cutoff <= ETD)
 */
export function validateCutoffSchedule(
    docCutoff?: Date | string | null,
    vgmCutoff?: Date | string | null,
    gateCutoff?: Date | string | null,
    etd?: Date | string | null
): { valid: boolean; error?: string } {
    const doc = docCutoff ? new Date(docCutoff).getTime() : null;
    const vgm = vgmCutoff ? new Date(vgmCutoff).getTime() : null;
    const gate = gateCutoff ? new Date(gateCutoff).getTime() : null;
    const dep = etd ? new Date(etd).getTime() : null;

    if (vgm && dep && vgm > dep) {
        return { valid: false, error: 'VGM Cut-off cannot occur after Estimated Departure (ETD).' };
    }
    if (gate && dep && gate > dep) {
        return { valid: false, error: 'Gate Cut-off cannot occur after Estimated Departure (ETD).' };
    }
    if (doc && vgm && doc > vgm) {
        return { valid: false, error: 'Document Cut-off cannot occur after VGM Cut-off.' };
    }

    return { valid: true };
}
