import { NextRequest, NextResponse } from "next/server";
import { TEXTBOOK_ANALYZE_SYSTEM_PROMPT, buildTextbookAnalyzePrompt, buildTextbookFinalScriptPrompt } from "@/lib/prompts";

// 增加超时时间到 180 秒
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
    mode: "analyze" | "generate"; // 模式：分析图片 或 生成脚本
    batchNumber?: number; // 当前批次（分析模式）
    totalBatches?: number; // 总批次数（分析模式）
    analysisResults?: string[]; // 分析结果数组（生成模式）
    plotDirection?: string;
    textApiConfig: TextApiConfig;
}

async function callApi(
    apiUrl: string,
    apiKey: string,
    model: string,
    systemPrompt: string,
    userContent: Array<{ type: string; text?: string; image_url?: { url: string } }>
): Promise<string> {
    const controller = new AbortController();
    const timeoutMs = 5 * 60 * 1000; // 5 分钟
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    const normalizedUrl = apiUrl.endsWith("/") ? apiUrl : apiUrl + "/";

    try {
        const response = await fetch(`${normalizedUrl}chat/completions`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
                model,
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: userContent },
                ],
                temperature: 0.8,
                max_tokens: 8000,
            }),
            signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`API 调用失败: ${response.status} - ${errorText}`);
        }

        const data = await response.json();
        const content = data.choices?.[0]?.message?.content;

        if (!content) {
            throw new Error("AI 未返回有效内容");
        }

        return content;
    } catch (error) {
        clearTimeout(timeoutId);
        throw error;
    }
}

export async function POST(request: NextRequest) {
    try {
        const body: RequestBody = await request.json();
        const { mode, textApiConfig, plotDirection } = body;

        if (!textApiConfig?.apiUrl || !textApiConfig?.apiKey || !textApiConfig?.model) {
            return NextResponse.json(
                { error: "API 配置不完整" },
                { status: 400 }
            );
        }

        // 模式一：分析图片
        if (mode === "analyze") {
            const { images, batchNumber = 1, totalBatches = 1 } = body;

            if (!images || images.length === 0) {
                return NextResponse.json(
                    { error: "请上传图片" },
                    { status: 400 }
                );
            }

            const totalSize = images.reduce((sum, img) => sum + img.length, 0);
            const totalSizeMB = (totalSize / (1024 * 1024)).toFixed(2);
            console.log(`分析图片批次 ${batchNumber}/${totalBatches}: ${images.length} 张图片, 约 ${totalSizeMB} MB`);

            // 构建用户消息（包含图片）
            const userContent: Array<{ type: string; text?: string; image_url?: { url: string } }> = [
                { type: "text", text: buildTextbookAnalyzePrompt(images.length, batchNumber, totalBatches) }
            ];

            for (const imageBase64 of images) {
                userContent.push({
                    type: "image_url",
                    image_url: { url: imageBase64 }
                });
            }

            const analysis = await callApi(
                textApiConfig.apiUrl,
                textApiConfig.apiKey,
                textApiConfig.model,
                TEXTBOOK_ANALYZE_SYSTEM_PROMPT,
                userContent
            );

            return NextResponse.json({ analysis });
        }

        // 模式二：根据分析结果生成完整脚本
        if (mode === "generate") {
            const { analysisResults } = body;

            if (!analysisResults || analysisResults.length === 0) {
                return NextResponse.json(
                    { error: "请提供分析结果" },
                    { status: 400 }
                );
            }

            console.log(`根据 ${analysisResults.length} 个分析结果生成最终脚本`);

            const finalPrompt = buildTextbookFinalScriptPrompt(analysisResults, plotDirection || "");

            const script = await callApi(
                textApiConfig.apiUrl,
                textApiConfig.apiKey,
                textApiConfig.model,
                "你是一位擅长寓教于乐的资深小学老师和绘本作家。",
                [{ type: "text", text: finalPrompt }]
            );

            return NextResponse.json({ script });
        }

        return NextResponse.json(
            { error: `无效的模式: ${mode}` },
            { status: 400 }
        );

    } catch (error) {
        console.error("Textbook batch process error:", error);
        return NextResponse.json(
            { error: error instanceof Error ? error.message : "服务器内部错误" },
            { status: 500 }
        );
    }
}
