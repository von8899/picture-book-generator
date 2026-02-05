import { NextRequest, NextResponse } from 'next/server';
import { getTask, cancelTask } from '@/lib/serverTaskQueue';

interface RouteParams {
    params: Promise<{ id: string }>;
}

/**
 * GET /api/tasks/[id] - 获取任务状态
 */
export async function GET(req: NextRequest, { params }: RouteParams) {
    try {
        const { id } = await params;

        const task = getTask(id);

        if (!task) {
            return NextResponse.json(
                { error: '任务不存在' },
                { status: 404 }
            );
        }

        return NextResponse.json({
            id: task.id,
            type: task.type,
            projectId: task.projectId,
            status: task.status,
            progress: task.progress,
            progressText: task.progressText,
            result: task.result,
            error: task.error,
            createdAt: task.createdAt,
            startedAt: task.startedAt,
            completedAt: task.completedAt,
        });

    } catch (error) {
        console.error('获取任务状态失败:', error);
        return NextResponse.json(
            { error: '获取任务状态失败' },
            { status: 500 }
        );
    }
}

/**
 * DELETE /api/tasks/[id] - 取消任务
 */
export async function DELETE(req: NextRequest, { params }: RouteParams) {
    try {
        const { id } = await params;

        const success = cancelTask(id);

        if (!success) {
            return NextResponse.json(
                { error: '任务不存在或已完成' },
                { status: 400 }
            );
        }

        return NextResponse.json({
            message: '任务已取消',
        });

    } catch (error) {
        console.error('取消任务失败:', error);
        return NextResponse.json(
            { error: '取消任务失败' },
            { status: 500 }
        );
    }
}
