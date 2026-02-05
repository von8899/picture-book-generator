"use client";

import { useState, useMemo } from "react";
import { Project } from "@/lib/projects";
import { GroupedProjects } from "@/hooks/useProjects";
import { ProjectCard } from "./ProjectCard";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
    BookOpen,
    Search,
    X,
    ChevronDown,
    ChevronRight,
    ChevronsUpDown,
} from "lucide-react";

interface ProjectListProps {
    groupedProjects: GroupedProjects;
    tab: "all" | "draft" | "completed";
    onDeleteProject: (id: string, e: React.MouseEvent) => void;
    onRenameProject?: (id: string, newTitle: string) => void;
    emptyMessage?: string;
}

export function ProjectList({
    groupedProjects,
    tab,
    onDeleteProject,
    onRenameProject,
    emptyMessage = "暂无项目",
}: ProjectListProps) {
    // 搜索状态
    const [searchQuery, setSearchQuery] = useState("");

    // 折叠状态：记录哪些日期分组是展开的
    const [expandedGroups, setExpandedGroups] = useState<Set<string>>(() => {
        // 默认展开"今天"和"昨天"
        return new Set(["今天", "昨天"]);
    });

    // 按日期键排序（倒序，最新的在前）
    const sortedDateKeys = useMemo(
        () => Object.keys(groupedProjects).sort((a, b) => b.localeCompare(a)),
        [groupedProjects]
    );

    // 根据搜索词过滤项目
    const filteredGroups = useMemo(() => {
        if (!searchQuery.trim()) {
            return groupedProjects;
        }

        const query = searchQuery.toLowerCase().trim();
        const filtered: GroupedProjects = {};

        for (const dateKey of sortedDateKeys) {
            const group = groupedProjects[dateKey];
            const matchedProjects = group.projects.filter((p) =>
                p.title.toLowerCase().includes(query)
            );

            if (matchedProjects.length > 0) {
                filtered[dateKey] = {
                    label: group.label,
                    projects: matchedProjects,
                };
            }
        }

        return filtered;
    }, [groupedProjects, sortedDateKeys, searchQuery]);

    // 过滤后的日期键
    const filteredDateKeys = useMemo(
        () => Object.keys(filteredGroups).sort((a, b) => b.localeCompare(a)),
        [filteredGroups]
    );

    // 判断分组是否展开（搜索时强制展开）
    const isGroupExpanded = (label: string) => {
        if (searchQuery.trim()) return true; // 搜索时强制展开
        return expandedGroups.has(label);
    };

    // 切换分组展开状态
    const toggleGroup = (label: string) => {
        if (searchQuery.trim()) return; // 搜索时禁止折叠
        setExpandedGroups((prev) => {
            const newSet = new Set(prev);
            if (newSet.has(label)) {
                newSet.delete(label);
            } else {
                newSet.add(label);
            }
            return newSet;
        });
    };

    // 全部展开
    const expandAll = () => {
        const allLabels = filteredDateKeys.map((key) => filteredGroups[key].label);
        setExpandedGroups(new Set(allLabels));
    };

    // 全部收起
    const collapseAll = () => {
        setExpandedGroups(new Set());
    };

    // 判断是否全部展开
    const isAllExpanded = filteredDateKeys.every((key) =>
        expandedGroups.has(filteredGroups[key].label)
    );

    // 清空搜索
    const clearSearch = () => {
        setSearchQuery("");
    };

    // 判断是否为空
    const isEmpty = filteredDateKeys.length === 0;
    const isOriginalEmpty = sortedDateKeys.length === 0;

    // 原始数据为空
    if (isOriginalEmpty) {
        return (
            <Card className="border-dashed border-2 bg-gray-50/50">
                <CardContent className="flex flex-col items-center justify-center py-12">
                    <BookOpen className="h-12 w-12 text-gray-400 mb-4" />
                    <p className="text-gray-500 text-center">{emptyMessage}</p>
                </CardContent>
            </Card>
        );
    }

    return (
        <div className="space-y-4">
            {/* 搜索栏和控制按钮 */}
            <div className="flex items-center gap-3">
                {/* 搜索框 */}
                <div className="relative flex-1 max-w-md">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                    <Input
                        type="text"
                        placeholder="搜索项目名称..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="pl-10 pr-10"
                    />
                    {searchQuery && (
                        <button
                            onClick={clearSearch}
                            className="absolute right-3 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-gray-100"
                        >
                            <X className="h-4 w-4 text-gray-400" />
                        </button>
                    )}
                </div>

                {/* 全部展开/收起按钮 */}
                <Button
                    variant="outline"
                    size="sm"
                    onClick={isAllExpanded ? collapseAll : expandAll}
                    disabled={!!searchQuery.trim()}
                    className="whitespace-nowrap"
                >
                    <ChevronsUpDown className="h-4 w-4 mr-1" />
                    {isAllExpanded ? "全部收起" : "全部展开"}
                </Button>
            </div>

            {/* 搜索结果为空 */}
            {isEmpty && searchQuery && (
                <Card className="border-dashed border-2 bg-gray-50/50">
                    <CardContent className="flex flex-col items-center justify-center py-12">
                        <Search className="h-12 w-12 text-gray-400 mb-4" />
                        <p className="text-gray-500 text-center">
                            未找到包含 "{searchQuery}" 的项目
                        </p>
                        <Button
                            variant="link"
                            onClick={clearSearch}
                            className="mt-2"
                        >
                            清空搜索
                        </Button>
                    </CardContent>
                </Card>
            )}

            {/* 项目列表 */}
            {!isEmpty && (
                <div className="space-y-6">
                    {filteredDateKeys.map((dateKey) => {
                        const group = filteredGroups[dateKey];
                        const isExpanded = isGroupExpanded(group.label);

                        return (
                            <div key={dateKey}>
                                {/* 可折叠的日期标题 */}
                                <button
                                    onClick={() => toggleGroup(group.label)}
                                    disabled={!!searchQuery.trim()}
                                    className={`w-full text-left flex items-center gap-2 py-2 px-1 rounded-lg transition-colors ${searchQuery.trim()
                                            ? "cursor-default"
                                            : "hover:bg-gray-50 cursor-pointer"
                                        }`}
                                >
                                    {/* 折叠箭头 */}
                                    {isExpanded ? (
                                        <ChevronDown className="h-5 w-5 text-gray-500" />
                                    ) : (
                                        <ChevronRight className="h-5 w-5 text-gray-500" />
                                    )}
                                    {/* 蓝色圆点 */}
                                    <span className="w-2 h-2 bg-blue-500 rounded-full"></span>
                                    {/* 日期标签 */}
                                    <span className="text-lg font-semibold text-gray-700">
                                        {group.label}
                                    </span>
                                    {/* 项目数量 */}
                                    <span className="text-sm text-gray-400">
                                        ({group.projects.length})
                                    </span>
                                </button>

                                {/* 项目卡片网格（可折叠） */}
                                {isExpanded && (
                                    <div className="grid md:grid-cols-3 gap-6 mt-3 ml-7">
                                        {group.projects.map((project) => (
                                            <ProjectCard
                                                key={project.id}
                                                project={project}
                                                onDelete={onDeleteProject}
                                                onRename={onRenameProject}
                                                showCompletedTime={tab === "completed"}
                                            />
                                        ))}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
