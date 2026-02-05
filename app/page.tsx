"use client";

import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BookOpen, Plus, Image, FileText, Sparkles, Download, Upload } from "lucide-react";
import Link from "next/link";
import { ApiConfigDialog } from "./components/ApiConfigDialog";
import { ProjectList } from "./components/ProjectList";
import { useProjects } from "@/hooks/useProjects";

export default function Home() {
  const {
    projects,
    isLoading,
    deleteProject,
    exportProjects,
    importProjects,
    getGroupedProjects,
    filterProjects,
    updateProjectTitle,
  } = useProjects();

  const [activeTab, setActiveTab] = useState<"all" | "draft" | "completed">("all");
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 处理删除项目
  const handleDeleteProject = (id: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (confirm("确定要删除这个项目吗？")) {
      deleteProject(id);
    }
  };

  // 处理导入
  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setImportMessage(null);
    const result = await importProjects(file);

    if (result.success) {
      const messages: string[] = [];
      if (result.imported > 0) messages.push(`成功导入 ${result.imported} 个项目`);
      if (result.skipped > 0) messages.push(`跳过 ${result.skipped} 个重复项目`);
      if (result.errors.length > 0) messages.push(`${result.errors.length} 个错误`);
      setImportMessage(messages.join("，"));
    } else {
      setImportMessage(`导入失败：${result.errors.join("，")}`);
    }

    // 清空文件输入
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }

    // 3秒后清除消息
    setTimeout(() => setImportMessage(null), 5000);
  };

  // 获取当前 tab 的过滤和分组数据
  const filteredProjects = filterProjects(activeTab);
  const groupedProjects = getGroupedProjects(filteredProjects, activeTab);

  // 获取空状态消息
  const getEmptyMessage = () => {
    switch (activeTab) {
      case "all":
        return "暂无项目，点击上方按钮创建你的第一个绘本吧！";
      case "draft":
        return "暂无草稿项目";
      case "completed":
        return "暂无已完成的项目";
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-blue-50 to-white">
      {/* 顶部导航 */}
      <header className="border-b bg-white/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <BookOpen className="h-8 w-8 text-blue-600" />
            <h1 className="text-2xl font-bold text-gray-800">绘本生成器</h1>
          </div>
          <div className="flex items-center gap-2">
            <ApiConfigDialog />
            <Button>登录</Button>
          </div>
        </div>
      </header>

      {/* 主内容区 */}
      <main className="container mx-auto px-4 py-12">
        {/* 欢迎区域 */}
        <div className="text-center mb-16">
          <h2 className="text-4xl font-bold text-gray-800 mb-4">
            AI 驱动的儿童绘本创作工具
          </h2>
          <p className="text-xl text-gray-600 mb-8 max-w-2xl mx-auto">
            只需上传故事脚本和角色形象，AI 自动为你生成精美的绘本插画
          </p>
          <Link href="/create">
            <Button size="lg" className="text-lg px-8 py-6">
              <Plus className="mr-2 h-5 w-5" />
              创建新绘本
            </Button>
          </Link>
        </div>

        {/* 功能介绍 */}
        <div className="grid md:grid-cols-3 gap-6 mb-16">
          <Card>
            <CardHeader>
              <FileText className="h-10 w-10 text-blue-600 mb-2" />
              <CardTitle>智能脚本拆分</CardTitle>
              <CardDescription>
                输入完整故事，AI 自动拆分成适合绘本的页面结构
              </CardDescription>
            </CardHeader>
          </Card>

          <Card>
            <CardHeader>
              <Image className="h-10 w-10 text-green-600 mb-2" />
              <CardTitle>角色一致性</CardTitle>
              <CardDescription>
                上传角色参考图，确保每页插画中的角色形象保持一致
              </CardDescription>
            </CardHeader>
          </Card>

          <Card>
            <CardHeader>
              <Sparkles className="h-10 w-10 text-purple-600 mb-2" />
              <CardTitle>多种风格</CardTitle>
              <CardDescription>
                支持水彩、卡通、扁平等多种绘本风格，满足不同需求
              </CardDescription>
            </CardHeader>
          </Card>
        </div>

        {/* 我的项目 */}
        <div>
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-2xl font-bold text-gray-800">我的项目</h3>

            {/* 导入导出按钮 */}
            <div className="flex items-center gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept=".json"
                onChange={handleImport}
                className="hidden"
              />
              <Button
                variant="outline"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
                disabled={isLoading}
              >
                <Upload className="h-4 w-4 mr-2" />
                导入数据
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={exportProjects}
                disabled={isLoading || projects.length === 0}
              >
                <Download className="h-4 w-4 mr-2" />
                导出数据
              </Button>
            </div>
          </div>

          {/* 导入消息 */}
          {importMessage && (
            <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg text-blue-700 text-sm">
              {importMessage}
            </div>
          )}

          <Tabs
            value={activeTab}
            onValueChange={(v) => setActiveTab(v as "all" | "draft" | "completed")}
            className="w-full"
          >
            <TabsList className="mb-6">
              <TabsTrigger value="all">
                全部 ({projects.length})
              </TabsTrigger>
              <TabsTrigger value="draft">
                草稿 ({projects.filter((p) => p.status === "draft").length})
              </TabsTrigger>
              <TabsTrigger value="completed">
                已完成 ({projects.filter((p) => p.status === "completed").length})
              </TabsTrigger>
            </TabsList>

            <TabsContent value={activeTab}>
              {isLoading ? (
                <div className="text-center py-12 text-gray-500">加载中...</div>
              ) : (
                <ProjectList
                  groupedProjects={groupedProjects}
                  tab={activeTab}
                  onDeleteProject={handleDeleteProject}
                  onRenameProject={updateProjectTitle}
                  emptyMessage={getEmptyMessage()}
                />
              )}
            </TabsContent>
          </Tabs>
        </div>
      </main>

      {/* 底部 */}
      <footer className="border-t bg-gray-50 mt-16">
        <div className="container mx-auto px-4 py-8 text-center text-gray-600">
          <p>儿童绘本生成器 © 2024</p>
        </div>
      </footer>
    </div>
  );
}
