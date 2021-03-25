import { HttpRpcServer } from "./HttpRpcServer";
import { Model } from '@rotcare/codegen';

export function generateHttpRpcServers(models: Model[]): Record<string, HttpRpcServer> {
    const lines = [`
    const { HttpRpcServer } = require('@rotcare/io-http-rpc');
    const httpRpcServers = {
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
            const className = model.qualifiedName.substr(model.qualifiedName.lastIndexOf('/') + 1);
            lines.push(
                [
                    `httpRpcServers.${service} = HttpRpcServer.create(`,
                    `() => import('@motherboard/${model.qualifiedName}'), `,
                    `'${className}', '${service}');`,
                ].join(''),
            );
        }
    }
    lines.push('return httpRpcServers;');
    return lines.join('\n') as any;
}