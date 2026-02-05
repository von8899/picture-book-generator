// 项目数据类型定义

export interface ProjectScene {
  id: number;
  imagePrompt: string;
  text: string;
  imageUrl?: string;
}

export interface ProjectCharacter {
  id: string;
  name: string;
  description: string;
  // 注意：图片文件不能存储到 localStorage，只存储 base64
  imageBase64List: string[];
}

export interface Project {
  id: string;
  title: string;
  status: "draft" | "completed";
  createdAt: number;      // 创建时间戳
  updatedAt: number;      // 更新时间戳
  completedAt?: number;   // 完成时间戳（仅 completed 状态）
  coverImage?: string;    // 封面图（第一个分镜的图片）

  // 项目数据
  script: string;
  topics: string;
  plotDirection: string;
  scenes: ProjectScene[];
  characters: ProjectCharacter[];
  selectedStyle: string;
  currentStep: number;
}

const PROJECTS_STORAGE_KEY = "picture-book-projects";

// 获取所有项目
export function getAllProjects(): Project[] {
  if (typeof window === "undefined") return [];

  const saved = localStorage.getItem(PROJECTS_STORAGE_KEY);
  if (!saved) return [];

  try {
    return JSON.parse(saved);
  } catch {
    return [];
  }
}

// 获取草稿项目
export function getDraftProjects(): Project[] {
  return getAllProjects().filter(p => p.status === "draft");
}

// 获取完成项目
export function getCompletedProjects(): Project[] {
  return getAllProjects().filter(p => p.status === "completed");
}

// 根据 ID 获取项目
export function getProjectById(id: string): Project | null {
  const projects = getAllProjects();
  return projects.find(p => p.id === id) || null;
}

// 保存项目（新建或更新）
// 如果存储空间满，会自动清理最旧的项目
export function saveProject(project: Project): void {
  const projects = getAllProjects();
  const existingIndex = projects.findIndex(p => p.id === project.id);

  if (existingIndex >= 0) {
    projects[existingIndex] = project;
  } else {
    projects.unshift(project); // 新项目放在最前面
  }

  // 尝试保存，如果空间满则自动清理
  saveProjectsWithAutoCleanup(projects);
}

// 带自动清理的保存函数
function saveProjectsWithAutoCleanup(projects: Project[], maxRetries: number = 5): void {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      localStorage.setItem(PROJECTS_STORAGE_KEY, JSON.stringify(projects));
      return; // 保存成功
    } catch (error) {
      // 检查是否是存储空间满的错误
      if (error instanceof DOMException &&
        (error.name === 'QuotaExceededError' || error.code === 22)) {
        console.warn(`存储空间满，尝试清理旧项目 (尝试 ${attempt + 1}/${maxRetries})`);

        // 如果只剩1个项目或没有项目，无法继续清理
        if (projects.length <= 1) {
          console.error("无法清理更多项目，存储空间仍然不足");
          throw new Error("存储空间不足，请手动删除一些旧项目");
        }

        // 删除最旧的项目（列表末尾的项目）
        const removedProject = projects.pop();
        console.log(`已自动删除旧项目: ${removedProject?.title || removedProject?.id}`);
      } else {
        // 其他类型的错误，直接抛出
        throw error;
      }
    }
  }

  throw new Error("多次尝试后仍无法保存项目，请手动删除一些旧项目");
}

// 删除项目
export function deleteProject(id: string): void {
  const projects = getAllProjects().filter(p => p.id !== id);
  localStorage.setItem(PROJECTS_STORAGE_KEY, JSON.stringify(projects));
}

// 生成项目 ID
export function generateProjectId(): string {
  return `project_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

// 根据场景生成项目标题
export function generateProjectTitle(scenes: ProjectScene[], script: string): string {
  // 尝试从第一个场景的文字中提取标题
  if (scenes.length > 0 && scenes[0].text) {
    const firstText = scenes[0].text;
    // 取前20个字符作为标题
    return firstText.length > 20 ? firstText.substring(0, 20) + "..." : firstText;
  }

  // 从脚本中提取
  if (script) {
    const firstLine = script.split("\n")[0].trim();
    return firstLine.length > 20 ? firstLine.substring(0, 20) + "..." : firstLine;
  }

  return "未命名绘本";
}


