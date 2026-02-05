import { NextRequest, NextResponse } from "next/server";
import { TEXTBOOK_SYSTEM_PROMPT, buildTextbookUserPrompt } from "@/lib/prompts";

// 增加超时时间到 180 秒（支持多图处理）
export const maxDuration = 180;
export const dynamic = 'force-dynamic';

interface TextApiConfig {
  type: string;
  apiUrl: string;
  apiKey: string;
  model: string;
}

interface RequestBody {
  images: string[]; // base64 图片数组
  plotDirection: string;
  textApiConfig: TextApiConfig;
}

export async function POST(request: NextRequest) {
  try {
    const body: RequestBody = await request.json();
    const { images, plotDirection, textApiConfig } = body;

    // 验证必要参数
    if (!images || images.length === 0) {
      return NextResponse.json(
        { error: "请上传至少一张课本图片" },
        { status: 400 }
      );
    }

    // 计算请求大小（用于调试）
    const totalSize = images.reduce((sum, img) => sum + img.length, 0);
    const totalSizeMB = (totalSize / (1024 * 1024)).toFixed(2);
    console.log(`课本转脚本请求: ${images.length} 张图片, 总大小约 ${totalSizeMB} MB`);

    // 检查图片数量限制（大多数 API 对多图有限制）
    const MAX_IMAGES = 20;
    if (images.length > MAX_IMAGES) {
      return NextResponse.json(
        { error: `图片数量过多（${images.length} 张），最多支持 ${MAX_IMAGES} 张图片。请分批处理。` },
        { status: 400 }
      );
    }

    // 检查请求大小限制（中转 API 通常限制 10MB，留 1MB 余量）
    const MAX_SIZE_MB = 9; // 9MB 安全上限（API 限制 10MB）
    if (parseFloat(totalSizeMB) > MAX_SIZE_MB) {
      // 估算可以上传的图片数量
      const avgSizePerImage = parseFloat(totalSizeMB) / images.length;
      const suggestedMax = Math.floor(MAX_SIZE_MB / avgSizePerImage);
      return NextResponse.json(
        { error: `图片总大小过大（${totalSizeMB} MB），超过 API 的 10MB 限制。当前 ${images.length} 张图片，建议减少到 ${Math.max(1, suggestedMax)} 张以内。` },
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
    const systemPrompt = TEXTBOOK_SYSTEM_PROMPT;
    const userPrompt = buildTextbookUserPrompt(images.length, plotDirection);

    // 根据接口类型调用 API
    if (textApiConfig.type === "openai" || textApiConfig.type === "volcengine") {
      const apiUrl = textApiConfig.apiUrl.endsWith("/")
        ? textApiConfig.apiUrl
        : textApiConfig.apiUrl + "/";

      // 构建消息内容（支持多图）
      const content: Array<{ type: string; text?: string; image_url?: { url: string } }> = [
        { type: "text", text: userPrompt }
      ];

      // 添加所有图片
      for (const imageBase64 of images) {
        content.push({
          type: "image_url",
          image_url: {
            url: imageBase64, // base64 格式：data:image/xxx;base64,...
          }
        });
      }

      // 创建 AbortController 用于超时控制（10 分钟）
      const controller = new AbortController();
      const timeoutMs = 10 * 60 * 1000; // 10 分钟
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      console.log(`开始调用 API: ${apiUrl}chat/completions, 超时设置: ${timeoutMs / 1000} 秒`);
      const startTime = Date.now();

      try {
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
                role: "system",
                content: systemPrompt,
              },
              {
                role: "user",
                content: content,
              },
            ],
            temperature: 0.8,
            max_tokens: 8000,
          }),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        console.log(`API 响应完成，耗时: ${elapsed} 秒, 状态: ${response.status}`);

        if (!response.ok) {
          const errorText = await response.text();
          console.error("API Error:", errorText);
          console.error("Response status:", response.status);

          // 检查请求体过大的错误
          if (response.status === 413 || errorText.includes("too large") || errorText.includes("payload") || errorText.includes("size")) {
            return NextResponse.json(
              { error: `请求体过大。当前上传了 ${images.length} 张图片（约 ${totalSizeMB} MB）。请尝试：1) 减少图片数量 2) 压缩图片 3) 分批处理` },
              { status: 400 }
            );
          }

          // 检查 token/上下文长度限制
          if (errorText.includes("context_length") || errorText.includes("token") || errorText.includes("maximum") || errorText.includes("too long")) {
            return NextResponse.json(
              { error: `图片内容过多，超出了模型的上下文长度限制。当前 ${images.length} 张图片，请减少到 3-5 张后重试。` },
              { status: 400 }
            );
          }

          // 检查超时错误
          if (errorText.includes("timeout") || errorText.includes("timed out") || response.status === 504 || response.status === 408) {
            return NextResponse.json(
              { error: `处理超时。${images.length} 张图片处理时间过长，请减少图片数量后重试。` },
              { status: 408 }
            );
          }

          // 检查是否是模型不支持视觉的错误
          if (errorText.includes("vision") || errorText.includes("image") || errorText.includes("不支持")) {
            return NextResponse.json(
              { error: "当前配置的模型不支持图片识别，请更换为支持视觉能力的模型（如 GPT-4V、通义千问VL、GLM-4V 等）" },
              { status: 400 }
            );
          }

          // 尝试解析 JSON 错误信息
          let detailedError = `API 调用失败: ${response.status} ${response.statusText}`;
          try {
            const errorJson = JSON.parse(errorText);
            if (errorJson.error?.message) {
              detailedError = errorJson.error.message;
            }
          } catch {
            // 使用原始错误文本
            if (errorText.length < 200) {
              detailedError += ` - ${errorText}`;
            }
          }

          return NextResponse.json(
            { error: detailedError },
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
      } catch (fetchError) {
        clearTimeout(timeoutId);
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        console.error(`API 请求失败，耗时: ${elapsed} 秒`, fetchError);

        // 检查是否是超时/中断错误
        if (fetchError instanceof Error) {
          if (fetchError.name === 'AbortError' || fetchError.message.includes('aborted')) {
            return NextResponse.json(
              { error: `请求超时。处理 ${images.length} 张图片（${totalSizeMB} MB）需要较长时间，请减少图片数量后重试。` },
              { status: 408 }
            );
          }
          if (fetchError.message.includes('timeout') || fetchError.message.includes('ETIMEDOUT') || fetchError.message.includes('HeadersTimeout')) {
            return NextResponse.json(
              { error: `网络请求超时。可能原因：1) 图片数量太多 2) 网络不稳定 3) API 服务器繁忙。请稍后重试或减少图片数量。` },
              { status: 408 }
            );
          }
        }

        throw fetchError; // 重新抛出让外层 catch 处理
      }
    } else {
      return NextResponse.json(
        { error: `不支持的接口类型: ${textApiConfig.type}` },
        { status: 400 }
      );
    }
  } catch (error) {
    console.error("Textbook to script error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "服务器内部错误" },
      { status: 500 }
    );
  }
}

