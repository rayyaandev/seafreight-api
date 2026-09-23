import type { OcrAdapter, OcrExtractOptions, OcrExtractionResult } from './ocr.types.js';
import { DocType } from '../../common/enums.js';

export class MockOcrAdapter implements OcrAdapter {
    constructor(private readonly simulatedDelayMs: number = 50) {}

    async extract(options: OcrExtractOptions): Promise<OcrExtractionResult> {
        const { fileName, docType } = options;

        if (this.simulatedDelayMs > 0) {
            await new Promise((resolve) => setTimeout(resolve, this.simulatedDelayMs));
        }

        // Check if filename contains a carrier container or B/L number pattern (e.g. MSCU1234567)
        const containerMatch = fileName.match(/[A-Z]{4}\d{7}/i);
        const blMatch = fileName.match(/(?:BL|BOL|MBL|HBL)[-_]?([A-Z0-9]{8,14})/i);
        const invMatch = fileName.match(/(?:INV|INVOICE)[-_]?([A-Z0-9]{4,12})/i);

        const extractedBl = blMatch ? blMatch[1] : (containerMatch ? `BL-${containerMatch[0]}` : 'MSCU98234190');
        const extractedContainer = containerMatch ? containerMatch[0].toUpperCase() : 'MSKU9082341';
        const invoiceToken = invMatch?.[1];
        const extractedInv = invoiceToken ? (invoiceToken.startsWith('INV') ? invoiceToken : `INV-${invoiceToken}`) : 'INV-2026-08912';

        switch (docType) {
            case DocType.MBL:
            case DocType.HBL:
                return {
                    doc_type: docType,
                    overall_confidence: 0.94,
                    extracted_fields: {
                        bl_number: { value: extractedBl, confidence: 0.98 },
                        carrier_name: { value: 'Mediterranean Shipping Company (MSC)', confidence: 0.96 },
                        vessel_name: { value: 'MSC ISABELLA', confidence: 0.95 },
                        voyage_number: { value: '2602E', confidence: 0.91 },
                        port_of_loading: { value: 'NLRTM', confidence: 0.93 },
                        port_of_discharge: { value: 'USNYC', confidence: 0.94 },
                        container_number: { value: extractedContainer, confidence: 0.89 },
                        seal_number: { value: 'MSK-781923', confidence: 0.68 }, // Flagged low-confidence for operator verification
                        tare_weight_kg: { value: 3820.0, confidence: 0.85 },
                        gross_weight_kg: { value: 24500.0, confidence: 0.92 },
                    },
                };

            case DocType.ARRIVAL_NOTICE:
                return {
                    doc_type: docType,
                    overall_confidence: 0.91,
                    extracted_fields: {
                        vessel_name: { value: 'MADRID MAERSK', confidence: 0.97 },
                        voyage_number: { value: '2601W', confidence: 0.94 },
                        actual_arrival_date: { value: new Date().toISOString().slice(0, 10), confidence: 0.92 },
                        terminal_name: { value: 'APM Terminals Maasvlakte II', confidence: 0.88 },
                        free_time_days: { value: 5, confidence: 0.95 },
                        container_number: { value: extractedContainer, confidence: 0.90 },
                        demurrage_daily_rate: { value: 140.0, confidence: 0.65 }, // Low confidence
                    },
                };

            case DocType.COMMERCIAL_INVOICE:
                return {
                    doc_type: docType,
                    overall_confidence: 0.93,
                    extracted_fields: {
                        invoice_number: { value: extractedInv, confidence: 0.99 },
                        seller_name: { value: 'Shanghai Tech Electronics Co. Ltd', confidence: 0.94 },
                        buyer_name: { value: 'Rotterdam Tech Logistics B.V.', confidence: 0.95 },
                        invoice_date: { value: new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString().slice(0, 10), confidence: 0.92 },
                        total_amount: { value: 84500.0, confidence: 0.96 },
                        currency: { value: 'EUR', confidence: 0.99 },
                        incoterm: { value: 'FOB', confidence: 0.89 },
                    },
                };

            case DocType.PACKING_LIST:
                return {
                    doc_type: docType,
                    overall_confidence: 0.89,
                    extracted_fields: {
                        total_packages: { value: 640, confidence: 0.94 },
                        package_type: { value: 'Cartons / Euro-pallets', confidence: 0.91 },
                        gross_weight_kg: { value: 18450.0, confidence: 0.93 },
                        net_weight_kg: { value: 16800.0, confidence: 0.72 }, // Flagged low-confidence
                        volume_cbm: { value: 52.4, confidence: 0.88 },
                    },
                };

            case DocType.IMDG_DECLARATION:
            case DocType.MSDS:
                return {
                    doc_type: docType,
                    overall_confidence: 0.92,
                    extracted_fields: {
                        un_number: { value: '1993', confidence: 0.97 },
                        hazard_class: { value: '3', confidence: 0.95 },
                        packing_group: { value: 'II', confidence: 0.92 },
                        proper_shipping_name: { value: 'FLAMMABLE LIQUID, N.O.S. (Ethanol solution)', confidence: 0.89 },
                        flashpoint_celsius: { value: 23.0, confidence: 0.65 }, // Low confidence
                    },
                };

            case DocType.T1_DOCUMENT:
                return {
                    doc_type: docType,
                    overall_confidence: 0.95,
                    extracted_fields: {
                        mrn: { value: '26NL89012389102381', confidence: 0.99 },
                        customs_office_departure: { value: 'NL000100 (Rotterdam Haven)', confidence: 0.94 },
                        customs_office_destination: { value: 'DE002100 (Duisburg)', confidence: 0.92 },
                        principal: { value: 'Rotterdam Bonded Logistics B.V.', confidence: 0.91 },
                    },
                };

            default:
                return {
                    doc_type: docType,
                    overall_confidence: 0.85,
                    extracted_fields: {
                        document_reference: { value: fileName.replace(/\.[^/.]+$/, ''), confidence: 0.88 },
                        parsed_date: { value: new Date().toISOString().slice(0, 10), confidence: 0.82 },
                    },
                };
        }
    }
}
