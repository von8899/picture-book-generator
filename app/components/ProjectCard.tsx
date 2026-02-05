"use client";

import { useState, useRef, useEffect } from "react";
import { Project } from "@/lib/projects";
import { formatDateTime } from "@/lib/dateUtils";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { BookOpen, Trash2, Pencil } from "lucide-react";
import Link from "next/link";

interface ProjectCardProps {
    project: Project;
    onDelete: (id: string, e: React.MouseEvent) => void;
    onRename?: (id: string, newTitle: string) => void;
    showCompletedTime?: boolean;
}

export function ProjectCard({
    project,
    onDelete,
    onRename,
    showCompletedTime = false,
}: ProjectCardProps) {
    const [isEditing, setIsEditing] = useState(false);
    const [editTitle, setEditTitle] = useState(project.title);
    const inputRef = useRef<HTMLInputElement>(null);

    // 根据状态选择显示的时间
    const displayTime = showCompletedTime && project.completedAt
        ? project.completedAt
        : project.createdAt;

    const timeLabel = showCompletedTime && project.completedAt
        ? "完成"
        : "创建";

    // 进入编辑模式时聚焦输入框
    useEffect(() => {
        if (isEditing && inputRef.current) {
            inputRef.current.focus();
            inputRef.current.select();
        }
    }, [isEditing]);

    // 开始编辑
    const handleStartEdit = (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setEditTitle(project.title);
        setIsEditing(true);
    };

    // 保存编辑
    const handleSave = () => {
        const trimmed = editTitle.trim();
        if (trimmed && trimmed !== project.title && onRename) {
            onRename(project.id, trimmed);
        }
        setIsEditing(false);
    };

    // 取消编辑
    const handleCancel = () => {
        setEditTitle(project.title);
        setIsEditing(false);
    };

    // 键盘事件
    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === "Enter") {
            e.preventDefault();
            handleSave();
        } else if (e.key === "Escape") {
            e.preventDefault();
            handleCancel();
        }
    };

    // 阻止输入框的点击事件冒泡到 Link
    const handleInputClick = (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
    };

    return (
        <Link href={`/create?id=${project.id}`}>
            <Card className="hover:shadow-lg transition-shadow cursor-pointer h-full group">
                {/* 封面图 */}
                <div className="relative h-40 bg-gradient-to-br from-blue-100 to-purple-100 rounded-t-lg overflow-hidden">
                    {project.coverImage ? (
                        <img
                            src={project.coverImage}
                            alt={project.title}
                            className="w-full h-full object-cover"
                        />
                    ) : (
                        <div className="w-full h-full flex items-center justify-center">
                            <BookOpen className="h-16 w-16 text-gray-300" />
                        </div>
                    )}

                    {/* 删除按钮 */}
                    <button
                        onClick={(e) => onDelete(project.id, e)}
                        className="absolute top-2 right-2 p-2 bg-white/80 rounded-full opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-50"
                    >
                        <Trash2 className="h-4 w-4 text-red-500" />
                    </button>
                </div>

                <CardHeader className="pb-3">
                    <div className="flex justify-between items-start gap-2">
                        {/* 标题区域 */}
                        <div className="flex-1 min-w-0 flex items-center gap-1">
                            {isEditing ? (
                                <input
                                    ref={inputRef}
                                    type="text"
                                    value={editTitle}
                                    onChange={(e) => setEditTitle(e.target.value)}
                                    onBlur={handleSave}
                                    onKeyDown={handleKeyDown}
                                    onClick={handleInputClick}
                                    className="flex-1 text-lg font-semibold border border-blue-400 rounded px-2 py-0.5 outline-none focus:ring-2 focus:ring-blue-500"
                                />
                            ) : (
                                <>
                                    <CardTitle className="text-lg line-clamp-1 flex-1">
                                        {project.title}
                                    </CardTitle>
                                    {onRename && (
                                        <button
                                            onClick={handleStartEdit}
                                            className="p-1 rounded hover:bg-gray-100 opacity-0 group-hover:opacity-100 transition-opacity"
                                            title="重命名"
                                        >
                                            <Pencil className="h-3.5 w-3.5 text-gray-500" />
                                        </button>
                                    )}
                                </>
                            )}
                        </div>

                        {/* 状态标签 */}
                        <span
                            className={`text-xs px-2 py-1 rounded-full whitespace-nowrap ${project.status === "completed"
                                    ? "bg-green-100 text-green-700"
                                    : "bg-yellow-100 text-yellow-700"
                                }`}
                        >
                            {project.status === "completed" ? "已完成" : "草稿"}
                        </span>
                    </div>
                    <CardDescription className="flex items-center gap-2">
                        <span>{project.scenes.length} 个分镜</span>
                        <span>·</span>
                        <span>{formatDateTime(displayTime)} {timeLabel}</span>
                    </CardDescription>
                </CardHeader>
            </Card>
        </Link>
    );
}
