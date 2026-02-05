import { NextRequest, NextResponse } from "next/server";
import { buildScriptGenerationPrompt } from "@/lib/prompts";

interface TextApiConfig {
  type: string;
  apiUrl: string;
  apiKey: string;
  model: string;
}

interface RequestBody {
  topics: string[];
  plotDirection: string;
  textApiConfig: TextApiConfig;
}

export async function POST(request: NextRequest) {
  try {
    const body: RequestBody = await request.json();
    const { topics, plotDirection, textApiConfig } = body;

    // 验证必要参数
    if (!topics || topics.length === 0) {
      return NextResponse.json(
        { error: "请输入至少一道题目" },
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
    const prompt = buildScriptGenerationPrompt(topics, plotDirection);

    // 根据接口类型调用不同的 API
    if (textApiConfig.type === "openai" || textApiConfig.type === "volcengine") {
      // OpenAI 兼容格式（火山引擎也兼容 OpenAI 格式）
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
          temperature: 0.8,
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
      const generatedScript = data.choices?.[0]?.message?.content;

      if (!generatedScript) {
        return NextResponse.json(
          { error: "AI 未返回有效内容" },
          { status: 500 }
        );
      }

      return NextResponse.json({ script: generatedScript });
    } else {
      return NextResponse.json(
        { error: `不支持的接口类型: ${textApiConfig.type}` },
        { status: 400 }
      );
    }
  } catch (error) {
    console.error("Generate script error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "服务器内部错误" },
      { status: 500 }
    );
  }
}

