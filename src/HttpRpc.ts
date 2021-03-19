import { Scene } from "@rotcare/io";

export interface Job {
    index: number;
    args: any[];
    // 给 batchExecute 传返回值用
    result?: any;
};

export type JobBatch = { jobs: Job[], execute: (scene: Scene) => Promise<void> };
export type batchExecute = (jobs: Job[]) => JobBatch[];

export type JobResult = JobSuccess | JobError;

export function isJobError(jobResult: JobResult): jobResult is JobError {
    return !!(jobResult as any).error;
}

export interface JobSuccess {
    index: number;
    data: any;
    read: string[];
    changed: string[];
}

export interface JobError {
    index: number;
    error: any;
}

export type decode = (encoded: any) => any;