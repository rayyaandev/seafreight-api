export type Provider = 'portbase' | 'carrier' | 'terminal';
export type Operation = 'exa' | 'ima' | 'booking' | 'schedule' | 'shipping_instructions' | 'bl_request' | 'availability';

export interface AdapterRequest {
    file_id: string;
    file_no: string;
    direction: string;
    carrier_id?: string | null;
    vessel?: string | null;
    voyage?: string | null;
    etd?: string | Date | null;
    eta?: string | Date | null;
    pol_id?: string | null;
    pod_id?: string | null;
    declaration_id?: string | null;
    containers: Array<{ id: string; container_number: string; type: string }>;
    lines: Array<{ description: string; commodity_code?: string | null; quantity: number }>;
    shipping_instructions?: string;
}

export interface AdapterResult {
    reference: string;
    accepted_at: string;
    [key: string]: unknown;
}

export interface PortbaseAdapter {
    sendExa(request: AdapterRequest): Promise<AdapterResult>;
    sendIma(request: AdapterRequest): Promise<AdapterResult>;
}
export interface CarrierAdapter {
    requestBooking(request: AdapterRequest): Promise<AdapterResult>;
    getSchedule(request: AdapterRequest): Promise<AdapterResult>;
    sendShippingInstructions(request: AdapterRequest): Promise<AdapterResult>;
    requestBillOfLading(request: AdapterRequest): Promise<AdapterResult>;
}
export interface TerminalAdapter {
    getAvailability(request: AdapterRequest): Promise<AdapterResult>;
}

async function mockResult(prefix: string, request: AdapterRequest): Promise<AdapterResult> {
    const delay = Number(process.env.INTEGRATION_MOCK_DELAY_MS ?? '0');
    const failureRate = Number(process.env.INTEGRATION_MOCK_FAILURE_RATE ?? '0');
    if (!Number.isFinite(delay) || delay < 0 || delay > 30000 ||
        !Number.isFinite(failureRate) || failureRate < 0 || failureRate > 1) {
        throw new Error('Invalid integration mock delay or failure rate');
    }
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
    if (Math.random() < failureRate) throw new Error(`Mock ${prefix} provider unavailable`);
    const time = new Date().toISOString();
    const reference = `${prefix}-${request.file_no}`;
    if (prefix === 'BOOK') {
        const eta = request.eta ? new Date(request.eta) : new Date(Date.now() + 14 * 86400000);
        const etd = request.etd ? new Date(request.etd) : new Date(Date.now() + 7 * 86400000);
        return { reference, accepted_at: time, vessel: request.vessel || 'MOCK VESSEL',
            voyage: request.voyage || 'MOCK-001', etd: etd.toISOString(), eta: eta.toISOString(),
            doc_cutoff: new Date(etd.getTime() - 72 * 3600000).toISOString(),
            vgm_cutoff: new Date(etd.getTime() - 48 * 3600000).toISOString(),
            gate_cutoff: new Date(etd.getTime() - 24 * 3600000).toISOString() };
    }
    if (prefix === 'SCHEDULE') return { reference, accepted_at: time,
        vessel: request.vessel || 'MOCK VESSEL', voyage: request.voyage || 'MOCK-001',
        etd: request.etd || new Date(Date.now() + 7 * 86400000).toISOString(),
        eta: request.eta || new Date(Date.now() + 14 * 86400000).toISOString() };
    if (prefix === 'AVAIL') return { reference, accepted_at: time, available: true,
        containers: request.containers.map((c) => ({ container_number: c.container_number, available: true })) };
    return { reference, accepted_at: time };
}

export class MockPortbaseAdapter implements PortbaseAdapter {
    sendExa(request: AdapterRequest) { return mockResult('EXA', request); }
    sendIma(request: AdapterRequest) { return mockResult('IMA', request); }
}
export class MockCarrierAdapter implements CarrierAdapter {
    requestBooking(request: AdapterRequest) { return mockResult('BOOK', request); }
    getSchedule(request: AdapterRequest) { return mockResult('SCHEDULE', request); }
    sendShippingInstructions(request: AdapterRequest) { return mockResult('SI', request); }
    requestBillOfLading(request: AdapterRequest) { return mockResult('BL', request); }
}
export class MockTerminalAdapter implements TerminalAdapter {
    getAvailability(request: AdapterRequest) { return mockResult('AVAIL', request); }
}

// Vendor mapping, authentication, and transport are deliberately deferred until credentials exist.
class HttpStub {
    protected unavailable(provider: Provider): never {
        throw new Error(`${provider} HTTP adapter is not configured for a live vendor`);
    }
}
export class HttpPortbaseAdapter extends HttpStub implements PortbaseAdapter {
    async sendExa(_request: AdapterRequest): Promise<AdapterResult> { return this.unavailable('portbase'); }
    async sendIma(_request: AdapterRequest): Promise<AdapterResult> { return this.unavailable('portbase'); }
}
export class HttpCarrierAdapter extends HttpStub implements CarrierAdapter {
    async requestBooking(_request: AdapterRequest): Promise<AdapterResult> { return this.unavailable('carrier'); }
    async getSchedule(_request: AdapterRequest): Promise<AdapterResult> { return this.unavailable('carrier'); }
    async sendShippingInstructions(_request: AdapterRequest): Promise<AdapterResult> { return this.unavailable('carrier'); }
    async requestBillOfLading(_request: AdapterRequest): Promise<AdapterResult> { return this.unavailable('carrier'); }
}
export class HttpTerminalAdapter extends HttpStub implements TerminalAdapter {
    async getAvailability(_request: AdapterRequest): Promise<AdapterResult> { return this.unavailable('terminal'); }
}

function mode(provider: Provider): string {
    const choice = (process.env[`${provider.toUpperCase()}_ADAPTER`] || 'mock').toLowerCase();
    if (choice !== 'mock' && choice !== 'http') throw new Error(`Unknown ${provider} adapter: ${choice}`);
    return choice;
}
export function getPortbaseAdapter(): PortbaseAdapter {
    return mode('portbase') === 'mock' ? new MockPortbaseAdapter() : new HttpPortbaseAdapter();
}
export function getCarrierAdapter(): CarrierAdapter {
    return mode('carrier') === 'mock' ? new MockCarrierAdapter() : new HttpCarrierAdapter();
}
export function getTerminalAdapter(): TerminalAdapter {
    return mode('terminal') === 'mock' ? new MockTerminalAdapter() : new HttpTerminalAdapter();
}
