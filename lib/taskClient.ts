/**
 * 服务端任务 API 客户端
 * 用于前端提交和轮询服务端任务
 */

export type ServerTaskType =
    | 'generate-script'
    | 'split-script'
    | 'generate-images'
    | 'generate-single-image';

export type ServerTaskStatus =
    | 'pending'
    | 'running'
    | 'completed'
    | 'failed'
    | 'cancelled';

export interface ServerTaskResponse {
    id: string;
    type: ServerTaskType;
    projectId: string;
    status: ServerTaskStatus;
    progress: number;
    progressText?: string;
    result?: unknown;
    error?: string;
    createdAt: number;
    startedAt?: number;
    completedAt?: number;
}

/**
 * 提交新任务
 */
export async function submitTask(
    type: ServerTaskType,
    projectId: string,
    payload: Record<string, unknown>
): Promise<{ taskId: string }> {
    const response = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, projectId, payload }),
    });

    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || '提交任务失败');
    }

    return response.json();
}

/**
 * 获取任务状态
 */
export async function getTaskStatus(taskId: string): Promise<ServerTaskResponse> {
    const response = await fetch(`/api/tasks/${taskId}`);

    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || '获取任务状态失败');
    }

    return response.json();
}

/**
 * 取消任务
 */
export async function cancelTask(taskId: string): Promise<void> {
    const response = await fetch(`/api/tasks/${taskId}`, {
        method: 'DELETE',
    });

    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || '取消任务失败');
    }
}

/**
 * 轮询任务直到完成
 */
export function pollTask(
    taskId: string,
    options: {
        interval?: number;          // 轮询间隔，默认 1000ms
        onProgress?: (task: ServerTaskResponse) => void;
        onComplete?: (task: ServerTaskResponse) => void;
        onError?: (error: Error) => void;
    } = {}
): { stop: () => void } {
    const { interval = 1000, onProgress, onComplete, onError } = options;
    let stopped = false;
    let timeoutId: NodeJS.Timeout | null = null;

    const poll = async () => {
        if (stopped) return;

        try {
            const task = await getTaskStatus(taskId);

            if (stopped) return;

            // 通知进度
            onProgress?.(task);

            // 检查是否完成
            if (task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled') {
                onComplete?.(task);
                return;
            }

            // 继续轮询
            timeoutId = setTimeout(poll, interval);

        } catch (error) {
            if (stopped) return;
            onError?.(error instanceof Error ? error : new Error(String(error)));
        }
    };

    // 开始轮询
    poll();

    // 返回停止函数
    return {
        stop: () => {
            stopped = true;
            if (timeoutId) {
                clearTimeout(timeoutId);
            }
        }
    };
}

/**
 * 使用 Promise 等待任务完成
 */
export function waitForTask(
    taskId: string,
    onProgress?: (task: ServerTaskResponse) => void
): Promise<ServerTaskResponse> {
    return new Promise((resolve, reject) => {
        pollTask(taskId, {
            interval: 1000,
            onProgress,
            onComplete: (task) => {
                if (task.status === 'completed') {
                    resolve(task);
                } else if (task.status === 'failed') {
                    reject(new Error(task.error || '任务执行失败'));
                } else if (task.status === 'cancelled') {
                    reject(new Error('任务已取消'));
                }
            },
            onError: reject,
        });
    });
}
