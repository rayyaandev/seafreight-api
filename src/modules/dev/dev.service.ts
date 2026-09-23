import { randomUUID } from 'crypto';
import db from '../../db/connection.js';
import { isConnected, publish } from '../../bus/rabbitmq.config.js';
import { handlerRegistry, type EventHandler } from '../../bus/handlers/index.js';
import type { EventEnvelope } from '../../common/events.js';
import { ConsumedEvents } from '../../common/events.js';
import { section4EventTypes } from '../../bus/handlers/section4.handler.js';
import { operationalEventTypes } from '../../bus/handlers/operational.handler.js';
import { AppError } from '../../utils/response.js';

export interface SimulateEventInput {
    event_type: string;
    payload: Record<string, unknown>;
    direct_dispatch?: boolean;
}

export interface SimulateEventResult {
    simulated: boolean;
    event_id: string;
    event_type: string;
    occurred_at: string;
    dispatched_via: 'rabbitmq' | 'direct_handler';
}

export interface EventTemplate {
    event_type: string;
    description: string;
    sample_payload: Record<string, unknown>;
}

export class DevService {
    /**
     * Finds a registered handler or wildcard match.
     */
    private static findHandler(eventType: string): EventHandler | null {
        if (handlerRegistry.has(eventType)) {
            return handlerRegistry.get(eventType)!;
        }

        for (const [pattern, handler] of handlerRegistry.entries()) {
            if (pattern.includes('*')) {
                const regex = new RegExp('^' + pattern.replace(/\./g, '\\.').replace(/\*/g, '[^.]+') + '$');
                if (regex.test(eventType)) {
                    return handler;
                }
            }
        }

        return null;
    }

    /**
     * Publishes a simulated event to RabbitMQ topic exchange,
     * or dispatches directly to the registered consumer handler.
     */
    static async simulateEvent(
        input: SimulateEventInput,
        context: { user_id?: string; workspace_id?: string }
    ): Promise<SimulateEventResult> {
        const { event_type, payload, direct_dispatch = false } = input;
        const workspaceId = context.workspace_id || '00000000-0000-0000-0000-000000000001';
        const actorId = context.user_id || 'system';

        const envelope: EventEnvelope = {
            id: randomUUID(),
            type: event_type,
            occurred_at: new Date().toISOString(),
            workspace_id: workspaceId,
            actor: actorId,
            version: 1,
            payload,
        };

        const useRabbitMQ = isConnected() && !direct_dispatch;

        if (useRabbitMQ) {
            const published = await publish(event_type, envelope as unknown as Record<string, unknown>);
            if (!published) {
                throw new AppError(500, 'PUBLISH_FAILED', `Failed to publish event '${event_type}' to RabbitMQ exchange`);
            }

            return {
                simulated: true,
                event_id: envelope.id,
                event_type: envelope.type,
                occurred_at: envelope.occurred_at,
                dispatched_via: 'rabbitmq',
            };
        }

        // Direct in-process dispatch (for tests or local dev without active RabbitMQ broker)
        const handler = this.findHandler(event_type);
        if (!handler) {
            throw new AppError(400, 'UNSUPPORTED_EVENT_TYPE', `No handler registered for simulated event type '${event_type}'`);
        }

        // Check deduplication / processed_message table
        if (section4EventTypes.has(event_type) || operationalEventTypes.has(event_type)) {
            await handler(envelope);
            return { simulated: true, event_id: envelope.id, event_type: envelope.type,
                occurred_at: envelope.occurred_at, dispatched_via: 'direct_handler' };
        }
        const existing = await db('processed_message').where('message_id', envelope.id).first();
        if (!existing) {
            await handler(envelope);

            await db('processed_message').insert({
                id: randomUUID(),
                workspace_id: workspaceId,
                message_id: envelope.id,
                event_type: envelope.type,
                processed_at: db.fn.now(),
            });
        }

        return {
            simulated: true,
            event_id: envelope.id,
            event_type: envelope.type,
            occurred_at: envelope.occurred_at,
            dispatched_via: 'direct_handler',
        };
    }

    /**
     * Returns curated event templates with realistic payloads for dev testing.
     */
    static getEventTemplates(): EventTemplate[] {
        return [
            {
                event_type: ConsumedEvents.DECLARATION_ACCEPTED,
                description: 'Customs declaration accepted. Sets declaration_status=accepted and advances to Cleared if container release is present.',
                sample_payload: {
                    file_id: '11111111-1111-1111-1111-111111111111',
                    declaration_id: 'DEC-2026-001',
                    mrn: '26NL00000000001234',
                    accepted_at: new Date().toISOString(),
                },
            },
            {
                event_type: ConsumedEvents.DECLARATION_REJECTED,
                description: 'Customs declaration rejected. Updates status to rejected and opens a case.',
                sample_payload: {
                    file_id: '11111111-1111-1111-1111-111111111111',
                    declaration_id: 'DEC-2026-002',
                    mrn: '26NL00000000001235',
                    rejection_reason: 'Discrepancy in declared tariff code and commercial invoice value',
                },
            },
            {
                event_type: ConsumedEvents.DECLARATION_UNDER_CONTROL,
                description: 'Customs declaration flagged for physical/documentary inspection.',
                sample_payload: {
                    file_id: '11111111-1111-1111-1111-111111111111',
                    declaration_id: 'DEC-2026-003',
                    mrn: '26NL00000000001236',
                    rejection_reason: 'Selected for customs physical examination at port terminal',
                },
            },
            {
                event_type: ConsumedEvents.SALES_QUOTE_WON,
                description: 'Sales quotation accepted. Automatically creates a new export Sea Freight file in Draft.',
                sample_payload: {
                    quote_id: 'Q-88219',
                    customer_name: 'Heineken Supply Chain B.V.',
                    pol: 'NLRTM',
                    pod: 'USNYC',
                    cargo_description: 'Bottled Lager Beer in Euro-pallets',
                    container_type: '40HC',
                    agreed_rate: 3450.0,
                    currency: 'EUR',
                },
            },
            {
                event_type: ConsumedEvents.DOCUMENT_OCR_COMPLETED,
                description: 'OCR processing completed. Attaches extracted fields and confidence scores to file document.',
                sample_payload: {
                    document_id: '44444444-4444-4444-4444-444444444444',
                    file_id: '11111111-1111-1111-1111-111111111111',
                    doc_type: 'mbl',
                    confidence: 0.94,
                    extracted_fields: {
                        bl_number: { value: 'MSCU12345678', confidence: 0.99 },
                        vessel_name: { value: 'MSC ISABELLA', confidence: 0.95 },
                        pol: { value: 'NLRTM', confidence: 0.92 },
                    },
                },
            },
            {
                event_type: ConsumedEvents.TRUCKING_STATUS_UPDATED,
                description: 'Carrier transport status updated on linked drayage order.',
                sample_payload: {
                    drayage_order_id: '55555555-5555-5555-5555-555555555555',
                    status: 'gate_in',
                    driver_name: 'Jan de Vries',
                    license_plate: '12-BXZ-4',
                },
            },
            {
                event_type: ConsumedEvents.TRUCKING_ORDER_LINKED,
                description: 'Trucking module links an outbound drayage request to its order ID.',
                sample_payload: {
                    drayage_order_id: '55555555-5555-5555-5555-555555555555',
                    trucking_order_id: 'TRUCK-2026-001',
                    status: 'scheduled',
                },
            },
            {
                event_type: ConsumedEvents.WMS_EVENT,
                description: 'Bonded warehouse event (T1 Inslag / Uitslag).',
                sample_payload: {
                    file_id: '11111111-1111-1111-1111-111111111111',
                    event_type: 'inslag',
                    warehouse_code: 'WMS-RTM-01',
                    reference_number: 'T1-998821',
                },
            },
            {
                event_type: 'masterdata.ports.updated',
                description: 'Master data entity change notification.',
                sample_payload: {
                    entity: 'location',
                    code: 'NLRTM',
                    name: 'Port of Rotterdam',
                },
            },
        ];
    }
}
