"use client";

import { useState, useEffect, useCallback } from "react";
import { Project, getAllProjects, deleteProject as deleteProjectFromStorage, saveProject } from "@/lib/projects";
import { migrateDate, getDateKey, formatDateGroup } from "@/lib/dateUtils";

// 导入结果类型
export interface ImportResult {
    success: boolean;
    imported: number;
    skipped: number;
    errors: string[];
}

// 按日期分组的项目
export interface GroupedProjects {
    [dateKey: string]: {
        label: string;
        projects: Project[];
    };
}

/**
 * 项目管理 Hook
 * 统一处理项目的读取、保存、导出、导入逻辑
 * 解决 Next.js Hydration 问题
 */
export function useProjects() {
    const [projects, setProjects] = useState<Project[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    // 加载项目（仅在客户端执行）
    const loadProjects = useCallback(() => {
        if (typeof window === "undefined") return;

        const allProjects = getAllProjects();

        // 数据迁移：将旧的日期字符串转换为时间戳
        const migratedProjects = allProjects.map((p) => ({
            ...p,
            createdAt: migrateDate(p.createdAt as unknown as string | number),
            updatedAt: migrateDate(p.updatedAt as unknown as string | number),
            completedAt: p.completedAt ? migrateDate(p.completedAt as unknown as string | number) : undefined,
        }));

        // 按 updatedAt 倒序排列
        migratedProjects.sort((a, b) => b.updatedAt - a.updatedAt);

        setProjects(migratedProjects);
        setIsLoading(false);
    }, []);

    // 初始化时加载
    useEffect(() => {
        loadProjects();
    }, [loadProjects]);

    // 刷新项目列表
    const refreshProjects = useCallback(() => {
        loadProjects();
    }, [loadProjects]);

    // 删除项目
    const handleDeleteProject = useCallback((id: string) => {
        deleteProjectFromStorage(id);
        setProjects((prev) => prev.filter((p) => p.id !== id));
    }, []);

    // 导出所有项目为 JSON 文件
    const exportProjects = useCallback(() => {
        const data = JSON.stringify(projects, null, 2);
        const blob = new Blob([data], { type: "application/json" });
        const url = URL.createObjectURL(blob);

        // 生成带日期的文件名
        const now = new Date();
        const dateStr = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
        const fileName = `my_books_backup_${dateStr}.json`;

        const a = document.createElement("a");
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }, [projects]);

    // 生成唯一标题（类似操作系统文件命名规则）
    // 支持解析已有的 (数字) 后缀，避免产生 (1)(1) 的嵌套
    const generateUniqueTitle = (title: string, existingTitles: Set<string>): string => {
        if (!existingTitles.has(title)) {
            return title;
        }

        // 解析标题：分离基础名称和已有数字后缀
        // 匹配结尾的 (数字) 模式，如 "小红帽(1)" -> ["小红帽", "1"]
        const suffixPattern = /^(.+)\((\d+)\)$/;
        const match = title.match(suffixPattern);

        let baseName: string;
        let startCounter: number;

        if (match) {
            // 已有数字后缀，提取基础名称和起始数字
            baseName = match[1];
            startCounter = parseInt(match[2], 10) + 1;
        } else {
            // 没有数字后缀，从 1 开始
            baseName = title;
            startCounter = 1;
        }

        // 找到可用的数字
        let counter = startCounter;
        let newTitle = `${baseName}(${counter})`;
        while (existingTitles.has(newTitle)) {
            counter++;
            newTitle = `${baseName}(${counter})`;
        }
        return newTitle;
    };

    // 导入项目
    const importProjects = useCallback(
        async (file: File): Promise<ImportResult> => {
            const result: ImportResult = {
                success: false,
                imported: 0,
                skipped: 0,
                errors: [],
            };

            try {
                const text = await file.text();
                const importedData = JSON.parse(text);

                if (!Array.isArray(importedData)) {
                    result.errors.push("无效的数据格式：期望是项目数组");
                    return result;
                }

                const existingIds = new Set(projects.map((p) => p.id));
                const existingTitles = new Set(projects.map((p) => p.title));

                for (const item of importedData) {
                    try {
                        // 验证必要字段
                        if (!item.id || !item.title) {
                            result.errors.push(`跳过无效项目：缺少必要字段`);
                            result.skipped++;
                            continue;
                        }

                        // 如果 ID 已存在，生成新 ID（作为副本导入）
                        let projectId = item.id;
                        if (existingIds.has(item.id)) {
                            projectId = `project_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
                        }

                        // 将新 ID 加入已存在集合，防止后续导入的项目冲突
                        existingIds.add(projectId);

                        // 标题自动查重：如果标题已存在，自动添加 (1), (2)... 后缀
                        const projectTitle = generateUniqueTitle(item.title, existingTitles);
                        existingTitles.add(projectTitle);

                        // 迁移日期格式
                        const migratedProject: Project = {
                            ...item,
                            id: projectId,
                            title: projectTitle,
                            createdAt: migrateDate(item.createdAt),
                            updatedAt: migrateDate(item.updatedAt),
                            completedAt: item.completedAt ? migrateDate(item.completedAt) : undefined,
                        };

                        // 保存到 localStorage
                        saveProject(migratedProject);
                        result.imported++;
                    } catch (err) {
                        result.errors.push(`导入项目失败: ${err instanceof Error ? err.message : "未知错误"}`);
                    }
                }

                result.success = true;

                // 重新加载项目列表
                loadProjects();

                return result;
            } catch (err) {
                result.errors.push(`解析 JSON 失败: ${err instanceof Error ? err.message : "未知错误"}`);
                return result;
            }
        },
        [projects, loadProjects]
    );

    // 按日期分组项目
    const getGroupedProjects = useCallback(
        (filteredProjects: Project[], tab: "all" | "draft" | "completed"): GroupedProjects => {
            const grouped: GroupedProjects = {};

            // 根据 tab 确定用哪个日期字段排序
            const sortedProjects = [...filteredProjects].sort((a, b) => {
                if (tab === "completed") {
                    // 已完成按 completedAt 倒序
                    return (b.completedAt || b.updatedAt) - (a.completedAt || a.updatedAt);
                }
                // 草稿和全部按 createdAt 倒序
                return b.createdAt - a.createdAt;
            });

            for (const project of sortedProjects) {
                // 根据状态选择日期
                const timestamp =
                    tab === "completed" && project.completedAt
                        ? project.completedAt
                        : project.createdAt;

                const dateKey = getDateKey(timestamp);

                if (!grouped[dateKey]) {
                    grouped[dateKey] = {
                        label: formatDateGroup(timestamp),
                        projects: [],
                    };
                }

                grouped[dateKey].projects.push(project);
            }

            return grouped;
        },
        []
    );

    // 过滤项目
    const filterProjects = useCallback(
        (tab: "all" | "draft" | "completed"): Project[] => {
            if (tab === "all") return projects;
            return projects.filter((p) => p.status === tab);
        },
        [projects]
    );

    // 更新项目标题
    const updateProjectTitle = useCallback(
        (id: string, newTitle: string) => {
            // 标题不能为空
            const trimmedTitle = newTitle.trim();
            if (!trimmedTitle) return false;

            const project = projects.find((p) => p.id === id);
            if (!project) return false;

            // 更新项目
            const updatedProject: Project = {
                ...project,
                title: trimmedTitle,
                updatedAt: Date.now(),
            };

            // 保存到 localStorage
            saveProject(updatedProject);

            // 更新本地状态
            setProjects((prev) =>
                prev.map((p) => (p.id === id ? updatedProject : p))
            );

            return true;
        },
        [projects]
    );

    return {
        projects,
        isLoading,
        deleteProject: handleDeleteProject,
        refreshProjects,
        exportProjects,
        importProjects,
        getGroupedProjects,
        filterProjects,
        updateProjectTitle,
    };
}
