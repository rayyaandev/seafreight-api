import { IntegrationService } from './integration.service.js';

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;

export function startIntegrationWorker(): void {
    if (timer) return;
    const poll = async () => {
        if (running) return;
        running = true;
        try { await IntegrationService.processPending(); }
        catch (error) { console.error('[IntegrationWorker]', error); }
        finally { running = false; }
    };
    timer = setInterval(() => { void poll(); }, 2000);
    void poll();
}

export function stopIntegrationWorker(): void {
    if (timer) clearInterval(timer);
    timer = null;
}
