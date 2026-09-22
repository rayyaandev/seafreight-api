import db from '../../db/connection.js';
import { AppError } from '../../utils/response.js';
import { ENTITY_TABLE_MAP, type MasterDataSearchParams } from './masterData.types.js';

export class MasterDataService {
    /**
     * Autocomplete typeahead search across master data tables.
     */
    public static async search(
        workspaceId: string,
        entityName: string,
        params: MasterDataSearchParams
    ) {
        const entityConfig = ENTITY_TABLE_MAP[entityName.toLowerCase()];
        if (!entityConfig) {
            const allowed = Object.keys(ENTITY_TABLE_MAP)
                .filter((k) => !k.endsWith('s')) // unique singular names
                .join(', ');
            throw new AppError(
                400,
                'INVALID_ENTITY',
                `Unknown master data entity '${entityName}'. Allowed entities: [${allowed}]`
            );
        }

        const limit = Math.min(Math.max(Number(params.limit) || 20, 1), 100);

        const query = db(entityConfig.table)
            .where('workspace_id', workspaceId)
            .limit(limit);

        // Optional filter for tables with a 'type' column (e.g. client, location)
        if (params.type) {
            query.andWhere('type', params.type);
        }

        // Substring search on specified fields
        if (params.q && params.q.trim().length > 0) {
            const searchTerm = `%${params.q.trim()}%`;
            query.andWhere((builder: any) => {
                for (let i = 0; i < entityConfig.searchFields.length; i++) {
                    const field = entityConfig.searchFields[i];
                    if (i === 0) {
                        builder.whereLike(field, searchTerm);
                    } else {
                        builder.orWhereLike(field, searchTerm);
                    }
                }
            });
        }

        return query;
    }
}
