import * as http from 'http';
import { Scene, newTrace } from '@rotcare/io';
import { HttpRpcClient } from './HttpRpcClient';
import { strict } from 'assert';
import fetch from 'node-fetch';

describe('HttpRpcClient', () => {
    let server: http.Server;
    before(() => {
        (global as any).fetch = fetch;
    })
    afterEach(() => {
        server.close();
    });
    it('成功调用', async () => {
        let reqBody = '';
        let url = '';
        server = http
            .createServer(async (req, resp) => {
                req.on('data', (chunk) => {
                    reqBody += chunk;
                });
                req.on('end', () => {
                    url = req.url!;
                    resp.end(
                        JSON.stringify({ index: 0, data: 'hello', read: [], changed: [] }),
                    );
                });
            })
            .listen(3000);
        const scene = new Scene(newTrace('test'), {
            service: new HttpRpcClient(),
        });
        const result = await scene.execute(undefined, async () => {
            return await (scene.useService('localhost', 3000, 'default') as any).doSomething1();
        });
        strict.equal('/doSomething1', url);
        strict.deepEqual([[]], JSON.parse(reqBody));
        strict.equal('hello', result);
    });
    it('调用出错', async () => {
        let reqBody = '';
        let url = '';
        server = http
            .createServer(async (req, resp) => {
                req.on('data', (chunk) => {
                    reqBody += chunk;
                });
                req.on('end', () => {
                    url = req.url!;
                    resp.end(
                        JSON.stringify({ index: 0, error: 'wtf' }),
                    );
                });
            })
            .listen(3000);
        const scene = new Scene(newTrace('test'), {
            service: new HttpRpcClient(),
        });
        await strict.rejects(scene.execute(undefined, async () => {
            return await (scene.useService('localhost', 3000, 'default') as any).doSomething2();
        }), (e) => {
            return e.message === 'wtf';
        })
        strict.equal('/doSomething2', url);
        strict.deepEqual([[]], JSON.parse(reqBody));
    })
});
