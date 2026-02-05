"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { useTaskQueue } from "@/hooks/useTaskQueue";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  ArrowLeft,
  Upload,
  Sparkles,
  Wand2,
  ArrowRight,
  X,
  Plus,
  ImagePlus,
  Check,
  FileText,
  Users,
  Palette,
  Play,
  Loader2,
  Scissors,
  RotateCcw,
  Save,
  Eye,
  BookOpen,
  Trash2,
  Download,
  FileDown,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import JSZip from "jszip";
import { saveAs } from "file-saver";
import { PDFDocument } from "pdf-lib";
import {
  Dialog,
  DialogContent,
} from "@/components/ui/dialog";
import Link from "next/link";
import {
  Project,
  ProjectCharacter,
  ProjectScene,
  getProjectById,
  saveProject,
  generateProjectId,
  generateProjectTitle,
} from "@/lib/projects";
import {
  registerDataSaveCallback,
  unregisterDataSaveCallback,
  TaskData,
} from "@/lib/taskStore";


interface Character {
  id: string;
  name: string;
  description: string;
  images: { file: File; preview: string }[];
  savedBase64Images?: string[]; // 从保存的项目加载的 base64 图片
}

interface Scene {
  id: number;
  imagePrompt: string;  // 画面描述
  text: string;         // 故事文字
}

// 生成唯一 ID 的辅助函数（兼容性更好）
const generateId = () => {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
};

const createEmptyCharacter = (): Character => ({
  id: generateId(),
  name: "",
  description: "",
  images: [],
});

const steps = [
  { id: 1, title: "脚本设置", icon: FileText },
  { id: 2, title: "角色设置", icon: Users },
  { id: 3, title: "参数设置", icon: Palette },
  { id: 4, title: "生成预览", icon: Play },
];

export default function CreatePage() {
  const searchParams = useSearchParams();
  const projectIdParam = searchParams.get("id");

  const [projectId, setProjectId] = useState<string>("");
  const [step, setStep] = useState(1);
  const [script, setScript] = useState("");
  const [topics, setTopics] = useState("");
  const [plotDirection, setPlotDirection] = useState("");
  const [splitStoryboardCount, setSplitStoryboardCount] = useState(8);
  const [keepOriginal, setKeepOriginal] = useState(false);
  const [selectedStyle, setSelectedStyle] = useState<string>("pixar");
  const [imageSize, setImageSize] = useState<string>("1024x1024");
  const [imageAspectRatio, setImageAspectRatio] = useState<string>("1:1");
  const [characters, setCharacters] = useState<Character[]>([createEmptyCharacter()]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSplitting, setIsSplitting] = useState(false);
  const [activeTab, setActiveTab] = useState("upload");
  const [error, setError] = useState<string | null>(null);
  const [splitError, setSplitError] = useState<string | null>(null);
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [generatedImages, setGeneratedImages] = useState<{ [sceneId: number]: string }>({});
  const [generatingSceneId, setGeneratingSceneId] = useState<number | null>(null);
  const [isGeneratingImages, setIsGeneratingImages] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null); // 用于控制暂停生成
  const [failedScenes, setFailedScenes] = useState<Set<number>>(new Set()); // 记录生成失败的分镜
  const [imageError, setImageError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [generatingCharacterId, setGeneratingCharacterId] = useState<string | null>(null);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [showCharacterWarning, setShowCharacterWarning] = useState(false);
  const [editingDescriptionId, setEditingDescriptionId] = useState<string | null>(null);
  const [tempDescription, setTempDescription] = useState("");
  const fileInputRefs = useRef<{ [key: string]: HTMLInputElement | null }>({});

  // 课本转绘本相关状态
  const [textbookImages, setTextbookImages] = useState<{ file: File; preview: string }[]>([]);
  const [isRecognizing, setIsRecognizing] = useState(false);
  const [recognizeError, setRecognizeError] = useState<string | null>(null);
  const [recognizeProgress, setRecognizeProgress] = useState<{ current: number; total: number } | null>(null); // 分批进度
  const textbookInputRef = useRef<HTMLInputElement | null>(null);


  // 导出相关状态
  const [isExportingImages, setIsExportingImages] = useState(false);
  const [isExportingPDF, setIsExportingPDF] = useState(false);

  // 完成状态
  const [isCompleted, setIsCompleted] = useState(false);

  // 图片查看器状态
  const [viewingImageIndex, setViewingImageIndex] = useState<number | null>(null);

  // 任务队列 Hook
  const {
    tasks,
    registerTask,
    updateProgress,
    updateStatus,
    updateTitle,
    updateCover,
    updateStep,
    saveSnapshot,
    currentTask,
  } = useTaskQueue();

  // 防止重复注册任务
  const hasRegisteredTask = useRef(false);
  // 防止在加载任务数据期间同步步骤
  const isLoadingTask = useRef(false);
  // 记录上一次的 projectIdParam，用于检测任务切换
  const lastProjectIdParam = useRef<string | null>(null);

  // 监听 projectIdParam 变化，重置标志以触发重新加载
  useEffect(() => {
    if (projectIdParam !== lastProjectIdParam.current) {
      console.log('检测到任务切换:', lastProjectIdParam.current, '->', projectIdParam);
      // 任务切换，重置标志
      hasRegisteredTask.current = false;
      isLoadingTask.current = true;
      lastProjectIdParam.current = projectIdParam;
    }
  }, [projectIdParam]);

  // 加载已有项目（如果有 id 参数）
  useEffect(() => {
    // 防止重复注册
    if (hasRegisteredTask.current) return;

    // 标记开始加载，防止步骤同步 effect 覆盖目标任务
    isLoadingTask.current = true;

    if (projectIdParam) {
      // 首先检查任务队列中是否已存在该任务
      const existingTask = tasks.find(t => t.id === projectIdParam);
      if (existingTask) {
        // 任务已存在于队列中，从 task.data 恢复数据
        setProjectId(projectIdParam);

        // 恢复表单数据
        if (existingTask.data) {
          const data = existingTask.data;
          if (data.script) setScript(data.script);
          if (data.topics) setTopics(data.topics);
          if (data.plotDirection) setPlotDirection(data.plotDirection);
          if (data.selectedStyle) setSelectedStyle(data.selectedStyle);

          // 恢复步骤：优先使用 data.currentStep，备选使用 existingTask.currentStep
          const stepToRestore = data.currentStep ?? existingTask.currentStep ?? 1;
          console.log('恢复任务步骤:', stepToRestore, '(来自 data:', data.currentStep, ', 来自 task:', existingTask.currentStep, ')');
          setStep(stepToRestore);

          // 恢复场景数据
          if (data.scenes && data.scenes.length > 0) {
            setScenes(data.scenes.map(s => ({
              id: s.id,
              imagePrompt: s.imagePrompt,
              text: s.text,
            })));
          }

          // 恢复角色数据
          if (data.characters && data.characters.length > 0) {
            setCharacters(data.characters.map(c => ({
              id: c.id,
              name: c.name,
              description: c.description,
              images: [],
              savedBase64Images: c.imageBase64List || [],
            })));
          }

          // 恢复生成的图片
          if (data.generatedImages) {
            setGeneratedImages(data.generatedImages);
          }
        } else {
          // 没有 data，但可能任务有 currentStep
          if (existingTask.currentStep) {
            console.log('从任务恢复步骤:', existingTask.currentStep);
            setStep(existingTask.currentStep);
          }
        }

        hasRegisteredTask.current = true;
        // 延迟重置加载标志，确保 setStep 生效后再允许步骤同步
        setTimeout(() => {
          isLoadingTask.current = false;
        }, 100);
        return;
      }

      // 然后检查项目列表
      const project = getProjectById(projectIdParam);
      if (project) {
        setProjectId(project.id);
        setScript(project.script);
        setTopics(project.topics);
        setPlotDirection(project.plotDirection);
        setSelectedStyle(project.selectedStyle);
        setStep(project.currentStep);

        // 转换场景数据
        const loadedScenes: Scene[] = project.scenes.map(s => ({
          id: s.id,
          imagePrompt: s.imagePrompt,
          text: s.text,
        }));
        setScenes(loadedScenes);

        // 加载生成的图片
        const images: { [sceneId: number]: string } = {};
        project.scenes.forEach(s => {
          if (s.imageUrl) {
            images[s.id] = s.imageUrl;
          }
        });
        setGeneratedImages(images);

        // 转换角色数据（恢复保存的 base64 图片）
        const loadedCharacters: Character[] = project.characters.map(c => ({
          id: c.id,
          name: c.name,
          description: c.description,
          images: [], // File 对象无法存储，新上传的图片才会在这里
          savedBase64Images: c.imageBase64List || [], // 恢复保存的 base64 图片
        }));
        if (loadedCharacters.length > 0) {
          setCharacters(loadedCharacters);
        }

        // 注册到任务队列
        registerTask(project.id, {
          title: project.title,
          currentStep: project.currentStep,
          status: project.status === 'completed' ? 'completed' : 'draft',
          coverImage: project.coverImage,
        });
        hasRegisteredTask.current = true;
      } else {
        // 新项目，生成新 ID 并注册到任务队列
        const newId = generateProjectId();
        setProjectId(newId);
        registerTask(newId, {
          title: '新绘本',
          currentStep: 1,
          status: 'draft',
        });
        hasRegisteredTask.current = true;
      }
    } else {
      // 无 id 参数，创建新项目并注册
      const newId = generateProjectId();
      setProjectId(newId);
      registerTask(newId, {
        title: '新绘本',
        currentStep: 1,
        status: 'draft',
      });
      hasRegisteredTask.current = true;
    }
  }, [projectIdParam, registerTask, tasks]);

  // 同步步骤变化到任务队列（跳过加载期间，防止覆盖目标任务的步骤）
  useEffect(() => {
    // 在加载任务数据期间不同步步骤
    if (isLoadingTask.current) {
      console.log('跳过步骤同步（正在加载任务）');
      return;
    }
    if (projectIdParam || projectId) {
      updateStep(step);
    }
  }, [step, projectIdParam, projectId, updateStep]);

  // 注册数据保存回调：当切换任务时，返回当前页面所有表单数据
  useEffect(() => {
    // 注册回调函数，返回当前页面的所有数据
    registerDataSaveCallback((): Partial<TaskData> | null => {
      // 收集当前所有表单数据
      return {
        script,
        topics,
        plotDirection,
        selectedStyle,
        currentStep: step,
        scenes: scenes.map(s => ({
          id: s.id,
          imagePrompt: s.imagePrompt,
          text: s.text,
        })),
        characters: characters.map(c => ({
          id: c.id,
          name: c.name,
          description: c.description,
          imageBase64List: c.savedBase64Images || [],
        })),
        generatedImages,
      };
    });

    // 组件卸载时注销回调
    return () => {
      unregisterDataSaveCallback();
    };
  }, [script, topics, plotDirection, selectedStyle, step, scenes, characters, generatedImages]);

  // 步骤切换包装函数（同时更新本地状态和任务队列）
  const handleStepChange = useCallback((newStep: number) => {
    setStep(newStep);
    // updateStep 会通过上面的 effect 自动同步
  }, []);

  // 键盘快捷键支持（图片查看器翻页）
  useEffect(() => {
    if (viewingImageIndex === null) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // 获取所有已生成图片的分镜索引
      const generatedIndices = scenes
        .map((s, idx) => ({ scene: s, index: idx }))
        .filter(({ scene }) => generatedImages[scene.id])
        .map(({ index }) => index);

      const currentGeneratedIndex = generatedIndices.indexOf(viewingImageIndex);

      if (e.key === "ArrowLeft") {
        e.preventDefault();
        if (currentGeneratedIndex > 0) {
          setViewingImageIndex(generatedIndices[currentGeneratedIndex - 1]);
        }
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        if (currentGeneratedIndex < generatedIndices.length - 1) {
          setViewingImageIndex(generatedIndices[currentGeneratedIndex + 1]);
        }
      } else if (e.key === "Escape") {
        e.preventDefault();
        setViewingImageIndex(null);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [viewingImageIndex, scenes, generatedImages]);

  // 保存草稿
  const handleSaveDraft = async () => {
    setIsSaving(true);
    setSaveSuccess(false);

    try {
      const currentProjectId = projectId || generateProjectId();

      // 转换场景数据
      const projectScenes: ProjectScene[] = scenes.map(s => ({
        id: s.id,
        imagePrompt: s.imagePrompt,
        text: s.text,
        imageUrl: generatedImages[s.id] || undefined,
      }));

      // 转换角色数据
      const projectCharacters: ProjectCharacter[] = await Promise.all(
        characters.map(async (c) => {
          // 将角色图片转换为 base64 存储
          const imageBase64List: string[] = [];
          for (const img of c.images) {
            try {
              const base64 = await fileToBase64(img.file);
              imageBase64List.push(base64);
            } catch (err) {
              console.error("转换角色图片失败:", err);
            }
          }
          return {
            id: c.id,
            name: c.name,
            description: c.description,
            imageBase64List,
          };
        })
      );

      // 获取封面图
      const coverImage = projectScenes.length > 0 ? projectScenes[0].imageUrl : undefined;

      // 判断是否完成
      const isCompleted = scenes.length > 0 &&
        scenes.every(s => generatedImages[s.id]);

      // 获取已有项目的 createdAt，否则使用当前时间戳
      const existingProject = projectId ? getProjectById(projectId) : null;
      const now = Date.now();

      const project: Project = {
        id: currentProjectId,
        title: generateProjectTitle(projectScenes, script),
        status: isCompleted ? "completed" : "draft",
        createdAt: existingProject?.createdAt || now,
        updatedAt: now,
        completedAt: isCompleted ? now : undefined,
        coverImage,
        script,
        topics,
        plotDirection,
        scenes: projectScenes,
        characters: projectCharacters,
        selectedStyle,
        currentStep: step,
      };

      saveProject(project);
      setProjectId(currentProjectId);
      setSaveSuccess(true);

      // 3秒后隐藏成功提示
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err) {
      console.error("保存草稿失败:", err);
      setError("保存草稿失败");
    } finally {
      setIsSaving(false);
    }
  };

  const getApiConfig = () => {
    const savedConfig = localStorage.getItem("api-config");
    if (!savedConfig) {
      return null;
    }
    try {
      const config = JSON.parse(savedConfig);
      return config.text;
    } catch {
      return null;
    }
  };

  const getImageApiConfig = () => {
    const savedConfig = localStorage.getItem("api-config");
    if (!savedConfig) {
      return null;
    }
    try {
      const config = JSON.parse(savedConfig);
      return config.image;
    } catch {
      return null;
    }
  };

  // 将文件转换为 base64
  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = error => reject(error);
    });
  };

  // 生成单个分镜的图片
  const generateSceneImage = async (scene: Scene, sceneIndex: number, previousImageUrl?: string, signal?: AbortSignal) => {
    const imageApiConfig = getImageApiConfig();
    if (!imageApiConfig?.apiUrl || !imageApiConfig?.apiKey || !imageApiConfig?.model || !imageApiConfig?.type) {
      throw new Error("请先在首页配置完整的图片生成 API（包括接口类型、地址、密钥和模型）");
    }

    // 构建角色信息（包含详细描述和参考图的 base64）
    console.log("开始处理角色信息，角色数量:", characters.length);

    const characterInfo = await Promise.all(
      characters
        .filter(c => c.name || c.images.length > 0 || (c.savedBase64Images && c.savedBase64Images.length > 0)) // 有名字、新图片或保存的图片
        .map(async (c) => {
          console.log(`处理角色 "${c.name}"，新图片数量:`, c.images.length, "，保存的图片数量:", c.savedBase64Images?.length || 0);

          // 将新上传的角色参考图转换为 base64
          const imageBase64List: string[] = [];

          // 1. 先添加从项目加载的保存的 base64 图片
          if (c.savedBase64Images && c.savedBase64Images.length > 0) {
            imageBase64List.push(...c.savedBase64Images);
            console.log(`角色 "${c.name}" 添加了 ${c.savedBase64Images.length} 张保存的参考图`);
          }

          // 2. 再添加新上传的图片
          for (const img of c.images) {
            try {
              console.log("正在转换图片，文件存在:", !!img.file, "预览URL:", img.preview?.substring(0, 50));
              const base64 = await fileToBase64(img.file);
              console.log("图片转换成功，base64 长度:", base64.length);
              imageBase64List.push(base64);
            } catch (err) {
              console.error("转换角色图片失败:", err);
            }
          }
          console.log(`角色 "${c.name}" 最终参考图数量:`, imageBase64List.length);
          return {
            name: c.name,
            description: c.description,
            referenceImages: imageBase64List
          };
        })
    );

    console.log("角色信息处理完成，总角色数:", characterInfo.length);
    characterInfo.forEach(c => console.log(`  - ${c.name}: ${c.referenceImages.length} 张参考图`));

    // 从题目或剧情方向提取故事主题
    const storyTitle = topics.split("\n")[0]?.trim() || plotDirection?.substring(0, 50) || "儿童绘本故事";

    const response = await fetch("/api/generate-image", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sceneDescription: scene.imagePrompt,
        storyText: scene.text,
        characters: characterInfo,
        style: selectedStyle,
        sceneIndex: sceneIndex,
        totalScenes: scenes.length,
        storyTitle: storyTitle,
        previousImageUrl: previousImageUrl, // 上一张生成的图片
        imageSize: imageSize,               // 图片尺寸
        imageAspectRatio: imageAspectRatio, // 图片比例
        imageApiConfig,
      }),
      signal, // 传递 AbortSignal 支持中断
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "图片生成失败");
    }

    return data.imageUrl;
  };

  // 开始生成所有分镜图片
  const handleStartGeneration = async () => {
    if (scenes.length === 0) {
      setImageError("请先完成脚本拆分");
      return;
    }

    setImageError(null);
    setIsGeneratingImages(true);
    // 创建新的 AbortController
    abortControllerRef.current = new AbortController();

    // 更新任务状态为“生成中”
    updateStatus('processing');
    updateProgress(0);

    // 用于跟踪本次生成的所有图片
    const newGeneratedImages: { [sceneId: number]: string } = { ...generatedImages };

    try {
      // 逐个生成每个分镜的图片
      let previousImageUrl: string | undefined = undefined;

      for (let i = 0; i < scenes.length; i++) {
        // 检查是否已被中断
        if (abortControllerRef.current?.signal.aborted) {
          console.log("用户暂停了图片生成");
          break;
        }

        const scene = scenes[i];
        const sceneIndex = i + 1; // 从1开始
        setGeneratingSceneId(scene.id);

        try {
          // 传递上一张生成的图片作为参考，同时传递 signal 支持中断
          const imageUrl = await generateSceneImage(scene, sceneIndex, previousImageUrl, abortControllerRef.current?.signal);
          setGeneratedImages(prev => ({
            ...prev,
            [scene.id]: imageUrl,
          }));
          // 记录到本地跟踪对象
          newGeneratedImages[scene.id] = imageUrl;
          // 保存当前图片作为下一个分镜的参考
          previousImageUrl = imageUrl;
          // 成功时从失败列表中移除
          setFailedScenes(prev => {
            const newSet = new Set(prev);
            newSet.delete(scene.id);
            return newSet;
          });

          // 更新任务进度
          const progress = Math.round(((i + 1) / scenes.length) * 100);
          updateProgress(progress);

          // 更新封面图（使用第一张生成的图片）
          if (i === 0) {
            updateCover(imageUrl);
          }
        } catch (err) {
          // 检查是否是用户主动中断
          if (err instanceof Error && err.name === 'AbortError') {
            console.log("用户中断了图片生成");
            break;
          }
          console.error(`生成分镜 ${scene.id} 图片失败:`, err);
          // 继续生成其他分镜，但记录错误
          setImageError(`分镜 ${sceneIndex} 生成失败: ${err instanceof Error ? err.message : "未知错误"}`);
          // 记录失败的分镜
          setFailedScenes(prev => new Set(prev).add(scene.id));
          // 出错时不更新 previousImageUrl，继续使用上一张成功的图
        }
      }

      // 检查是否所有分镜都生成成功
      const allScenesGenerated = scenes.every(s => newGeneratedImages[s.id]);

      console.log("=== 自动保存检查 ===");
      console.log("scenes 数量:", scenes.length);
      console.log("newGeneratedImages:", Object.keys(newGeneratedImages).length);
      console.log("allScenesGenerated:", allScenesGenerated);
      scenes.forEach(s => {
        console.log(`  分镜 ${s.id}: ${newGeneratedImages[s.id] ? "已生成" : "未生成"}`);
      });

      if (allScenesGenerated) {
        console.log("开始执行自动保存...");
        // 所有图片生成完成，自动保存为"已完成"状态
        await autoSaveAsCompleted(newGeneratedImages);
        console.log("自动保存完成");
        // 更新任务状态为已完成
        updateStatus('completed');
        updateProgress(100);
      } else {
        console.log("条件不满足，跳过自动保存");
      }
    } finally {
      setGeneratingSceneId(null);
      setIsGeneratingImages(false);
    }
  };

  // 暂停生成
  const stopGeneration = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
  };

  // 重新生成单个分镜
  const regenerateSingleScene = async (sceneId: number) => {
    const sceneIndex = scenes.findIndex(s => s.id === sceneId);
    if (sceneIndex === -1) return;

    const scene = scenes[sceneIndex];
    setGeneratingSceneId(scene.id);
    setImageError(null);

    try {
      // 找到前一个已生成图片的分镜作为参考
      let previousImageUrl: string | undefined = undefined;
      for (let i = sceneIndex - 1; i >= 0; i--) {
        if (generatedImages[scenes[i].id]) {
          previousImageUrl = generatedImages[scenes[i].id];
          break;
        }
      }

      const imageUrl = await generateSceneImage(scene, sceneIndex + 1, previousImageUrl);
      setGeneratedImages(prev => ({
        ...prev,
        [scene.id]: imageUrl,
      }));
      // 成功时从失败列表中移除
      setFailedScenes(prev => {
        const newSet = new Set(prev);
        newSet.delete(scene.id);
        return newSet;
      });
    } catch (err) {
      console.error(`重新生成分镜 ${sceneIndex + 1} 图片失败:`, err);
      setImageError(`分镜 ${sceneIndex + 1} 重新生成失败: ${err instanceof Error ? err.message : "未知错误"}`);
      setFailedScenes(prev => new Set(prev).add(scene.id));
    } finally {
      setGeneratingSceneId(null);
    }
  };

  // 自动保存为已完成状态
  const autoSaveAsCompleted = async (finalImages: { [sceneId: number]: string }) => {
    try {
      const currentProjectId = projectId || generateProjectId();

      // 转换场景数据
      const projectScenes: ProjectScene[] = scenes.map(s => ({
        id: s.id,
        imagePrompt: s.imagePrompt,
        text: s.text,
        imageUrl: finalImages[s.id] || undefined,
      }));

      // 转换角色数据
      const projectCharacters: ProjectCharacter[] = await Promise.all(
        characters.map(async (c) => {
          const imageBase64List: string[] = [];
          for (const img of c.images) {
            try {
              const base64 = await fileToBase64(img.file);
              imageBase64List.push(base64);
            } catch (err) {
              console.error("转换角色图片失败:", err);
            }
          }
          return {
            id: c.id,
            name: c.name,
            description: c.description,
            imageBase64List,
          };
        })
      );

      // 获取封面图
      const coverImage = projectScenes.length > 0 ? projectScenes[0].imageUrl : undefined;

      // 获取已有项目的 createdAt，否则使用当前时间戳
      const existingProject = projectId ? getProjectById(projectId) : null;
      const now = Date.now();

      const project: Project = {
        id: currentProjectId,
        title: generateProjectTitle(projectScenes, script),
        status: "completed", // 直接设为已完成
        createdAt: existingProject?.createdAt || now,
        updatedAt: now,
        completedAt: now, // 完成时间
        coverImage,
        script,
        topics,
        plotDirection,
        scenes: projectScenes,
        characters: projectCharacters,
        selectedStyle,
        currentStep: step,
      };

      saveProject(project);
      setProjectId(currentProjectId);

      // 设置完成状态
      setIsCompleted(true);

      console.log("项目已自动保存为已完成状态");
    } catch (err) {
      console.error("自动保存失败:", err);
    }
  };

  const handleGenerateScript = async () => {
    setError(null);

    const textApiConfig = getApiConfig();
    if (!textApiConfig?.apiUrl || !textApiConfig?.apiKey || !textApiConfig?.model) {
      setError("请先在首页配置文字生成 API");
      return;
    }

    const topicList = topics.split("\n").filter((t) => t.trim());
    if (topicList.length === 0) {
      setError("请输入至少一道题目");
      return;
    }

    setIsGenerating(true);

    try {
      const response = await fetch("/api/generate-script", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          topics: topicList,
          plotDirection: plotDirection.trim(),
          textApiConfig,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "生成失败");
      }

      // 成功：填入脚本并切换选项卡，让用户先查看完整故事
      setScript(data.script);
      setScenes([]); // 清空分镜，等用户确认后再拆分
      setActiveTab("upload");
    } catch (err) {
      setError(err instanceof Error ? err.message : "生成脚本时发生错误");
    } finally {
      setIsGenerating(false);
    }
  };

  const handleSplitScript = async () => {
    setSplitError(null);

    if (!script.trim()) {
      setSplitError("请先输入故事脚本");
      return;
    }

    // 1. 尝试本地强规则解析
    const localScenes = parseScenesFromText(script);

    // 判定解析是否有效的标准：至少解析出了 1 个分镜，且内容不为空
    const isLocalParseValid = localScenes.length > 0 &&
      localScenes.every(s => s.imagePrompt && s.text);

    if (isLocalParseValid) {
      console.log("检测到结构化脚本，采用本地解析模式");
      setScenes(localScenes);
      // 不需要调用 AI，直接返回
      return;
    }

    // 2. 如果本地解析无结果（说明是纯文本），再调用 AI 进行拆分
    console.log("未检测到标准格式，切换到 AI 智能拆分模式");

    const textApiConfig = getApiConfig();
    if (!textApiConfig?.apiUrl || !textApiConfig?.apiKey || !textApiConfig?.model) {
      setSplitError("请先在首页配置文字生成 API");
      return;
    }

    setIsSplitting(true);

    try {
      const response = await fetch("/api/split-script", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          script: script.trim(),
          storyboardCount: splitStoryboardCount,
          keepOriginal,
          textApiConfig,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "拆分失败");
      }

      // 转换 API 返回的数据格式
      const parsedScenes: Scene[] = data.storyboards.map((sb: { id: number; sceneDescription: string; storyText: string }) => ({
        id: sb.id,
        imagePrompt: sb.sceneDescription,
        text: sb.storyText,
      }));
      setScenes(parsedScenes);
    } catch (err) {
      setSplitError(err instanceof Error ? err.message : "拆分脚本时发生错误");
    } finally {
      setIsSplitting(false);
    }
  };

  // 从文本中解析分镜
  // 增强版解析函数：兼容 AI 返回的 Markdown 格式（如 **画面描述：**）
  const parseScenesFromText = (text: string): Scene[] => {
    const result: Scene[] = [];

    // 增强版正则：兼容 【分镜1】、## 分镜1、以及字段名带 ** 的情况
    const pattern = /(?:【分镜|##\s*分镜)(\d+)(?:】)?[\s\S]*?(?:\*\*|\s)*画面描述(?:\*\*|\s)*[：:]([\s\S]*?)(?:\*\*|\s)*故事文字(?:\*\*|\s)*[：:]([\s\S]*?)(?=(?:【分镜|##\s*分镜|$))/g;

    let match;
    while ((match = pattern.exec(text)) !== null) {
      // 提取并清理数据（去除可能残留的 ** 符号）
      const imagePrompt = match[2].replace(/\*\*/g, '').trim();
      const storyText = match[3].replace(/\*\*/g, '').trim();

      result.push({
        id: parseInt(match[1], 10),
        imagePrompt,
        text: storyText,
      });
    }

    // 调试日志
    if (result.length === 0) {
      console.log("解析失败，正则未匹配到任何内容。原始内容片段:", text.substring(0, 200));
    } else {
      console.log(`解析成功，共找到 ${result.length} 个分镜`);
    }

    return result;
  };

  const updateScene = (id: number, updates: Partial<Scene>) => {
    setScenes((prev) =>
      prev.map((scene) => (scene.id === id ? { ...scene, ...updates } : scene))
    );
  };

  const removeScene = (id: number) => {
    if (scenes.length <= 1) return;
    setScenes((prev) => prev.filter((scene) => scene.id !== id));
  };

  const addScene = () => {
    const maxId = Math.max(...scenes.map((s) => s.id), 0);
    setScenes((prev) => [
      ...prev,
      { id: maxId + 1, imagePrompt: "", text: "" },
    ]);
  };

  const handleResetScenes = () => {
    setScenes([]);
  };

  const updateCharacter = (id: string, updates: Partial<Character>) => {
    setCharacters((prev) =>
      prev.map((char) => (char.id === id ? { ...char, ...updates } : char))
    );
  };

  const addCharacter = () => {
    setCharacters((prev) => [...prev, createEmptyCharacter()]);
  };

  const removeCharacter = (id: string) => {
    setCharacters((prev) => prev.filter((char) => char.id !== id));
  };

  const handleImageUpload = (characterId: string, files: FileList | null) => {
    if (!files) return;

    const character = characters.find((c) => c.id === characterId);
    if (!character) return;

    const remainingSlots = 3 - character.images.length;
    const filesToAdd = Array.from(files).slice(0, remainingSlots);

    const newImages = filesToAdd.map((file) => ({
      file,
      preview: URL.createObjectURL(file),
    }));

    updateCharacter(characterId, {
      images: [...character.images, ...newImages],
    });
  };

  const removeImage = (characterId: string, imageIndex: number) => {
    const character = characters.find((c) => c.id === characterId);
    if (!character) return;

    URL.revokeObjectURL(character.images[imageIndex].preview);

    updateCharacter(characterId, {
      images: character.images.filter((_, idx) => idx !== imageIndex),
    });
  };

  // 处理课本图片上传
  const handleTextbookImageUpload = (files: FileList | null) => {
    if (!files) return;

    const newImages = Array.from(files).map((file) => ({
      file,
      preview: URL.createObjectURL(file),
    }));

    setTextbookImages((prev) => [...prev, ...newImages]);
  };

  // 删除课本图片
  const removeTextbookImage = (index: number) => {
    setTextbookImages((prev) => {
      const toRemove = prev[index];
      if (toRemove) {
        URL.revokeObjectURL(toRemove.preview);
      }
      return prev.filter((_, i) => i !== index);
    });
  };

  // 清空所有课本图片
  const clearTextbookImages = () => {
    textbookImages.forEach((img) => URL.revokeObjectURL(img.preview));
    setTextbookImages([]);
  };

  // 课本识别并生成脚本（分批处理）
  const handleTextbookRecognize = async () => {
    setRecognizeError(null);
    setRecognizeProgress(null);

    if (textbookImages.length === 0) {
      setRecognizeError("请先上传课本图片");
      return;
    }

    const textApiConfig = getApiConfig();
    if (!textApiConfig?.apiUrl || !textApiConfig?.apiKey || !textApiConfig?.model) {
      setRecognizeError("请先在首页配置文字生成 API（需支持视觉识别）");
      return;
    }

    setIsRecognizing(true);

    try {
      // 将所有图片转换为 base64
      const allImageBase64: { base64: string; size: number }[] = [];
      for (const img of textbookImages) {
        const base64 = await fileToBase64(img.file);
        allImageBase64.push({ base64, size: base64.length });
      }

      // 计算总大小
      const totalSize = allImageBase64.reduce((sum, img) => sum + img.size, 0);
      const totalSizeMB = totalSize / (1024 * 1024);

      // 如果总大小小于 8MB，直接一次性处理
      if (totalSizeMB <= 8) {
        console.log(`图片总大小 ${totalSizeMB.toFixed(2)} MB，一次性处理`);

        const response = await fetch("/api/textbook-to-script", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            images: allImageBase64.map(img => img.base64),
            plotDirection: plotDirection.trim(),
            textApiConfig,
          }),
        });

        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.error || "识别失败");
        }

        setScript(data.script);
        setScenes([]);
        setActiveTab("upload");
        return;
      }

      // 分批处理（每批最多 8MB）
      const MAX_BATCH_SIZE = 8 * 1024 * 1024;
      const batches: string[][] = [];
      let currentBatch: string[] = [];
      let currentBatchSize = 0;

      for (const img of allImageBase64) {
        if (img.size > MAX_BATCH_SIZE) {
          if (currentBatch.length > 0) {
            batches.push(currentBatch);
            currentBatch = [];
            currentBatchSize = 0;
          }
          batches.push([img.base64]);
          continue;
        }

        if (currentBatchSize + img.size > MAX_BATCH_SIZE && currentBatch.length > 0) {
          batches.push(currentBatch);
          currentBatch = [];
          currentBatchSize = 0;
        }

        currentBatch.push(img.base64);
        currentBatchSize += img.size;
      }

      if (currentBatch.length > 0) {
        batches.push(currentBatch);
      }

      console.log(`两阶段处理：共 ${textbookImages.length} 张图片，分成 ${batches.length} 批`);

      // ==================== 阶段 1：分批分析图片 ====================
      const analysisResults: string[] = [];
      const totalSteps = batches.length + 1; // 分析批次数 + 1次最终生成

      for (let i = 0; i < batches.length; i++) {
        // 显示进度：分析阶段
        setRecognizeProgress({
          current: i + 1,
          total: totalSteps,
        });

        console.log(`阶段1: 分析第 ${i + 1}/${batches.length} 批图片...`);

        const response = await fetch("/api/textbook-batch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mode: "analyze",
            images: batches[i],
            batchNumber: i + 1,
            totalBatches: batches.length,
            textApiConfig,
          }),
        });

        const data = await response.json();

        // 速率限制重试
        if (!response.ok && data.error?.includes("rate limit")) {
          console.log(`批次 ${i + 1} 遇到速率限制，等待 30 秒后重试...`);
          await new Promise(resolve => setTimeout(resolve, 30000));
          i--;
          continue;
        }

        if (!response.ok) {
          throw new Error(data.error || `第 ${i + 1} 批分析失败`);
        }

        analysisResults.push(data.analysis);
        console.log(`批次 ${i + 1} 分析完成`);

        // 批次间隔等待（30秒避免触发速率限制）
        if (i < batches.length - 1) {
          console.log(`等待 30 秒后处理下一批...`);
          await new Promise(resolve => setTimeout(resolve, 30000));
        }
      }

      // ==================== 阶段 2：生成完整脚本 ====================
      setRecognizeProgress({
        current: totalSteps,
        total: totalSteps,
      });

      console.log(`阶段2: 根据 ${analysisResults.length} 个分析结果生成完整脚本...`);

      // 等待 30 秒避免速率限制
      console.log(`等待 30 秒后生成完整脚本...`);
      await new Promise(resolve => setTimeout(resolve, 30000));

      const finalResponse = await fetch("/api/textbook-batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "generate",
          analysisResults,
          plotDirection: plotDirection.trim(),
          textApiConfig,
        }),
      });

      const finalData = await finalResponse.json();

      if (!finalResponse.ok) {
        throw new Error(finalData.error || "生成脚本失败");
      }

      // 成功：填入脚本
      setScript(finalData.script);
      setScenes([]);
      setActiveTab("upload");
      console.log("两阶段处理完成！");

    } catch (err) {
      setRecognizeError(err instanceof Error ? err.message : "课本识别时发生错误");
    } finally {
      setIsRecognizing(false);
      setRecognizeProgress(null);
    }
  };

  // 导出所有图片为 ZIP
  const handleExportImages = async () => {
    if (Object.keys(generatedImages).length === 0) {
      alert("没有可导出的图片");
      return;
    }

    setIsExportingImages(true);

    try {
      const zip = new JSZip();
      const folder = zip.folder("绘本图片");

      if (!folder) {
        throw new Error("创建文件夹失败");
      }

      // 按分镜顺序添加图片
      for (let i = 0; i < scenes.length; i++) {
        const scene = scenes[i];
        const imageUrl = generatedImages[scene.id];

        if (imageUrl) {
          // 处理 base64 或 URL 格式的图片
          let imageData: Blob;

          if (imageUrl.startsWith("data:")) {
            // Base64 格式
            const base64Data = imageUrl.split(",")[1];
            const byteCharacters = atob(base64Data);
            const byteNumbers = new Array(byteCharacters.length);
            for (let j = 0; j < byteCharacters.length; j++) {
              byteNumbers[j] = byteCharacters.charCodeAt(j);
            }
            const byteArray = new Uint8Array(byteNumbers);
            imageData = new Blob([byteArray], { type: "image/png" });
          } else {
            // URL 格式，需要 fetch
            const response = await fetch(imageUrl);
            imageData = await response.blob();
          }

          // 文件名格式：分镜01_画面描述前20字.png
          const descPreview = scene.imagePrompt.substring(0, 20).replace(/[\\/:*?"<>|]/g, "");
          const fileName = `分镜${String(i + 1).padStart(2, "0")}_${descPreview}.png`;
          folder.file(fileName, imageData);
        }
      }

      const content = await zip.generateAsync({ type: "blob" });
      const projectName = topics.split("\n")[0]?.trim() || plotDirection?.substring(0, 20) || "绘本";
      saveAs(content, `${projectName}_图片导出.zip`);
    } catch (error) {
      console.error("导出图片失败:", error);
      alert("导出图片失败: " + (error instanceof Error ? error.message : "未知错误"));
    } finally {
      setIsExportingImages(false);
    }
  };

  // 导出为 PDF
  const handleExportPDF = async () => {
    if (Object.keys(generatedImages).length === 0) {
      alert("没有可导出的图片");
      return;
    }

    setIsExportingPDF(true);

    try {
      const pdfDoc = await PDFDocument.create();

      // 按分镜顺序添加页面
      for (let i = 0; i < scenes.length; i++) {
        const scene = scenes[i];
        const imageUrl = generatedImages[scene.id];

        if (imageUrl) {
          // 获取图片数据
          let imageBytes: Uint8Array;

          if (imageUrl.startsWith("data:")) {
            // Base64 格式
            const base64Data = imageUrl.split(",")[1];
            const byteCharacters = atob(base64Data);
            const byteNumbers = new Array(byteCharacters.length);
            for (let j = 0; j < byteCharacters.length; j++) {
              byteNumbers[j] = byteCharacters.charCodeAt(j);
            }
            imageBytes = new Uint8Array(byteNumbers);
          } else {
            // URL 格式
            const response = await fetch(imageUrl);
            const arrayBuffer = await response.arrayBuffer();
            imageBytes = new Uint8Array(arrayBuffer);
          }

          // 嵌入图片（尝试 PNG，如果失败尝试 JPG）
          let image;
          try {
            image = await pdfDoc.embedPng(imageBytes);
          } catch {
            try {
              image = await pdfDoc.embedJpg(imageBytes);
            } catch (embedError) {
              console.error(`分镜 ${i + 1} 图片嵌入失败:`, embedError);
              continue;
            }
          }

          // 创建页面，尺寸与图片相同
          const page = pdfDoc.addPage([image.width, image.height]);
          page.drawImage(image, {
            x: 0,
            y: 0,
            width: image.width,
            height: image.height,
          });
        }
      }

      const pdfBytes = await pdfDoc.save();
      const blob = new Blob([pdfBytes], { type: "application/pdf" });
      const projectName = topics.split("\n")[0]?.trim() || plotDirection?.substring(0, 20) || "绘本";
      saveAs(blob, `${projectName}_绘本.pdf`);
    } catch (error) {
      console.error("导出PDF失败:", error);
      alert("导出PDF失败: " + (error instanceof Error ? error.message : "未知错误"));
    } finally {
      setIsExportingPDF(false);
    }
  };

  // AI 生成角色图片
  const handleGenerateCharacterImage = async (characterId: string) => {
    const character = characters.find((c) => c.id === characterId);
    if (!character) return;

    // 检查是否有角色描述
    if (!character.description.trim()) {
      alert("请先输入角色描述，AI 将根据描述生成角色形象");
      return;
    }

    // 检查图片数量限制
    if (character.images.length >= 3) {
      alert("每个角色最多只能有 3 张参考图");
      return;
    }

    // 读取 API 配置
    const savedConfig = localStorage.getItem("api-config");
    if (!savedConfig) {
      alert("请先在首页配置图片生成 API");
      return;
    }

    const config = JSON.parse(savedConfig);
    const imageApiConfig = config.image;
    if (!imageApiConfig || !imageApiConfig.apiUrl || !imageApiConfig.apiKey || !imageApiConfig.model) {
      alert("图片生成 API 配置不完整，请检查配置");
      return;
    }

    setGeneratingCharacterId(characterId);

    try {
      // 构建角色生成的 prompt
      // 只使用用户的角色描述 + 固定的纯色背景要求（不使用绘本生成的复杂提示词）
      const characterPrompt = `${character.description}

【固定要求】
- 纯色背景（白色、浅灰色或浅蓝色）
- 高清画质
- 角色全身可见`;

      // 发送请求（带超时和重试）
      const maxRetries = 2;
      let lastError: Error | null = null;
      let data: { imageUrl?: string; error?: string } | null = null;

      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 180000); // 180秒超时

        try {
          console.log(`角色图片生成 - 尝试 ${attempt}/${maxRetries}`);
          const response = await fetch("/api/generate-image", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              sceneDescription: characterPrompt,
              storyText: "",
              characters: [],
              style: selectedStyle,
              sceneIndex: 1,
              totalScenes: 1,
              storyTitle: character.name || "角色设计",
              imageApiConfig: imageApiConfig,
              isCharacterGeneration: true, // 标识这是角色生成，后端会跳过绘本提示词包装
            }),
            signal: controller.signal,
          });

          clearTimeout(timeoutId);
          data = await response.json();

          if (!response.ok) {
            throw new Error(data?.error || "生成角色图片失败");
          }

          // 成功则跳出重试循环
          break;
        } catch (error) {
          clearTimeout(timeoutId);
          lastError = error as Error;
          const errorMessage = (error as Error).message || String(error);
          console.error(`尝试 ${attempt}/${maxRetries} 失败:`, errorMessage);

          // 如果是中断错误且不是最后一次尝试，等待后重试
          if (attempt < maxRetries && (errorMessage.includes('abort') || errorMessage.includes('terminated'))) {
            console.log('等待 3 秒后重试...');
            await new Promise(resolve => setTimeout(resolve, 3000));
          } else if (attempt >= maxRetries) {
            throw lastError;
          } else {
            throw error;
          }
        }
      }

      if (data?.imageUrl) {
        // 将生成的图片 URL 转换为 blob，然后创建预览
        let imageBlob: Blob;

        if (data.imageUrl.startsWith("data:")) {
          // Base64 格式
          const base64Data = data.imageUrl.split(",")[1];
          const byteCharacters = atob(base64Data);
          const byteNumbers = new Array(byteCharacters.length);
          for (let i = 0; i < byteCharacters.length; i++) {
            byteNumbers[i] = byteCharacters.charCodeAt(i);
          }
          const byteArray = new Uint8Array(byteNumbers);
          imageBlob = new Blob([byteArray], { type: "image/png" });
        } else {
          // URL 格式，需要 fetch
          const imageResponse = await fetch(data.imageUrl);
          imageBlob = await imageResponse.blob();
        }

        const file = new File([imageBlob], `ai-character-${Date.now()}.png`, { type: "image/png" });
        const preview = URL.createObjectURL(imageBlob);

        updateCharacter(characterId, {
          images: [...character.images, { file, preview }],
        });
      }
    } catch (error) {
      console.error("生成角色图片失败:", error);
      alert(error instanceof Error ? error.message : "生成角色图片失败");
    } finally {
      setGeneratingCharacterId(null);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-blue-50 to-white">
      {/* 顶部导航 */}
      <header className="border-b bg-white/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          {/* 左侧：返回按钮和标题 */}
          <div className="flex items-center gap-4">
            <Link href="/">
              <Button variant="ghost" size="icon">
                <ArrowLeft className="h-5 w-5" />
              </Button>
            </Link>
            <h1 className="text-2xl font-bold text-gray-800">
              {projectId ? "编辑绘本" : "创建新绘本"}
            </h1>
          </div>

          {/* 右侧：保存草稿按钮 */}
          <Button
            variant="outline"
            onClick={handleSaveDraft}
            disabled={isSaving}
            className={saveSuccess ? "border-green-500 text-green-600" : ""}
          >
            {isSaving ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                保存中...
              </>
            ) : saveSuccess ? (
              <>
                <Check className="mr-2 h-4 w-4" />
                已保存
              </>
            ) : (
              <>
                <Save className="mr-2 h-4 w-4" />
                保存草稿
              </>
            )}
          </Button>
        </div>
      </header>

      {/* 主内容区 */}
      <main className="container mx-auto px-4 py-8 max-w-4xl">
        {/* 步骤指示器 */}
        <div className="mb-10">
          <div className="flex items-center justify-center">
            {steps.map((s, index) => (
              <div key={s.id} className="flex items-center">
                {/* 步骤圆圈 */}
                <div className="flex flex-col items-center">
                  <div
                    className={`w-12 h-12 rounded-full flex items-center justify-center border-2 transition-all ${step > s.id
                      ? "bg-green-500 border-green-500 text-white"
                      : step === s.id
                        ? "bg-blue-600 border-blue-600 text-white"
                        : "bg-white border-gray-300 text-gray-400"
                      }`}
                  >
                    {step > s.id ? (
                      <Check className="h-6 w-6" />
                    ) : (
                      <s.icon className="h-5 w-5" />
                    )}
                  </div>
                  <span
                    className={`mt-2 text-sm font-medium whitespace-nowrap ${step >= s.id ? "text-gray-800" : "text-gray-400"
                      }`}
                  >
                    {s.title}
                  </span>
                </div>

                {/* 连接线 */}
                {index < steps.length - 1 && (
                  <div
                    className={`w-20 h-0.5 mx-4 mt-[-24px] ${step > s.id ? "bg-green-500" : "bg-gray-300"
                      }`}
                  />
                )}
              </div>
            ))}
          </div>
        </div>

        {/* 步骤内容 */}
        <div className="space-y-4">
          {/* 第一步：脚本设置 */}
          {step === 1 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <FileText className="h-6 w-6 text-blue-600" />
                  脚本设置
                </CardTitle>
              </CardHeader>
              <CardContent>
                <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
                  <TabsList className="grid w-full grid-cols-3 mb-6">
                    <TabsTrigger value="upload" className="flex items-center gap-2">
                      <Upload className="h-4 w-4" />
                      上传脚本
                    </TabsTrigger>
                    <TabsTrigger value="ai-generate" className="flex items-center gap-2">
                      <Sparkles className="h-4 w-4" />
                      AI 生成脚本
                    </TabsTrigger>
                    <TabsTrigger value="textbook" className="flex items-center gap-2">
                      <BookOpen className="h-4 w-4" />
                      课本转脚本
                    </TabsTrigger>
                  </TabsList>

                  <TabsContent value="upload">
                    <div className="space-y-4">
                      {/* 如果没有分镜数据，显示文本框 */}
                      {scenes.length === 0 ? (
                        <>
                          <div className="space-y-2">
                            <Label htmlFor="script">故事脚本</Label>
                            <Textarea
                              id="script"
                              placeholder="在这里粘贴你的故事脚本..."
                              className="min-h-[300px] max-h-[400px] overflow-y-auto resize-none"
                              value={script}
                              onChange={(e) => setScript(e.target.value)}
                            />
                          </div>
                          <p className="text-sm text-gray-500">
                            提示：粘贴完整的故事内容。可以使用「AI 自动拆分」让 AI 帮你拆分，或在脚本中用 <code className="bg-gray-100 px-1 rounded">---</code> 分隔后点击「手动拆分」。
                          </p>

                          {/* 拆分分镜区域 */}
                          <div className="pt-4 border-t space-y-3">
                            <div className="flex items-center gap-4">
                              <div className="flex items-center gap-2">
                                <Label htmlFor="split-count" className="whitespace-nowrap">拆分为</Label>
                                <Input
                                  id="split-count"
                                  type="number"
                                  min={4}
                                  max={20}
                                  value={splitStoryboardCount}
                                  onChange={(e) => setSplitStoryboardCount(Math.min(20, Math.max(4, parseInt(e.target.value) || 8)))}
                                  className="w-20"
                                />
                                <span className="text-gray-600">个分镜</span>
                              </div>
                              <Button
                                variant="outline"
                                onClick={handleSplitScript}
                                disabled={isSplitting || !script.trim()}
                              >
                                {isSplitting ? (
                                  <>
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                    拆分中...
                                  </>
                                ) : (
                                  <>
                                    <Scissors className="mr-2 h-4 w-4" />
                                    AI 自动拆分
                                  </>
                                )}
                              </Button>
                              <Button
                                variant="outline"
                                onClick={() => {
                                  // 手动拆分：根据分隔符（---、===、空行）拆分脚本
                                  if (!script.trim()) {
                                    setSplitError("请先输入故事脚本");
                                    return;
                                  }

                                  // 支持多种分隔符：---、===、连续两个以上空行
                                  const separatorPattern = /(?:\n\s*---\s*\n|\n\s*===\s*\n|\n{3,})/;
                                  const segments = script.split(separatorPattern).filter(s => s.trim());

                                  if (segments.length <= 1) {
                                    setSplitError("未检测到分隔符。请在脚本中使用 --- 或 === 或连续空行来分隔不同的分镜");
                                    return;
                                  }

                                  const manualScenes: Scene[] = segments.map((segment, index) => ({
                                    id: index + 1,
                                    imagePrompt: "", // 画面描述留空，让用户自己填写
                                    text: segment.trim(),
                                  }));

                                  setScenes(manualScenes);
                                  setSplitError(null);
                                }}
                                disabled={!script.trim()}
                              >
                                <Scissors className="mr-2 h-4 w-4" />
                                手动拆分
                              </Button>
                            </div>
                            <div className="flex items-center gap-2">
                              <input
                                type="checkbox"
                                id="keep-original"
                                checked={keepOriginal}
                                onChange={(e) => setKeepOriginal(e.target.checked)}
                                className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                              />
                              <Label htmlFor="keep-original" className="text-sm text-gray-600 cursor-pointer">
                                保留原始文案（不润色）
                              </Label>
                            </div>
                          </div>

                          {splitError && (
                            <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-600 text-sm">
                              {splitError}
                            </div>
                          )}
                        </>
                      ) : (
                        <>
                          {/* 分镜卡片列表 */}
                          <div className="flex items-center justify-between mb-4">
                            <h3 className="font-semibold text-gray-800">
                              分镜列表（{scenes.length} 个）
                            </h3>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={handleResetScenes}
                            >
                              <RotateCcw className="mr-2 h-4 w-4" />
                              重新拆分
                            </Button>
                          </div>

                          <div className="max-h-[280px] overflow-y-auto pr-2 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:bg-gray-300 [&::-webkit-scrollbar-thumb]:rounded-full">
                            <div className="grid grid-cols-1 gap-4 max-w-4xl mx-auto w-full">
                              {scenes.map((scene, index) => (
                                <Card key={scene.id} className="relative border-gray-200 bg-white">
                                  {/* 删除按钮 */}
                                  {scenes.length > 1 && (
                                    <button
                                      onClick={() => removeScene(scene.id)}
                                      className="absolute top-2 right-2 p-1 rounded-full hover:bg-gray-100 text-gray-400 hover:text-red-500 transition-colors z-10"
                                    >
                                      <X className="h-4 w-4" />
                                    </button>
                                  )}

                                  <CardHeader className="pb-2 pt-3 px-4">
                                    <div className="flex items-center gap-2">
                                      <span className="flex items-center justify-center w-7 h-7 rounded-full bg-blue-600 text-white text-sm font-bold">
                                        {index + 1}
                                      </span>
                                      <CardTitle className="text-sm font-medium text-gray-700">
                                        分镜 {index + 1}
                                      </CardTitle>
                                    </div>
                                  </CardHeader>

                                  <CardContent className="space-y-3 px-4 pb-4">
                                    <div className="space-y-1">
                                      <Label className="text-xs text-gray-500">画面描述</Label>
                                      <Textarea
                                        value={scene.imagePrompt}
                                        onChange={(e) => updateScene(scene.id, { imagePrompt: e.target.value })}
                                        placeholder="描述这一页的画面内容..."
                                        className="min-h-[80px] resize-none text-sm"
                                      />
                                    </div>
                                    <div className="space-y-1">
                                      <Label className="text-xs text-gray-500">故事文字</Label>
                                      <Textarea
                                        value={scene.text}
                                        onChange={(e) => updateScene(scene.id, { text: e.target.value })}
                                        placeholder="显示在绘本上的文字..."
                                        className="min-h-[60px] resize-none text-sm"
                                      />
                                    </div>
                                  </CardContent>
                                </Card>
                              ))}
                            </div>
                          </div>

                          {/* 添加分镜按钮 */}
                          <Button
                            variant="outline"
                            className="w-full border-dashed mt-4"
                            onClick={addScene}
                          >
                            <Plus className="mr-2 h-4 w-4" />
                            添加分镜
                          </Button>
                        </>
                      )}
                    </div>
                  </TabsContent>

                  <TabsContent value="ai-generate">
                    <div className="space-y-6">
                      <div className="space-y-2">
                        <Label htmlFor="topics">输入题目（每行一道）</Label>
                        <Textarea
                          id="topics"
                          placeholder="例如：&#10;3 + 2 = ?&#10;小明有5个苹果，吃了2个，还剩几个？&#10;认识形状：圆形"
                          className="min-h-[120px] resize-none"
                          value={topics}
                          onChange={(e) => setTopics(e.target.value)}
                        />
                        <p className="text-sm text-gray-500">
                          AI 会将以上所有题目融入到一个连贯的故事中，让孩子在阅读中自然遇到这些题目
                        </p>
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="plot-direction">
                          剧情方向描述
                          <span className="text-gray-400 font-normal ml-2">（可选）</span>
                        </Label>
                        <Textarea
                          id="plot-direction"
                          placeholder="描述故事背景和风格，例如：森林冒险主题，主角是一只勇敢的小兔子，画风可爱温馨"
                          className="min-h-[100px] resize-none"
                          value={plotDirection}
                          onChange={(e) => setPlotDirection(e.target.value)}
                        />
                      </div>

                      {error && (
                        <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-600 text-sm">
                          {error}
                        </div>
                      )}

                      <Button
                        className="w-full"
                        size="lg"
                        onClick={handleGenerateScript}
                        disabled={isGenerating}
                      >
                        {isGenerating ? (
                          <>
                            <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                            生成中...
                          </>
                        ) : (
                          <>
                            <Wand2 className="mr-2 h-5 w-5" />
                            生成脚本
                          </>
                        )}
                      </Button>
                    </div>
                  </TabsContent>

                  <TabsContent value="textbook">
                    <div className="space-y-6">
                      <div className="space-y-3">
                        <Label>上传课本图片</Label>
                        <p className="text-sm text-gray-500">
                          上传课本页面的照片或截图，AI 将识别其中的内容并转化为绘本故事脚本
                        </p>

                        {/* 图片预览区 */}
                        <div className="grid grid-cols-4 gap-3">
                          {textbookImages.map((img, index) => (
                            <div
                              key={index}
                              className="relative aspect-[3/4] rounded-lg overflow-hidden border border-gray-200 group"
                            >
                              <img
                                src={img.preview}
                                alt={`课本图片 ${index + 1}`}
                                className="w-full h-full object-cover"
                              />
                              <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors" />
                              <button
                                onClick={() => removeTextbookImage(index)}
                                className="absolute top-1 right-1 p-1 rounded-full bg-black/50 text-white hover:bg-red-500 transition-colors opacity-0 group-hover:opacity-100"
                              >
                                <X className="h-3 w-3" />
                              </button>
                              <div className="absolute bottom-1 left-1 px-1.5 py-0.5 rounded bg-black/50 text-white text-xs">
                                {index + 1}
                              </div>
                            </div>
                          ))}

                          {/* 上传按钮 */}
                          <button
                            onClick={() => textbookInputRef.current?.click()}
                            className="aspect-[3/4] rounded-lg border-2 border-dashed border-gray-300 hover:border-blue-500 hover:bg-blue-50 transition-colors flex flex-col items-center justify-center gap-2 text-gray-400 hover:text-blue-500"
                          >
                            <ImagePlus className="h-8 w-8" />
                            <span className="text-sm">添加图片</span>
                          </button>
                        </div>

                        <input
                          ref={textbookInputRef}
                          type="file"
                          accept="image/*"
                          multiple
                          className="hidden"
                          onChange={(e) => handleTextbookImageUpload(e.target.files)}
                        />

                        {textbookImages.length > 0 && (
                          <div className="flex items-center gap-2">
                            <span className="text-sm text-gray-500">
                              已添加 {textbookImages.length} 张图片
                            </span>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={clearTextbookImages}
                              className="text-red-500 hover:text-red-600 hover:bg-red-50"
                            >
                              <Trash2 className="mr-1 h-3 w-3" />
                              清空
                            </Button>
                          </div>
                        )}
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="textbook-plot-direction">
                          剧情方向描述
                          <span className="text-gray-400 font-normal ml-2">（可选）</span>
                        </Label>
                        <Textarea
                          id="textbook-plot-direction"
                          placeholder="描述故事背景和风格，例如：把数学知识点编成森林冒险主题，主角是一只聪明的小狐狸"
                          className="min-h-[80px] resize-none"
                          value={plotDirection}
                          onChange={(e) => setPlotDirection(e.target.value)}
                        />
                      </div>

                      {recognizeError && (
                        <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-600 text-sm">
                          {recognizeError}
                        </div>
                      )}

                      <Button
                        className="w-full"
                        size="lg"
                        onClick={handleTextbookRecognize}
                        disabled={isRecognizing || textbookImages.length === 0}
                      >
                        {isRecognizing ? (
                          <>
                            <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                            {recognizeProgress
                              ? recognizeProgress.current === recognizeProgress.total
                                ? "生成完整脚本中..."
                                : `分析图片 ${recognizeProgress.current}/${recognizeProgress.total - 1}...`
                              : "识别中..."}
                          </>
                        ) : (
                          <>
                            <BookOpen className="mr-2 h-5 w-5" />
                            识别并生成脚本
                          </>
                        )}
                      </Button>
                    </div>
                  </TabsContent>
                </Tabs>
              </CardContent>
            </Card>
          )}

          {/* 第二步：角色设置 */}
          {step === 2 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2">
                  <Users className="h-6 w-6 text-blue-600" />
                  角色设置
                  <span className="text-sm font-normal text-gray-400">（选填）</span>
                </CardTitle>
                <p className="text-sm text-gray-500 mt-1">
                  如果留白，AI 将根据脚本内容自动生成角色形象
                </p>
              </CardHeader>
              <CardContent className="space-y-4 max-h-[400px] overflow-y-auto [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:bg-gray-300 [&::-webkit-scrollbar-thumb]:rounded-full">
                {characters.map((character, index) => (
                  <Card key={character.id} className="relative border-gray-200">
                    {index > 0 && (
                      <button
                        onClick={() => removeCharacter(character.id)}
                        className="absolute top-3 right-3 p-1 rounded-full hover:bg-gray-100 text-gray-400 hover:text-red-500 transition-colors"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    )}

                    <CardContent className="p-5 space-y-4">
                      <div className="text-sm font-medium text-gray-700">
                        角色 {index + 1}
                      </div>

                      {/* 角色名称和描述并排 */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label htmlFor={`name-${character.id}`}>角色名称</Label>
                          <Input
                            id={`name-${character.id}`}
                            placeholder="例如：小兔子豆豆"
                            value={character.name}
                            onChange={(e) =>
                              updateCharacter(character.id, { name: e.target.value })
                            }
                          />
                        </div>

                        <div className="space-y-2">
                          <Label htmlFor={`desc-${character.id}`}>
                            角色描述
                            <span className="text-xs font-normal text-gray-400 ml-2">
                              AI生成必填
                            </span>
                          </Label>
                          <div
                            onClick={() => {
                              setEditingDescriptionId(character.id);
                              setTempDescription(character.description);
                            }}
                            className="flex items-center min-h-[40px] px-3 py-2 border border-gray-200 rounded-md cursor-pointer hover:border-blue-400 hover:bg-blue-50/50 transition-colors"
                          >
                            {character.description ? (
                              <span className="text-sm text-gray-700 line-clamp-1">{character.description}</span>
                            ) : (
                              <span className="text-sm text-gray-400">点击输入角色描述...</span>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="space-y-2">
                        <div className="flex items-center gap-2">
                          <Label>角色参考图</Label>
                          <span className="text-sm text-gray-400">上传或AI生成（最多3张）</span>
                        </div>

                        <div className="flex flex-wrap gap-3">
                          {character.images.map((img, imgIndex) => (
                            <div
                              key={imgIndex}
                              className="relative w-20 h-20 rounded-lg overflow-hidden border border-gray-200 group"
                            >
                              <img
                                src={img.preview}
                                alt={`角色参考图 ${imgIndex + 1}`}
                                className="w-full h-full object-cover"
                              />
                              {/* 查看大图按钮 */}
                              <button
                                onClick={() => setPreviewImage(img.preview)}
                                className="absolute bottom-1 left-1 p-1 rounded-full bg-black/50 text-white hover:bg-blue-500 transition-colors opacity-0 group-hover:opacity-100"
                              >
                                <Eye className="h-3 w-3" />
                              </button>
                              {/* 删除按钮 */}
                              <button
                                onClick={() => removeImage(character.id, imgIndex)}
                                className="absolute top-1 right-1 p-1 rounded-full bg-black/50 text-white hover:bg-red-500 transition-colors opacity-0 group-hover:opacity-100"
                              >
                                <X className="h-3 w-3" />
                              </button>
                            </div>
                          ))}

                          {character.images.length < 3 && (
                            <>
                              {/* 上传图片按钮 */}
                              <button
                                onClick={() => fileInputRefs.current[character.id]?.click()}
                                className="w-20 h-20 rounded-lg border-2 border-dashed border-gray-300 hover:border-blue-500 hover:bg-blue-50 transition-colors flex flex-col items-center justify-center gap-1 text-gray-400 hover:text-blue-500"
                              >
                                <ImagePlus className="h-5 w-5" />
                                <span className="text-xs">上传</span>
                              </button>

                              {/* AI 生成按钮 */}
                              <button
                                onClick={() => handleGenerateCharacterImage(character.id)}
                                disabled={generatingCharacterId === character.id}
                                className={`w-20 h-20 rounded-lg border-2 border-dashed transition-colors flex flex-col items-center justify-center gap-1 ${generatingCharacterId === character.id
                                  ? "border-purple-400 bg-purple-50 text-purple-500"
                                  : "border-purple-300 hover:border-purple-500 hover:bg-purple-50 text-purple-400 hover:text-purple-600"
                                  }`}
                              >
                                {generatingCharacterId === character.id ? (
                                  <>
                                    <Loader2 className="h-5 w-5 animate-spin" />
                                    <span className="text-xs">生成中</span>
                                  </>
                                ) : (
                                  <>
                                    <Wand2 className="h-5 w-5" />
                                    <span className="text-xs">AI生成</span>
                                  </>
                                )}
                              </button>
                            </>
                          )}

                          <input
                            ref={(el) => {
                              fileInputRefs.current[character.id] = el;
                            }}
                            type="file"
                            accept="image/*"
                            multiple
                            className="hidden"
                            onChange={(e) => handleImageUpload(character.id, e.target.files)}
                          />
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}

                <Button
                  variant="outline"
                  className="w-full border-dashed"
                  onClick={addCharacter}
                >
                  <Plus className="mr-2 h-4 w-4" />
                  添加更多角色
                </Button>
              </CardContent>
            </Card>
          )}

          {/* 第三步：参数设置 */}
          {step === 3 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2">
                  <Palette className="h-6 w-6 text-blue-600" />
                  参数设置
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* 插画风格 */}
                <div className="space-y-2">
                  <Label className="text-sm font-medium">插画风格</Label>
                  <div className="grid grid-cols-2 gap-4">
                    <button
                      onClick={() => setSelectedStyle("pixar")}
                      className={`relative rounded-lg border-2 p-3 transition-all text-left ${selectedStyle === "pixar"
                        ? "border-blue-500 bg-blue-50"
                        : "border-gray-200 hover:border-gray-300"
                        }`}
                    >
                      {selectedStyle === "pixar" && (
                        <div className="absolute top-2 right-2 z-10 bg-blue-500 rounded-full p-0.5">
                          <Check className="h-3 w-3 text-white" />
                        </div>
                      )}
                      <div className="space-y-2">
                        <div className="aspect-video rounded-lg overflow-hidden bg-gray-100">
                          <img src="/styles/pixar.png" alt="3D卡通" className="w-full h-full object-cover" />
                        </div>
                        <div>
                          <h4 className="font-semibold text-gray-800 text-sm">3D卡通风格</h4>
                          <p className="text-xs text-gray-500">3D CGI 渲染，立体生动</p>
                        </div>
                      </div>
                    </button>
                    <button
                      onClick={() => setSelectedStyle("anime")}
                      className={`relative rounded-lg border-2 p-3 transition-all text-left ${selectedStyle === "anime"
                        ? "border-blue-500 bg-blue-50"
                        : "border-gray-200 hover:border-gray-300"
                        }`}
                    >
                      {selectedStyle === "anime" && (
                        <div className="absolute top-2 right-2 z-10 bg-blue-500 rounded-full p-0.5">
                          <Check className="h-3 w-3 text-white" />
                        </div>
                      )}
                      <div className="space-y-2">
                        <div className="aspect-video rounded-lg overflow-hidden bg-gray-100">
                          <img src="/styles/anime.png" alt="动漫" className="w-full h-full object-cover" />
                        </div>
                        <div>
                          <h4 className="font-semibold text-gray-800 text-sm">动漫风格</h4>
                          <p className="text-xs text-gray-500">日系动漫，线条细腻</p>
                        </div>
                      </div>
                    </button>
                  </div>
                </div>

                {/* 图片比例和分辨率 */}
                <div className="grid grid-cols-2 gap-4">
                  {/* 图片比例 */}
                  <div className="space-y-1.5">
                    <Label className="text-sm font-medium">图片比例</Label>
                    <div className="grid grid-cols-3 gap-2">
                      {["1:1", "16:9", "4:3"].map((ratio) => (
                        <button
                          key={ratio}
                          onClick={() => setImageAspectRatio(ratio)}
                          className={`py-1.5 px-2 rounded-lg border-2 text-sm font-medium transition-all ${imageAspectRatio === ratio
                            ? "border-blue-500 bg-blue-50 text-blue-700"
                            : "border-gray-200 text-gray-600 hover:border-gray-300"
                            }`}
                        >
                          {ratio}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* 分辨率 */}
                  <div className="space-y-1.5">
                    <Label className="text-sm font-medium">分辨率</Label>
                    <div className="grid grid-cols-3 gap-2">
                      {["1024x1024", "2048x2048", "4096x4096"].map((size) => (
                        <button
                          key={size}
                          onClick={() => setImageSize(size)}
                          className={`py-1.5 px-2 rounded-lg border-2 text-sm font-medium transition-all ${imageSize === size
                            ? "border-blue-500 bg-blue-50 text-blue-700"
                            : "border-gray-200 text-gray-600 hover:border-gray-300"
                            }`}
                        >
                          {size.split("x")[0]}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* 当前配置摘要 */}
                <div className="p-2 bg-gray-50 rounded-lg">
                  <p className="text-sm text-gray-600">
                    <span className="font-medium">当前配置：</span>
                    {selectedStyle === "pixar" ? "3D卡通风格" : "动漫风格"} · {imageAspectRatio} · {imageSize}
                  </p>
                </div>
              </CardContent>
            </Card>
          )}

          {/* 第四步：生成预览 */}
          {step === 4 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Play className="h-6 w-6 text-blue-600" />
                  生成预览
                </CardTitle>
              </CardHeader>
              <CardContent>
                {scenes.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-16 text-gray-400">
                    <FileText className="h-16 w-16 mb-4" />
                    <p className="text-lg">请先完成脚本拆分</p>
                    <Button
                      variant="outline"
                      className="mt-4"
                      onClick={() => setStep(1)}
                    >
                      返回脚本设置
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-6">
                    {/* 完成提示 */}
                    {isCompleted && (
                      <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-full bg-green-500 flex items-center justify-center">
                              <Check className="h-6 w-6 text-white" />
                            </div>
                            <div>
                              <p className="font-semibold text-green-800">🎉 绘本制作完成！</p>
                              <p className="text-sm text-green-600">项目已自动保存到「已完成」列表</p>
                            </div>
                          </div>
                          <Link href="/">
                            <Button variant="outline" className="border-green-500 text-green-700 hover:bg-green-50">
                              返回首页查看
                            </Button>
                          </Link>
                        </div>
                      </div>
                    )}

                    {/* 生成状态提示 */}
                    {isGeneratingImages && (
                      <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
                        <div className="flex items-center gap-3">
                          <Loader2 className="h-5 w-5 text-blue-600 animate-spin" />
                          <span className="text-blue-700">
                            正在生成分镜 {generatingSceneId} 的插画...（{Object.keys(generatedImages).length}/{scenes.length}）
                          </span>
                        </div>
                      </div>
                    )}

                    {imageError && (
                      <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-600 text-sm">
                        {imageError}
                      </div>
                    )}

                    {/* 分镜预览列表 */}
                    <div className="max-h-[340px] overflow-y-auto pr-2 scroll-smooth snap-y snap-mandatory [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:bg-gray-300 [&::-webkit-scrollbar-thumb]:rounded-full">
                      <div className="grid grid-cols-1 gap-3">
                        {scenes.map((scene, index) => (
                          <Card key={scene.id} className="border-gray-200 snap-start">
                            <div className="grid md:grid-cols-2 gap-3 p-3">
                              {/* 左侧：图片区域 */}
                              <div className="bg-gray-100 flex items-center justify-center relative rounded-lg overflow-hidden group">
                                {generatedImages[scene.id] ? (
                                  <>
                                    <img
                                      src={generatedImages[scene.id]}
                                      alt={`分镜 ${index + 1}`}
                                      className="w-full h-auto rounded-lg"
                                    />
                                    {/* 按钮组 - 悬停显示 */}
                                    <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity z-10">
                                      {/* 查看大图按钮 */}
                                      <button
                                        onClick={() => {
                                          if (generatedImages[scene.id]) {
                                            setViewingImageIndex(index);
                                          }
                                        }}
                                        className="p-2 rounded-full bg-black/50 text-white hover:bg-blue-500 transition-colors"
                                        title="查看大图"
                                      >
                                        <Eye className="h-4 w-4" />
                                      </button>
                                      {/* 重新生成按钮 */}
                                      <button
                                        onClick={() => regenerateSingleScene(scene.id)}
                                        disabled={generatingSceneId !== null}
                                        className="p-2 rounded-full bg-black/50 text-white hover:bg-orange-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                        title="重新生成"
                                      >
                                        <RotateCcw className="h-4 w-4" />
                                      </button>
                                    </div>
                                  </>
                                ) : generatingSceneId === scene.id ? (
                                  <div className="flex flex-col items-center gap-3 text-gray-400 py-8">
                                    <Loader2 className="h-12 w-12 animate-spin" />
                                    <span>生成中...</span>
                                  </div>
                                ) : failedScenes.has(scene.id) ? (
                                  // 生成失败的分镜
                                  <div className="flex flex-col items-center gap-3 text-red-400 py-8">
                                    <X className="h-12 w-12" />
                                    <span className="text-sm">生成失败</span>
                                    <button
                                      onClick={() => regenerateSingleScene(scene.id)}
                                      disabled={generatingSceneId !== null}
                                      className="px-3 py-1.5 rounded-lg bg-red-500 text-white text-sm hover:bg-red-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
                                    >
                                      <RotateCcw className="h-3 w-3" />
                                      重试
                                    </button>
                                  </div>
                                ) : (
                                  <div className="flex flex-col items-center gap-3 text-gray-400 py-8">
                                    <ImagePlus className="h-12 w-12" />
                                    <span>待生成</span>
                                  </div>
                                )}
                              </div>

                              {/* 右侧：文字内容 */}
                              <div>
                                <div className="flex items-center gap-2 mb-3">
                                  <span className="flex items-center justify-center w-7 h-7 rounded-full bg-blue-600 text-white text-sm font-bold">
                                    {index + 1}
                                  </span>
                                  <h4 className="font-medium text-gray-800">分镜 {index + 1}</h4>
                                </div>

                                <div className="space-y-3">
                                  <div>
                                    <p className="text-xs text-gray-500 mb-1">画面描述</p>
                                    <p className="text-sm text-gray-700 bg-gray-50 p-2 rounded">
                                      {scene.imagePrompt || "无描述"}
                                    </p>
                                  </div>
                                  <div>
                                    <p className="text-xs text-gray-500 mb-1">故事文字</p>
                                    <p className="text-sm text-gray-800 font-medium">
                                      {scene.text || "无文字"}
                                    </p>
                                  </div>
                                </div>
                              </div>
                            </div>
                          </Card>
                        ))}
                      </div>
                    </div>

                    {/* 生成进度 */}
                    {Object.keys(generatedImages).length > 0 && (
                      <div className="p-4 bg-gray-50 rounded-lg">
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-gray-600">生成进度</span>
                          <div className="flex items-center gap-3">
                            <span className="font-medium text-gray-800">
                              {Object.keys(generatedImages).length} / {scenes.length} 张
                            </span>
                            {/* 清空所有图片按钮 */}
                            <button
                              onClick={() => {
                                if (window.confirm("确定要清空所有已生成的图片吗？")) {
                                  setGeneratedImages({});
                                  setFailedScenes(new Set());
                                }
                              }}
                              disabled={isGeneratingImages}
                              className="px-2 py-1 text-xs rounded bg-red-100 text-red-600 hover:bg-red-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                              title="清空所有已生成的图片"
                            >
                              清空图片
                            </button>
                          </div>
                        </div>
                        <div className="mt-2 h-2 bg-gray-200 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-green-500 transition-all duration-300"
                            style={{
                              width: `${(Object.keys(generatedImages).length / scenes.length) * 100}%`,
                            }}
                          />
                        </div>
                      </div>
                    )}

                    {/* 导出按钮 */}
                    {Object.keys(generatedImages).length > 0 && (
                      <div className="flex gap-3">
                        <Button
                          variant="outline"
                          className="flex-1"
                          onClick={handleExportImages}
                          disabled={isGeneratingImages || isExportingImages || isExportingPDF}
                        >
                          {isExportingImages ? (
                            <>
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                              打包中...
                            </>
                          ) : (
                            <>
                              <Download className="mr-2 h-4 w-4" />
                              导出图片 (ZIP)
                            </>
                          )}
                        </Button>
                        <Button
                          variant="outline"
                          className="flex-1"
                          onClick={handleExportPDF}
                          disabled={isGeneratingImages || isExportingImages || isExportingPDF}
                        >
                          {isExportingPDF ? (
                            <>
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                              生成中...
                            </>
                          ) : (
                            <>
                              <FileDown className="mr-2 h-4 w-4" />
                              导出 PDF
                            </>
                          )}
                        </Button>
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* 底部按钮 */}
          <div className="flex justify-between">
            {step > 1 ? (
              <Button variant="outline" size="lg" onClick={() => setStep(step - 1)}>
                <ArrowLeft className="mr-2 h-5 w-5" />
                上一步
              </Button>
            ) : (
              <div />
            )}

            {step < 4 ? (
              <Button
                size="lg"
                className="px-8"
                onClick={() => {
                  // 步骤2检查角色是否为空
                  if (step === 2) {
                    const hasCharacterInfo = characters.some(
                      c => c.name.trim() || c.description.trim() || c.images.length > 0
                    );
                    if (!hasCharacterInfo) {
                      setShowCharacterWarning(true);
                      return;
                    }
                  }
                  setStep(step + 1);
                }}
              >
                下一步
                <ArrowRight className="ml-2 h-5 w-5" />
              </Button>
            ) : isGeneratingImages ? (
              // 生成中：显示进度和暂停按钮
              <div className="flex gap-2">
                <Button
                  size="lg"
                  className="px-6 bg-green-600"
                  disabled
                >
                  <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                  生成中...
                </Button>
                <Button
                  size="lg"
                  variant="destructive"
                  className="px-6"
                  onClick={stopGeneration}
                >
                  <X className="mr-2 h-5 w-5" />
                  暂停
                </Button>
              </div>
            ) : (
              // 未生成：显示开始生成按钮
              <Button
                size="lg"
                className="px-8 bg-green-600 hover:bg-green-700"
                onClick={handleStartGeneration}
                disabled={scenes.length === 0}
              >
                <Play className="mr-2 h-5 w-5" />
                开始生成
              </Button>
            )}
          </div>
        </div>
      </main>

      {/* 图片预览弹窗 */}
      <Dialog open={!!previewImage} onOpenChange={() => setPreviewImage(null)}>
        <DialogContent
          className="!fixed !inset-0 !max-w-none !max-h-none !w-screen !h-screen !translate-x-0 !translate-y-0 !top-0 !left-0 !p-0 !rounded-none bg-black/80 border-none flex items-center justify-center backdrop-blur-sm"
          showCloseButton={false}
        >
          <div className="relative w-full h-full flex items-center justify-center p-4">
            {/* 关闭按钮 */}
            <button
              onClick={() => setPreviewImage(null)}
              className="absolute top-4 right-4 z-30 p-2 rounded-full bg-white/20 text-white hover:bg-white/30 transition-colors"
              title="关闭"
            >
              <X className="h-6 w-6" />
            </button>

            {previewImage && (
              <img
                src={previewImage}
                alt="预览大图"
                className="max-w-full max-h-full w-auto h-auto object-contain rounded-lg"
                style={{
                  maxWidth: 'calc(100vw - 6rem)',
                  maxHeight: 'calc(100vh - 6rem)'
                }}
              />
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* 分镜图片查看器（支持翻页） */}
      <Dialog
        open={viewingImageIndex !== null}
        onOpenChange={(open) => {
          if (!open) setViewingImageIndex(null);
        }}
      >
        <DialogContent
          className="!fixed !inset-0 !max-w-none !max-h-none !w-screen !h-screen !translate-x-0 !translate-y-0 !top-0 !left-0 !p-0 !rounded-none bg-black/60 border-none flex items-center justify-center backdrop-blur-sm"
          showCloseButton={false}
        >
          {viewingImageIndex !== null && (() => {
            // 获取所有已生成图片的分镜索引
            const generatedIndices = scenes
              .map((s, idx) => ({ scene: s, index: idx }))
              .filter(({ scene }) => generatedImages[scene.id])
              .map(({ index }) => index);

            // 如果当前索引没有图片，自动跳转到最近的有图片的分镜
            let currentIndex = viewingImageIndex;
            if (!generatedImages[scenes[currentIndex]?.id]) {
              // 找到最近的已生成图片的分镜
              const nearestIndex = generatedIndices.reduce((prev, curr) => {
                return Math.abs(curr - viewingImageIndex) < Math.abs(prev - viewingImageIndex) ? curr : prev;
              }, generatedIndices[0] ?? viewingImageIndex);
              currentIndex = nearestIndex;
              if (currentIndex !== viewingImageIndex) {
                setTimeout(() => setViewingImageIndex(currentIndex), 0);
              }
            }

            const currentScene = scenes[currentIndex];
            const currentImageUrl = currentScene ? generatedImages[currentScene.id] : null;
            const currentGeneratedIndex = generatedIndices.indexOf(currentIndex);
            const totalGenerated = generatedIndices.length;
            const hasPrev = currentGeneratedIndex > 0;
            const hasNext = currentGeneratedIndex < totalGenerated - 1;

            return (
              <div className="relative w-full h-full flex flex-col items-center justify-center p-4">
                {/* 关闭按钮 */}
                <button
                  onClick={() => setViewingImageIndex(null)}
                  className="absolute top-4 right-4 z-30 p-2 rounded-full bg-white/20 text-white hover:bg-white/30 transition-colors"
                  title="关闭"
                >
                  <X className="h-6 w-6" />
                </button>

                {/* 图片容器 - 核心区域，flex-1 占据剩余空间 */}
                <div className="relative flex-1 w-full flex items-center justify-center min-h-0">
                  {currentImageUrl ? (
                    <img
                      src={currentImageUrl}
                      alt={`分镜 ${currentIndex + 1}`}
                      className="max-w-full max-h-full w-auto h-auto object-contain rounded-lg"
                      style={{
                        maxWidth: 'calc(100vw - 6rem)',
                        maxHeight: 'calc(100vh - 8rem)'
                      }}
                    />
                  ) : (
                    <div className="text-white/70 text-center py-20 px-10">
                      <p className="text-lg">该分镜尚未生成图片</p>
                    </div>
                  )}

                  {/* 左侧翻页按钮 */}
                  {hasPrev && (
                    <button
                      onClick={() => {
                        const prevGeneratedIndex = currentGeneratedIndex - 1;
                        if (prevGeneratedIndex >= 0 && generatedIndices[prevGeneratedIndex] !== undefined) {
                          setViewingImageIndex(generatedIndices[prevGeneratedIndex]);
                        }
                      }}
                      className="absolute left-4 top-1/2 -translate-y-1/2 z-20 p-3 rounded-full bg-white/20 text-white hover:bg-blue-500 transition-colors"
                      title="上一张 (←)"
                    >
                      <ChevronLeft className="h-8 w-8" />
                    </button>
                  )}

                  {/* 右侧翻页按钮 */}
                  {hasNext && (
                    <button
                      onClick={() => {
                        const nextGeneratedIndex = currentGeneratedIndex + 1;
                        if (nextGeneratedIndex < totalGenerated && generatedIndices[nextGeneratedIndex] !== undefined) {
                          setViewingImageIndex(generatedIndices[nextGeneratedIndex]);
                        }
                      }}
                      className="absolute right-4 top-1/2 -translate-y-1/2 z-20 p-3 rounded-full bg-white/20 text-white hover:bg-blue-500 transition-colors"
                      title="下一张 (→)"
                    >
                      <ChevronRight className="h-8 w-8" />
                    </button>
                  )}
                </div>

                {/* 底部信息栏 */}
                <div className="flex-shrink-0 mt-4 text-white/80 text-sm bg-white/10 px-6 py-2 rounded-full">
                  <span>
                    第 {currentGeneratedIndex + 1} 页，共 {totalGenerated} 页
                    {currentScene && `（分镜 ${currentIndex + 1}）`}
                  </span>
                </div>
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>

      {/* 角色描述编辑弹窗 */}
      <Dialog
        open={!!editingDescriptionId}
        onOpenChange={(open) => {
          if (!open) {
            setEditingDescriptionId(null);
            setTempDescription("");
          }
        }}
      >
        <DialogContent className="max-w-2xl max-h-[80vh]">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-gray-800">编辑角色描述</h3>
            </div>
            <p className="text-sm text-gray-500">
              详细描述角色的外貌特征，包括：体型、颜色、服装、配饰等，帮助 AI 生成一致的角色形象
            </p>
            <Textarea
              value={tempDescription}
              onChange={(e) => setTempDescription(e.target.value)}
              placeholder="例如：一只可爱的白色小兔子，圆圆的脸蛋，大大的黑眼睛，穿着蓝色的背带裤，头上戴着红色蝴蝶结，有着毛茸茸的短尾巴..."
              className="min-h-[200px] max-h-[400px] resize-none"
            />
            <div className="flex justify-end gap-3">
              <Button
                variant="outline"
                onClick={() => {
                  setEditingDescriptionId(null);
                  setTempDescription("");
                }}
              >
                取消
              </Button>
              <Button
                onClick={() => {
                  if (editingDescriptionId) {
                    updateCharacter(editingDescriptionId, { description: tempDescription });
                  }
                  setEditingDescriptionId(null);
                  setTempDescription("");
                }}
              >
                确认
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* 角色为空警告弹窗 */}
      <Dialog open={showCharacterWarning} onOpenChange={setShowCharacterWarning}>
        <DialogContent className="max-w-md">
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-full bg-yellow-100">
                <Users className="h-6 w-6 text-yellow-600" />
              </div>
              <h3 className="text-lg font-semibold text-gray-800">角色设置为空</h3>
            </div>
            <p className="text-gray-600">
              您尚未设置任何角色信息。继续下一步后，AI 将根据脚本内容自动生成角色形象，但可能无法保证角色的一致性。
            </p>
            <p className="text-sm text-gray-500">
              建议：为获得更好的角色一致性效果，请至少填写角色名称和描述，或上传参考图片。
            </p>
            <div className="flex justify-end gap-3 pt-2">
              <Button
                variant="outline"
                onClick={() => setShowCharacterWarning(false)}
              >
                返回设置
              </Button>
              <Button
                onClick={() => {
                  setShowCharacterWarning(false);
                  setStep(step + 1);
                }}
              >
                继续下一步
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
