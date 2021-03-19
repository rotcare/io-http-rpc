import * as http from 'http';
import { Scene, newTrace, reportEvent } from '@rotcare/io';
import { HttpRpcClient } from './HttpRpcClient';
import { strict } from 'assert';
import { HttpRpcServer } from './HttpRpcServer';
import fetch from 'node-fetch';
import { batchExecute, JobBatch } from './HttpRpc';

describe('HttpRpcServer', () => {
    let httpServer: http.Server;
    let oldOutput: any;
    before(() => {
        oldOutput = reportEvent.output;
        reportEvent.output = () => {};
        (global as any).fetch = fetch;
    });
    after(() => {
        reportEvent.output = oldOutput;
        (global as any).fetch = undefined;
    });
    afterEach(() => {
        httpServer.close();
    });
    it('成功执行', async () => {
        const rpcServer = new HttpRpcServer({
            func: () => {
                return 'hello';
            },
        } as any);
        httpServer = http
            .createServer(rpcServer.handle.bind(rpcServer, undefined as any))
            .listen(3000);
        const scene = new Scene(newTrace('test'), {
            database: undefined as any,
            serviceProtocol: new HttpRpcClient(),
        });
        const result = await scene.execute(undefined, async () => {
            return await (scene.useServices('localhost') as any).testMethod();
        });
        strict.equal(result, 'hello');
    });
    it('加载代码抛异常', async () => {
        const rpcServer = HttpRpcServer.create(
            async () => {
                throw new Error('wtf');
            },
            'TestServer',
            'testMethod',
        );
        httpServer = http
            .createServer(rpcServer.handle.bind(rpcServer, undefined as any))
            .listen(3000);
        const scene = new Scene(newTrace('test'), {
            database: undefined as any,
            serviceProtocol: new HttpRpcClient(),
        });
        const result = scene.execute(undefined, async () => {
            return await (scene.useServices('localhost') as any).testMethod();
        });
        await strict.rejects(result, (e: any) => {
            return e.message.includes('wtf');
        });
    });
    it('执行代码抛异常', async () => {
        const rpcServer = new HttpRpcServer({
            func: () => {
                throw new Error('wtf');
            },
        } as any);
        httpServer = http
            .createServer(rpcServer.handle.bind(rpcServer, undefined as any))
            .listen(3000);
        const scene = new Scene(newTrace('test'), {
            database: undefined as any,
            serviceProtocol: new HttpRpcClient(),
        });
        const result = scene.execute(undefined, async () => {
            return await (scene.useServices('localhost') as any).testMethod();
        });
        await strict.rejects(result, (e: any) => {
            return e.message.includes('wtf');
        });
    });
    it('批量执行', async () => {
        const batchExecute: batchExecute = (jobs) => {
            const batch: JobBatch = {
                jobs,
                async execute() {
                    for (const job of jobs) {
                        job.result = 'hello';
                    }
                },
            };
            return [batch];
        };
        const rpcServer = new HttpRpcServer({
            func: {
                batchExecute,
            },
        } as any);
        httpServer = http
            .createServer(rpcServer.handle.bind(rpcServer, undefined as any))
            .listen(3000);
        const scene = new Scene(newTrace('test'), {
            database: undefined as any,
            serviceProtocol: new HttpRpcClient(),
        });
        const result = await scene.execute(undefined, async () => {
            const gateway = scene.useServices('localhost') as any;
            const promises = [gateway.testMethod(), gateway.testMethod()];
            return await Promise.all(promises);
        });
        strict.deepEqual(result, ['hello', 'hello']);
    });
});
