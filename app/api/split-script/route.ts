import { NextRequest, NextResponse } from "next/server";
import { buildSplitScriptStrictPrompt, buildSplitScriptPolishPrompt } from "@/lib/prompts";

interface TextApiConfig {
  type: string;
  apiUrl: string;
  apiKey: string;
  model: string;
}

interface RequestBody {
  script: string;
  storyboardCount: number;
  keepOriginal?: boolean;
  textApiConfig: TextApiConfig;
}

export async function POST(request: NextRequest) {
  try {
    const body: RequestBody = await request.json();
    const { script, storyboardCount = 8, keepOriginal = false, textApiConfig } = body;

    // 验证必要参数
    if (!script || script.trim().length === 0) {
      return NextResponse.json(
        { error: "请输入故事脚本内容" },
        { status: 400 }
      );
    }

    if (!textApiConfig || !textApiConfig.apiUrl || !textApiConfig.apiKey || !textApiConfig.model) {
      return NextResponse.json(
        { error: "API 配置不完整" },
        { status: 400 }
      );
    }

    // 使用集中的提示词配置
    const prompt = keepOriginal
      ? buildSplitScriptStrictPrompt(script, storyboardCount)
      : buildSplitScriptPolishPrompt(script, storyboardCount);

    // 根据接口类型调用不同的 API
    if (textApiConfig.type === "openai" || textApiConfig.type === "volcengine") {
      const apiUrl = textApiConfig.apiUrl.endsWith("/")
        ? textApiConfig.apiUrl
        : textApiConfig.apiUrl + "/";

      const response = await fetch(`${apiUrl}chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${textApiConfig.apiKey}`,
        },
        body: JSON.stringify({
          model: textApiConfig.model,
          messages: [
            {
              role: "user",
              content: prompt,
            },
          ],
          temperature: 0.7,
          max_tokens: 8000,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error("API Error:", errorText);
        return NextResponse.json(
          { error: `API 调用失败: ${response.status} ${response.statusText}` },
          { status: 500 }
        );
      }

      const data = await response.json();
      const generatedContent = data.choices?.[0]?.message?.content;

      if (!generatedContent) {
        return NextResponse.json(
          { error: "AI 未返回有效内容" },
          { status: 500 }
        );
      }

      // 解析分镜内容
      const storyboards = parseStoryboards(generatedContent);

      return NextResponse.json({
        rawContent: generatedContent,
        storyboards
      });
    } else {
      return NextResponse.json(
        { error: `不支持的接口类型: ${textApiConfig.type}` },
        { status: 400 }
      );
    }
  } catch (error) {
    console.error("Split script error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "服务器内部错误" },
      { status: 500 }
    );
  }
}

// 解析分镜内容（增强版：兼容 Markdown 格式）
function parseStoryboards(content: string): { id: number; sceneDescription: string; storyText: string }[] {
  const storyboards: { id: number; sceneDescription: string; storyText: string }[] = [];

  // 增强版正则：兼容 【分镜1】、## 分镜1、以及字段名带 ** 的情况
  const pattern = /(?:【分镜|##\s*分镜)(\d+)(?:】)?[\s\S]*?(?:\*\*|\s)*画面描述(?:\*\*|\s)*[：:]([\s\S]*?)(?:\*\*|\s)*故事文字(?:\*\*|\s)*[：:]([\s\S]*?)(?=(?:【分镜|##\s*分镜|$))/g;

  let match;
  while ((match = pattern.exec(content)) !== null) {
    const id = parseInt(match[1], 10);
    // 去除可能残留的 ** 符号
    const sceneDescription = match[2].replace(/\*\*/g, '').trim();
    const storyText = match[3].replace(/\*\*/g, '').trim();

    storyboards.push({
      id,
      sceneDescription,
      storyText,
    });
  }

  // 调试日志
  if (storyboards.length === 0) {
    console.log("解析失败，正则未匹配到任何内容。原始内容片段:", content.substring(0, 200));
  } else {
    console.log(`解析成功，共找到 ${storyboards.length} 个分镜`);
  }

  return storyboards;
}

