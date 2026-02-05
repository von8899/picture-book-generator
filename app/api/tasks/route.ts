import { NextRequest, NextResponse } from 'next/server';
import {
    createTask,
    getTask,
    getTasksByProject,
    TaskType
} from '@/lib/serverTaskQueue';

// 注册任务执行器（在服务端启动时注册）
import '@/lib/taskExecutors';

/**
 * POST /api/tasks - 创建新任务
 */
export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { type, projectId, payload } = body as {
            type: TaskType;
            projectId: string;
            payload: Record<string, unknown>;
        };

        if (!type || !projectId) {
            return NextResponse.json(
                { error: '缺少必要参数: type, projectId' },
                { status: 400 }
            );
        }

        // 创建任务（会自动开始执行）
        const task = createTask(type, projectId, payload);

        return NextResponse.json({
            taskId: task.id,
            status: task.status,
            message: '任务已创建',
        });

    } catch (error) {
        console.error('创建任务失败:', error);
        return NextResponse.json(
            { error: '创建任务失败' },
            { status: 500 }
        );
    }
}

/**
 * GET /api/tasks?projectId=xxx - 获取项目的所有任务
 */
export async function GET(req: NextRequest) {
    try {
        const { searchParams } = new URL(req.url);
        const projectId = searchParams.get('projectId');

        if (!projectId) {
            return NextResponse.json(
                { error: '缺少 projectId 参数' },
                { status: 400 }
            );
        }

        const tasks = getTasksByProject(projectId);

        return NextResponse.json({ tasks });

    } catch (error) {
        console.error('获取任务列表失败:', error);
        return NextResponse.json(
            { error: '获取任务列表失败' },
            { status: 500 }
        );
    }
}
