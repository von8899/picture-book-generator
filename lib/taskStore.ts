"use client";

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

// 任务状态类型
export type TaskStatus = 'draft' | 'queued' | 'processing' | 'completed' | 'paused';

// 任务数据结构
export interface TaskData {
    script: string;
    topics: string;
    plotDirection: string;
    scenes: Array<{
        id: number;
        imagePrompt: string;
        text: string;
    }>;
    characters: Array<{
        id: string;
        name: string;
        description: string;
        imageBase64List: string[];
    }>;
    selectedStyle: string;
    generatedImages: { [sceneId: number]: string };
    currentStep: number;
    // 服务端任务 ID（用于恢复后台任务）
    serverTaskId?: string;
}

// 任务结构
export interface Task {
    id: string;
    title: string;
    status: TaskStatus;
    progress: number; // 0-100
    currentStep: number; // 当前步骤 1-4
    totalSteps: number; // 总步骤数
    lastModified: number;
    coverImage?: string; // 封面/缩略图
    data: TaskData; // 表单数据快照
}

// 创建空任务数据
export function createEmptyTaskData(): TaskData {
    return {
        script: '',
        topics: '',
        plotDirection: '',
        scenes: [],
        characters: [],
        selectedStyle: '',
        generatedImages: {},
        currentStep: 1,
    };
}

// 全局数据保存回调类型
type DataSaveCallback = () => Partial<TaskData> | null;

// 全局回调注册表（在 store 外部，不需要持久化）
let _dataSaveCallback: DataSaveCallback | null = null;

export const registerDataSaveCallback = (callback: DataSaveCallback) => {
    _dataSaveCallback = callback;
};

export const unregisterDataSaveCallback = () => {
    _dataSaveCallback = null;
};

export const getDataFromCallback = (): Partial<TaskData> | null => {
    return _dataSaveCallback ? _dataSaveCallback() : null;
};

// Store 接口
interface TaskQueueState {
    tasks: Task[];
    activeTaskId: string | null;
    isWidgetExpanded: boolean;
    _hasHydrated: boolean;

    // Actions
    addTask: (task: Task) => void;
    updateTask: (id: string, updates: Partial<Task>) => void;
    removeTask: (id: string) => void;
    setActiveTask: (id: string | null) => void;
    pauseTask: (id: string) => void;
    resumeTask: (id: string) => void;
    toggleWidget: () => void;
    getTaskById: (id: string) => Task | undefined;
    setHasHydrated: (state: boolean) => void;

    // 智能切换（自动调用回调获取数据并保存）
    autoSaveAndSwitch: (currentTaskId: string, targetTaskId: string) => void;
}

export const useTaskStore = create<TaskQueueState>()(
    persist(
        (set, get) => ({
            tasks: [],
            activeTaskId: null,
            isWidgetExpanded: false,
            _hasHydrated: false,

            setHasHydrated: (state) => set({ _hasHydrated: state }),

            addTask: (task) => set((state) => ({
                tasks: [...state.tasks, task]
            })),

            updateTask: (id, updates) => set((state) => ({
                tasks: state.tasks.map(t =>
                    t.id === id ? { ...t, ...updates, lastModified: Date.now() } : t
                )
            })),

            removeTask: (id) => set((state) => ({
                tasks: state.tasks.filter(t => t.id !== id),
                activeTaskId: state.activeTaskId === id ? null : state.activeTaskId
            })),

            setActiveTask: (id) => set({ activeTaskId: id }),

            pauseTask: (id) => set((state) => ({
                tasks: state.tasks.map(t =>
                    t.id === id ? { ...t, status: 'paused' as TaskStatus, lastModified: Date.now() } : t
                )
            })),

            resumeTask: (id) => set((state) => ({
                tasks: state.tasks.map(t =>
                    t.id === id ? { ...t, status: 'processing' as TaskStatus, lastModified: Date.now() } : t
                )
            })),

            toggleWidget: () => set((state) => ({
                isWidgetExpanded: !state.isWidgetExpanded
            })),

            getTaskById: (id) => {
                return get().tasks.find(t => t.id === id);
            },

            autoSaveAndSwitch: (currentTaskId, targetTaskId) => {
                const { tasks, updateTask, setActiveTask } = get();
                const currentTask = tasks.find(t => t.id === currentTaskId);

                if (currentTask && currentTask.status !== 'completed') {
                    // 调用回调获取当前页面数据
                    const dataToSave = getDataFromCallback();

                    // 保存当前任务数据和状态
                    const updates: Partial<Task> = {
                        status: currentTask.status === 'processing' ? 'paused' : 'draft',
                        lastModified: Date.now(),
                    };

                    // 如果回调返回了数据，合并到 task.data 并同步 currentStep
                    if (dataToSave) {
                        updates.data = { ...currentTask.data, ...dataToSave };
                        // 同步 currentStep 到顶级字段
                        if (dataToSave.currentStep !== undefined) {
                            updates.currentStep = dataToSave.currentStep;
                        }
                    }

                    updateTask(currentTaskId, updates);
                }

                // 切换到目标任务
                setActiveTask(targetTaskId);
            }
        }),
        {
            name: 'task-queue-storage',
            storage: createJSONStorage(() => localStorage),
            partialize: (state) => ({
                tasks: state.tasks,
                activeTaskId: state.activeTaskId
            }),
            onRehydrateStorage: () => (state) => {
                state?.setHasHydrated(true);
            },
        }
    )
);

// 辅助 Hook：等待水合完成
export const useHasHydrated = () => {
    return useTaskStore((state) => state._hasHydrated);
};
