export interface MasterDataSearchParams {
    q?: string;
    limit?: number;
    type?: string;
}

export interface EntityConfig {
    table: string;
    searchFields: string[];
}

export const ENTITY_TABLE_MAP: Record<string, EntityConfig> = {
    // Locations / Ports
    locations: { table: 'location', searchFields: ['un_locode', 'name', 'country_code'] },
    location: { table: 'location', searchFields: ['un_locode', 'name', 'country_code'] },
    ports: { table: 'location', searchFields: ['un_locode', 'name', 'country_code'] },
    port: { table: 'location', searchFields: ['un_locode', 'name', 'country_code'] },

    // Carriers
    carriers: { table: 'carrier', searchFields: ['name', 'scac_code', 'line_code'] },
    carrier: { table: 'carrier', searchFields: ['name', 'scac_code', 'line_code'] },

    // Clients / Customers / Shippers / Consignees
    clients: { table: 'client', searchFields: ['name', 'code'] },
    client: { table: 'client', searchFields: ['name', 'code'] },
    customers: { table: 'client', searchFields: ['name', 'code'] },
    customer: { table: 'client', searchFields: ['name', 'code'] },

    // Incoterms
    incoterms: { table: 'incoterm', searchFields: ['code', 'description'] },
    incoterm: { table: 'incoterm', searchFields: ['code', 'description'] },

    // Currencies
    currencies: { table: 'currency', searchFields: ['code', 'name'] },
    currency: { table: 'currency', searchFields: ['code', 'name'] },

    // Commodity Codes
    commodities: { table: 'commodity_code', searchFields: ['hs_code', 'description'] },
    commodity: { table: 'commodity_code', searchFields: ['hs_code', 'description'] },
    commodity_codes: { table: 'commodity_code', searchFields: ['hs_code', 'description'] },

    // Consignors, Consignees, Notify Parties
    consignors: { table: 'consignor', searchFields: ['name'] },
    consignor: { table: 'consignor', searchFields: ['name'] },
    consignees: { table: 'consignee', searchFields: ['name'] },
    consignee: { table: 'consignee', searchFields: ['name'] },
    notify_parties: { table: 'notify_party', searchFields: ['name'] },
    notify_party: { table: 'notify_party', searchFields: ['name'] },
};
