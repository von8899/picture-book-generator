"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTaskStore, Task, TaskData, TaskStatus, createEmptyTaskData } from "@/lib/taskStore";
import { useRouter, useSearchParams } from "next/navigation";

/**
 * 任务队列操作 Hook
 * 封装任务的注册、更新、切换等操作
 * @param externalTaskId - 可选的外部任务 ID（当 URL 没有 id 参数时使用）
 */
export function useTaskQueue(externalTaskId?: string) {
    const router = useRouter();
    const searchParams = useSearchParams();
    const urlProjectId = searchParams.get("id");

    // 使用 URL 参数或外部传入的 ID
    const [taskId, setTaskId] = useState<string | null>(urlProjectId || externalTaskId || null);
    const lastSavedDataRef = useRef<string>("");

    // 当 URL 参数或外部 ID 变化时更新
    useEffect(() => {
        if (urlProjectId) {
            setTaskId(urlProjectId);
        } else if (externalTaskId) {
            setTaskId(externalTaskId);
        }
    }, [urlProjectId, externalTaskId]);

    const {
        tasks,
        activeTaskId,
        addTask,
        updateTask,
        removeTask,
        setActiveTask,
        autoSaveAndSwitch,
        getTaskById,
    } = useTaskStore();

    // 当前任务
    const currentTask = taskId ? getTaskById(taskId) : undefined;

    // 设置任务 ID（用于新建项目时）
    const setCurrentTaskId = useCallback((id: string) => {
        setTaskId(id);
    }, []);

    // 注册新任务到队列
    const registerTask = useCallback((id: string, taskData: Partial<Task>) => {
        setTaskId(id);

        const existingTask = getTaskById(id);
        if (existingTask) {
            updateTask(id, taskData);
        } else {
            const newTask: Task = {
                id: id,
                title: taskData.title || '未命名任务',
                status: 'draft',
                progress: 0,
                currentStep: 1,
                totalSteps: 4,
                lastModified: Date.now(),
                data: createEmptyTaskData(),
                ...taskData,
            };
            addTask(newTask);
        }
        setActiveTask(id);
    }, [getTaskById, addTask, updateTask, setActiveTask]);

    // 更新任务进度
    const updateProgress = useCallback((progress: number, status?: TaskStatus) => {
        if (!taskId) return;
        updateTask(taskId, {
            progress,
            ...(status && { status }),
        });
    }, [taskId, updateTask]);

    // 更新任务状态
    const updateStatus = useCallback((status: TaskStatus) => {
        if (!taskId) return;
        updateTask(taskId, { status });
    }, [taskId, updateTask]);

    // 更新任务标题
    const updateTitle = useCallback((title: string) => {
        if (!taskId) return;
        updateTask(taskId, { title });
    }, [taskId, updateTask]);

    // 更新任务封面
    const updateCover = useCallback((coverImage: string) => {
        if (!taskId) return;
        updateTask(taskId, { coverImage });
    }, [taskId, updateTask]);

    // 更新当前步骤
    const updateStep = useCallback((step: number) => {
        if (!taskId) return;
        updateTask(taskId, { currentStep: step });
    }, [taskId, updateTask]);

    // 更新任务数据快照（防抖）
    const saveSnapshot = useCallback((data: Partial<TaskData>) => {
        if (!taskId) return;
        const task = getTaskById(taskId);
        if (task) {
            const newData = { ...task.data, ...data };
            const newDataStr = JSON.stringify(newData);

            // 只有数据变化时才保存
            if (newDataStr !== lastSavedDataRef.current) {
                lastSavedDataRef.current = newDataStr;
                updateTask(taskId, {
                    data: newData,
                    lastModified: Date.now(),
                });
            }
        }
    }, [taskId, getTaskById, updateTask]);

    // 切换到另一个任务
    const switchToTask = useCallback((targetTaskId: string) => {
        if (taskId && taskId !== targetTaskId) {
            autoSaveAndSwitch(taskId, targetTaskId);
        }
        router.push(`/create?id=${targetTaskId}`);
    }, [taskId, autoSaveAndSwitch, router]);

    // 最小化当前任务（收起全屏编辑，返回主页）
    const minimizeTask = useCallback(() => {
        if (taskId) {
            const task = getTaskById(taskId);
            if (task && task.status !== 'completed') {
                updateTask(taskId, {
                    status: task.status === 'processing' ? 'paused' : 'draft'
                });
            }
        }
        router.push('/');
    }, [taskId, getTaskById, updateTask, router]);

    // 删除任务
    const deleteTask = useCallback((id?: string) => {
        const idToDelete = id || taskId;
        if (idToDelete) {
            removeTask(idToDelete);
            if (idToDelete === taskId) {
                router.push('/');
            }
        }
    }, [taskId, removeTask, router]);

    // 从任务队列恢复数据
    const restoreFromTask = useCallback((): TaskData | null => {
        if (!taskId) return null;
        const task = getTaskById(taskId);
        return task?.data || null;
    }, [taskId, getTaskById]);

    // 设置当前活动任务
    useEffect(() => {
        if (taskId) {
            setActiveTask(taskId);
        }
    }, [taskId, setActiveTask]);

    return {
        // 状态
        taskId,
        currentTask,
        tasks,
        isActiveTask: activeTaskId === taskId,

        // 任务操作
        setCurrentTaskId,
        registerTask,
        updateProgress,
        updateStatus,
        updateTitle,
        updateCover,
        updateStep,
        saveSnapshot,
        restoreFromTask,

        // 导航
        switchToTask,
        minimizeTask,
        deleteTask,
    };
}
