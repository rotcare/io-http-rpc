import { HttpRpcServer } from "./HttpRpcServer";
import { Model } from '@rotcare/codegen';
import * as path from 'path';

export function generateHttpRpcServers(models: Model[]): Record<string, HttpRpcServer> {
    const lines = [`
    const httpRpcServers = {
        migrate: new Impl.HttpRpcServer({ func: require('@motherboard/migrate').migrate })
    };`];
    models.sort((a, b) => a.qualifiedName.localeCompare(b.qualifiedName));
    for (const model of models) {
        if (model.archetype !== 'ActiveRecord' && model.archetype !== 'Gateway') {
            continue;
        }
        const services = [
            ...model.staticProperties.map((p) => p.name),
            ...model.staticMethods.map((m) => m.name),
        ];
        for (const service of services) {
            const className = path.basename(model.qualifiedName);
            lines.push(
                [
                    `httpRpcServers.${service} = Impl.HttpRpcServer.create(`,
                    `() => import('@motherboard/${model.qualifiedName}'), `,
                    `'${className}', '${service}');`,
                ].join(''),
            );
        }
    }
    lines.push('return httpRpcServers;');
    return lines.join('\n') as any;
}