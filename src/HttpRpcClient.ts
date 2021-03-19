import {
    BatchExecutor,
    Scene,
    ServiceProtocol,
    SimpleAtom,
    newSpan,
    reportEvent,
    Span,
} from '@rotcare/io';
import { decode, isJobError, JobResult } from './HttpRpc';

declare const fetch: any;

// 前端通过互联网以 http 协议调用 api gateway 后面的 serverless 函数
// 1. 需要把多个前端组件发的请求给聚合成一批 jobs 批量执行
// 2. 每个 job 只要处理完了，要立即返回给前端，而不是要等所有 jobs 都执行完才返回
export class HttpRpcClient implements ServiceProtocol {
    private readonly decode?: decode;
    constructor(options?: { decode?: decode }) {
        this.decode = options?.decode;
    }
    public async callService(scene: Scene, project: string, service: string, args: any[]) {
        let resolve: (result: any) => void;
        let reject: (reason: any) => void;
        const promise = new Promise((_resolve, _reject) => {
            resolve = _resolve;
            reject = _reject;
        });
        enqueue({
            decode: this.decode,
            scene,
            project,
            service,
            args,
            resolve: resolve!,
            reject: reject!,
        });
        return await promise;
    }
    public async onSceneFinished(scene: Scene) {}
}

interface RpcJob {
    decode?: decode;
    scene: Scene;
    project: string;
    service: string;
    args: string[];
    resolve: (result: any) => void;
    reject: (reason: any) => void;
}

// 仅把相同 project/service 的 job 聚合成一批发送
// 在 HTTP/2 的前提下,仅仅是为了减少 http roundtrip 而作的批量优化是不必要的
// 这里批量主要的目的是让服务端方便处理同一个 service 的多次调用
// 比如查询同一份数据, 不需要查两次了，查一次当两个结果返回就可以了
// 或者查 id=1 id=3 id=6 的数据，可以优化为 id IN [1,3,6]
const projects = new Map<string, Map<string, BatchExecutor<RpcJob>>>();

function enqueue(job: RpcJob) {
    let services = projects.get(job.project);
    if (!services) {
        projects.set(job.project, (services = new Map()));
    }
    let batchExecutor = services.get(job.service);
    if (!batchExecutor) {
        batchExecutor = new BatchExecutor<RpcJob>(
            32,
            batchExecute.bind(undefined, job.project, job.service),
        );
        services.set(job.service, batchExecutor);
    }
    batchExecutor.enqueue(job);
}

async function batchExecute(project: string, service: string, batch: RpcJob[]) {
    const spanJobs = new Map<Span, RpcJob[]>();
    for (const job of batch) {
        let jobs = spanJobs.get(job.scene.span);
        if (!jobs) {
            spanJobs.set(job.scene.span, (jobs = []));
        }
        jobs.push(job);
    }
    const promises = [];
    for (const [span, jobs] of spanJobs.entries()) {
        promises.push(batchExecuteSameSpanJobs(project, service, span, jobs));
    }
    await Promise.all(promises);
}

async function batchExecuteSameSpanJobs(
    project: string,
    service: string,
    parentSpan: Span,
    jobs: RpcJob[],
) {
    const span = newSpan(parentSpan);
    const headers: Record<string, string> = {
        'x-project': project,
        'x-b3-traceid': span.traceId,
        'x-b3-parentspanid': span.parentSpanId,
        'x-b3-spanid': span.spanId,
        'baggage-op': span.traceOp,
    };
    for (const [k, v] of Object.entries(span.baggage)) {
        headers[`baggage-${k}`] = v;
    }
    const { host, port } = Scene.serviceDiscover({ project, port: 3000 });
    const protocol = port === 443 ? 'https' : 'http';
    const url = `${protocol}://${host}:${port}/${service}`;
    // 不同的 service 对应到 api gateway 不同的 url，对应到 serverless 的不同 function
    const resp = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(jobs.map((job) => job.args)),
    });
    // TODO: 实用 body.getReader() 实现及时响应
    const lines = (await resp.text()).split('\n') as string[];
    for (const line of lines) {
        if (!line || !line.trim()) {
            continue;
        }
        let result: JobResult;
        try {
            result = JSON.parse(line) as JobResult;
        } catch (e) {
            reportEvent('found invalid response', { line, url });
            continue;
        }
        const job = jobs[result.index];
        if (!job) {
            reportEvent('referencing a non existing job', { line, url });
            continue;
        }
        if (isJobError(result)) {
            job.reject(new Error(result.error));
        } else {
            for (const tableName of result.read) {
                job.scene.onAtomRead(remoteTable(tableName));
            }
            for (const tableName of result.changed) {
                job.scene.onAtomChanged(remoteTable(tableName));
            }
            const data = job.decode ? job.decode(result.data) : result.data;
            job.resolve(data);
        }
    }
}

const remoteTables = new Map<string, RemoteTable>();

function remoteTable(tableName: string) {
    let atom = remoteTables.get(tableName);
    if (!atom) {
        remoteTables.set(tableName, (atom = new RemoteTable(tableName)));
    }
    return atom;
}

class RemoteTable extends SimpleAtom {
    constructor(public readonly tableName: string) {
        super();
    }
    public [Symbol.toStringTag]() {
        return `{RemoteTable ${this.tableName}}`;
    }
}
