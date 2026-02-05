"use client";

import { useTaskStore, Task, TaskStatus } from "@/lib/taskStore";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import {
    Layers,
    X,
    Play,
    Pause,
    CheckCircle,
    Clock,
    FileEdit,
    Trash2,
} from "lucide-react";
import { useState } from "react";

// 状态图标映射
const statusIcons: Record<TaskStatus, React.ReactNode> = {
    draft: <FileEdit className="h-4 w-4 text-gray-400" />,
    queued: <Clock className="h-4 w-4 text-yellow-500" />,
    processing: <Play className="h-4 w-4 text-blue-500 animate-pulse" />,
    paused: <Pause className="h-4 w-4 text-orange-500" />,
    completed: <CheckCircle className="h-4 w-4 text-green-500" />,
};

// 状态文字映射
const statusLabels: Record<TaskStatus, string> = {
    draft: '草稿',
    queued: '排队中',
    processing: '生成中',
    paused: '已暂停',
    completed: '已完成',
};

export function TaskQueueWidget() {
    const router = useRouter();
    const {
        tasks,
        activeTaskId,
        isWidgetExpanded,
        toggleWidget,
        autoSaveAndSwitch,
        removeTask,
    } = useTaskStore();

    const [hoveredTaskId, setHoveredTaskId] = useState<string | null>(null);

    // 显示所有任务（包括草稿）
    const allTasks = tasks;
    // 仅非完成的任务数量用于计数显示
    const activeTasks = tasks.filter(t => t.status !== 'completed');
    const processingCount = tasks.filter(t =>
        t.status === 'processing' || t.status === 'queued'
    ).length;

    // 计算整体进度（基于非完成的任务）
    const overallProgress = activeTasks.length > 0
        ? Math.round(
            activeTasks.reduce((sum, t) => sum + t.progress, 0) / activeTasks.length
        )
        : 0;

    // 点击任务卡片，切换任务
    const handleTaskClick = (task: Task) => {
        console.log('点击任务:', task.id, '当前活动任务:', activeTaskId);

        // 如果点击的是当前任务，只收起悬浮窗
        if (activeTaskId === task.id) {
            console.log('已经在当前任务，只收起悬浮窗');
            toggleWidget();
            return;
        }

        // 切换到新任务
        if (activeTaskId) {
            autoSaveAndSwitch(activeTaskId, task.id);
        }

        router.push(`/create?id=${task.id}`);
        toggleWidget(); // 收起悬浮窗
    };

    // 删除任务
    const handleDeleteTask = (e: React.MouseEvent, taskId: string) => {
        e.stopPropagation();
        if (confirm('确定要删除这个任务吗？')) {
            removeTask(taskId);
        }
    };

    // 没有任务时不显示
    if (allTasks.length === 0) {
        return null;
    }

    return (
        <div className="fixed bottom-6 right-6 z-50">
            {/* 展开状态 - 任务列表 */}
            {isWidgetExpanded && (
                <div className="absolute bottom-16 right-0 w-80 bg-white rounded-xl shadow-2xl border overflow-hidden animate-in slide-in-from-bottom-2 duration-200">
                    {/* 头部 */}
                    <div className="px-4 py-3 bg-gradient-to-r from-blue-500 to-purple-500 text-white flex items-center justify-between">
                        <span className="font-medium">任务队列 ({allTasks.length})</span>
                        <button
                            onClick={toggleWidget}
                            className="hover:bg-white/20 rounded p-1 transition"
                        >
                            <X className="h-4 w-4" />
                        </button>
                    </div>

                    {/* 任务列表 */}
                    <div className="max-h-80 overflow-y-auto">
                        {allTasks.map((task) => (
                            <div
                                key={task.id}
                                onClick={() => handleTaskClick(task)}
                                onMouseEnter={() => setHoveredTaskId(task.id)}
                                onMouseLeave={() => setHoveredTaskId(null)}
                                className={cn(
                                    "relative flex items-center gap-3 p-3 hover:bg-gray-50 cursor-pointer border-b last:border-b-0 transition",
                                    activeTaskId === task.id && "bg-blue-50"
                                )}
                            >
                                {/* 封面缩略图 */}
                                <div className="w-12 h-12 rounded-lg bg-gray-100 flex-shrink-0 overflow-hidden">
                                    {task.coverImage ? (
                                        <img
                                            src={task.coverImage}
                                            alt={task.title}
                                            className="w-full h-full object-cover"
                                        />
                                    ) : (
                                        <div className="w-full h-full flex items-center justify-center text-gray-400">
                                            <Layers className="h-6 w-6" />
                                        </div>
                                    )}
                                </div>

                                {/* 任务信息 */}
                                <div className="flex-1 min-w-0">
                                    <div className="font-medium text-sm text-gray-800 truncate">
                                        {task.title || '未命名任务'}
                                    </div>
                                    <div className="flex items-center gap-2 mt-1">
                                        {statusIcons[task.status]}
                                        <span className="text-xs text-gray-500">
                                            {statusLabels[task.status]}
                                        </span>
                                        <span className="text-xs text-gray-400">
                                            · 步骤 {task.currentStep}/{task.totalSteps}
                                        </span>
                                    </div>
                                    {/* 进度条 */}
                                    {(task.status === 'processing' || task.status === 'queued') && (
                                        <div className="mt-2 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                                            <div
                                                className="h-full bg-blue-500 transition-all duration-300"
                                                style={{ width: `${task.progress}%` }}
                                            />
                                        </div>
                                    )}
                                </div>

                                {/* 删除按钮 */}
                                {hoveredTaskId === task.id && (
                                    <button
                                        onClick={(e) => handleDeleteTask(e, task.id)}
                                        className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-md hover:bg-red-50 text-gray-400 hover:text-red-500 transition"
                                        title="删除任务"
                                    >
                                        <Trash2 className="h-4 w-4" />
                                    </button>
                                )}
                            </div>
                        ))}
                    </div>

                    {/* 底部提示 */}
                    <div className="px-4 py-2 bg-gray-50 text-xs text-gray-500 text-center border-t">
                        点击任务可快速切换，当前任务会自动保存
                    </div>
                </div>
            )}

            {/* 折叠状态 - 悬浮按钮 */}
            <button
                onClick={toggleWidget}
                className={cn(
                    "relative w-14 h-14 rounded-full shadow-lg flex items-center justify-center transition-all duration-200",
                    "bg-gradient-to-r from-blue-500 to-purple-500 hover:scale-105 hover:shadow-xl",
                    isWidgetExpanded && "ring-4 ring-white/30"
                )}
                title={`${activeTasks.length} 个任务进行中`}
            >
                {/* 进度环 */}
                <svg className="absolute inset-0 w-full h-full -rotate-90">
                    <circle
                        cx="28"
                        cy="28"
                        r="24"
                        fill="none"
                        stroke="rgba(255,255,255,0.3)"
                        strokeWidth="4"
                    />
                    <circle
                        cx="28"
                        cy="28"
                        r="24"
                        fill="none"
                        stroke="white"
                        strokeWidth="4"
                        strokeLinecap="round"
                        strokeDasharray={`${2 * Math.PI * 24}`}
                        strokeDashoffset={`${2 * Math.PI * 24 * (1 - overallProgress / 100)}`}
                        className="transition-all duration-500"
                    />
                </svg>

                <Layers className="h-6 w-6 text-white relative z-10" />

                {/* 任务数量徽章 */}
                {processingCount > 0 && (
                    <span className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white text-xs rounded-full flex items-center justify-center font-medium shadow-sm">
                        {processingCount}
                    </span>
                )}
            </button>
        </div>
    );
}
