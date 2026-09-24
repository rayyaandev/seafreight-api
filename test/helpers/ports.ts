import db from '../../src/db/connection.js';

export async function testPorts(): Promise<{ pol_id: string; pod_id: string }> {
    const [pol, pod] = await Promise.all([
        db('location').where({ un_locode: 'NLRTM' }).first(),
        db('location').where({ un_locode: 'CNSHA' }).first(),
    ]);
    if (!pol || !pod) throw new Error('Seeded test ports are missing');
    return { pol_id: pol.id, pod_id: pod.id };
}
