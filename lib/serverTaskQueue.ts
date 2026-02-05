/**
 * 服务端任务队列管理器
 * 用于在后台执行长时间任务（脚本生成、图片生成等）
 */

export type TaskType =
    | 'generate-script'      // 脚本生成
    | 'split-script'         // 分镜拆分
    | 'generate-images'      // 批量图片生成
    | 'generate-single-image'; // 单张图片生成

export type TaskStatus =
    | 'pending'    // 等待执行
    | 'running'    // 正在执行
    | 'completed'  // 已完成
    | 'failed'     // 失败
    | 'cancelled'; // 已取消

export interface ServerTask {
    id: string;
    type: TaskType;
    projectId: string;
    status: TaskStatus;
    progress: number;        // 0-100
    progressText?: string;   // 进度描述文字
    payload: Record<string, unknown>;  // 任务参数
    result?: unknown;        // 任务结果
    error?: string;          // 错误信息
    createdAt: number;
    updatedAt: number;
    startedAt?: number;
    completedAt?: number;
}

// 内存存储任务（单例）
const taskStore = new Map<string, ServerTask>();

// 任务执行器注册表
type TaskExecutor = (task: ServerTask, updateProgress: (progress: number, text?: string) => void) => Promise<unknown>;
const executors = new Map<TaskType, TaskExecutor>();

/**
 * 生成唯一任务 ID
 */
export function generateTaskId(): string {
    return `task_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
}

/**
 * 创建新任务
 */
export function createTask(
    type: TaskType,
    projectId: string,
    payload: Record<string, unknown>
): ServerTask {
    const id = generateTaskId();
    const now = Date.now();

    const task: ServerTask = {
        id,
        type,
        projectId,
        status: 'pending',
        progress: 0,
        payload,
        createdAt: now,
        updatedAt: now,
    };

    taskStore.set(id, task);
    console.log(`[TaskQueue] 任务创建: ${id} (${type})`);

    // 立即开始执行任务
    executeTask(id);

    return task;
}

/**
 * 获取任务
 */
export function getTask(id: string): ServerTask | undefined {
    return taskStore.get(id);
}

/**
 * 获取项目的所有任务
 */
export function getTasksByProject(projectId: string): ServerTask[] {
    const tasks: ServerTask[] = [];
    taskStore.forEach(task => {
        if (task.projectId === projectId) {
            tasks.push(task);
        }
    });
    return tasks.sort((a, b) => b.createdAt - a.createdAt);
}

/**
 * 更新任务
 */
export function updateTask(id: string, updates: Partial<ServerTask>): ServerTask | undefined {
    const task = taskStore.get(id);
    if (!task) return undefined;

    const updatedTask = {
        ...task,
        ...updates,
        updatedAt: Date.now(),
    };

    taskStore.set(id, updatedTask);
    return updatedTask;
}

/**
 * 取消任务
 */
export function cancelTask(id: string): boolean {
    const task = taskStore.get(id);
    if (!task) return false;

    if (task.status === 'pending' || task.status === 'running') {
        updateTask(id, { status: 'cancelled' });
        console.log(`[TaskQueue] 任务取消: ${id}`);
        return true;
    }

    return false;
}

/**
 * 注册任务执行器
 */
export function registerExecutor(type: TaskType, executor: TaskExecutor): void {
    executors.set(type, executor);
    console.log(`[TaskQueue] 注册执行器: ${type}`);
}

/**
 * 执行任务（异步）
 */
async function executeTask(id: string): Promise<void> {
    const task = taskStore.get(id);
    if (!task) return;

    const executor = executors.get(task.type);
    if (!executor) {
        updateTask(id, {
            status: 'failed',
            error: `未找到任务执行器: ${task.type}`
        });
        console.error(`[TaskQueue] 未找到任务执行器: ${task.type}`);
        return;
    }

    // 更新状态为运行中
    updateTask(id, {
        status: 'running',
        startedAt: Date.now()
    });
    console.log(`[TaskQueue] 任务开始执行: ${id}`);

    // 进度更新回调
    const updateProgress = (progress: number, text?: string) => {
        const currentTask = taskStore.get(id);
        if (currentTask?.status === 'cancelled') {
            throw new Error('任务已取消');
        }
        updateTask(id, { progress, progressText: text });
    };

    try {
        // 执行任务
        const result = await executor(task, updateProgress);

        // 检查是否被取消
        const finalTask = taskStore.get(id);
        if (finalTask?.status === 'cancelled') {
            console.log(`[TaskQueue] 任务已取消: ${id}`);
            return;
        }

        // 更新为完成状态
        updateTask(id, {
            status: 'completed',
            progress: 100,
            result,
            completedAt: Date.now(),
        });
        console.log(`[TaskQueue] 任务完成: ${id}`);

    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);

        // 取消不算错误
        if (message === '任务已取消') {
            return;
        }

        updateTask(id, {
            status: 'failed',
            error: message,
            completedAt: Date.now(),
        });
        console.error(`[TaskQueue] 任务失败: ${id}`, message);
    }
}

/**
 * 清理过期任务（保留最近 1 小时的任务）
 */
export function cleanupOldTasks(): number {
    const oneHourAgo = Date.now() - 60 * 60 * 1000;
    let cleaned = 0;

    taskStore.forEach((task, id) => {
        if (task.completedAt && task.completedAt < oneHourAgo) {
            taskStore.delete(id);
            cleaned++;
        }
    });

    if (cleaned > 0) {
        console.log(`[TaskQueue] 清理 ${cleaned} 个过期任务`);
    }

    return cleaned;
}

// 每 10 分钟清理一次过期任务
setInterval(cleanupOldTasks, 10 * 60 * 1000);
