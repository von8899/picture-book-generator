import { NextRequest, NextResponse } from "next/server";
import axios, { AxiosError } from "axios";
import https from "https";
import sharp from "sharp";
import {
  getStylePrompt,
  buildPictureBookPagePrompt,
  buildCharacterPrompt,
  Character,
} from "@/lib/prompts";

// Next.js 路由配置 - 增加超时时间
export const maxDuration = 120; // 允许 API 运行 120 秒
export const dynamic = 'force-dynamic';

// 创建带有 keepAlive 的 HTTPS Agent
const httpsAgent = new https.Agent({
  keepAlive: true,
  timeout: 180000, // 3分钟
});

// 带重试机制的 axios 请求函数
async function axiosWithRetry(
  url: string,
  data: object,
  headers: Record<string, string>,
  maxRetries: number = 3,
  baseDelayMs: number = 3000,
  timeoutMs: number = 150000 // 150秒超时
): Promise<{ data: unknown; status: number }> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const startTime = Date.now();
    const requestId = `req_${Date.now()}_${attempt}`;

    // 打印完整请求信息供调试
    console.log(`\n========== 请求开始 [${requestId}] ==========`);
    console.log(`时间: ${new Date().toISOString()}`);
    console.log(`URL: ${url}`);
    console.log(`Method: POST`);
    console.log(`Headers:`, JSON.stringify({
      ...headers,
      "Accept": "application/json",
      "Connection": "close",
      "User-Agent": "CherryStudio/0.1.0 ...",
    }, null, 2));
    console.log(`Body (摘要): prompt长度=${JSON.stringify(data).length}字符`);
    console.log(`Attempt: ${attempt}/${maxRetries}, Timeout: ${timeoutMs / 1000}s`);

    try {
      const response = await axios.post(url, data, {
        headers: {
          ...headers,
          "Accept": "application/json",
          // 强制关闭长连接，防止 Node 重用已失效的 Socket
          "Connection": "close",
          // 伪装成 Cherry Studio (Electron/Chrome) 以匹配中转商的客户端策略
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) CherryStudio/0.1.0 Chrome/120.0.0.0 Electron/28.0.0 Safari/537.36",
        },
        httpsAgent,
        timeout: timeoutMs,
        maxContentLength: Infinity, // 允许大的图片返回
        maxBodyLength: Infinity,
      });

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
      console.log(`Attempt ${attempt} succeeded, status: ${response.status}, 耗时: ${elapsed}s`);
      return { data: response.data, status: response.status };
    } catch (error) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
      lastError = error as Error;
      const axiosError = error as AxiosError;

      // 打印详细错误信息供调试
      console.error(`\n========== 请求失败 [${requestId}] ==========`);
      console.error(`耗时: ${elapsed}s`);
      console.error(`错误消息: ${axiosError.message}`);
      console.error(`错误代码: ${axiosError.code || 'N/A'}`);

      // 详细打印错误响应信息（如果存在）
      if (axiosError.response) {
        console.error(`HTTP状态码: ${axiosError.response.status}`);
        console.error(`响应Headers:`, JSON.stringify(axiosError.response.headers, null, 2));
        console.error("响应Body:", JSON.stringify(axiosError.response.data, null, 2));
      } else {
        console.error(`无HTTP响应 (网络层错误)`);
      }

      const errorMessage = axiosError.message || String(error);
      const isTimeout = errorMessage.includes('timeout') || errorMessage.includes('ETIMEDOUT');
      const isNetworkError = errorMessage.includes('ECONNRESET') ||
        errorMessage.includes('socket') ||
        errorMessage.includes('network') ||
        errorMessage.includes('terminated') ||
        errorMessage.includes('aborted');
      const isRateLimit = axiosError.response?.status === 429;
      // 4xx 错误（客户端错误）通常不重试，除非是 408 (Request Timeout) 或 429 (Too Many Requests)
      const isClientError = axiosError.response && axiosError.response.status >= 400 && axiosError.response.status < 500;
      const shouldRetry = isTimeout || isNetworkError || isRateLimit || (axiosError.response && axiosError.response.status >= 500);

      console.error(`错误分类: ${isTimeout ? 'TIMEOUT' : isNetworkError ? 'NETWORK' : 'OTHER'}`);
      console.error(`是否重试: ${shouldRetry}`);
      console.error(`========== 错误结束 ==========\n`);

      // 如果不应该重试，直接抛出异常
      if (!shouldRetry && isClientError) {
        console.error(`Encountered client error ${axiosError.response?.status}, not retrying.`);
        throw error;
      }

      // 如果是最后一次尝试，不再等待
      if (attempt < maxRetries) {
        const delay = (isRateLimit ? 5000 : baseDelayMs) * Math.pow(2, attempt - 1); // 如果是限流，基础等待时间加长
        console.log(`Waiting ${delay}ms before retry...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError || new Error('All retry attempts failed');
}

/**
 * 压缩 Base64 图片到目标大小
 * @param base64Image Base64 编码的图片（包含 data:image/xxx;base64, 前缀）
 * @param targetSizeBytes 目标大小（字节），默认 1.5MB
 * @returns 压缩后的 Base64 图片
 */
async function compressBase64Image(
  base64Image: string,
  targetSizeBytes: number = 1.5 * 1024 * 1024
): Promise<string> {
  try {
    // 提取 Base64 数据和 MIME 类型
    const matches = base64Image.match(/^data:image\/(\w+);base64,(.+)$/);
    if (!matches) {
      console.warn("无法解析 Base64 图片格式，返回原图");
      return base64Image;
    }

    const imageFormat = matches[1];
    const base64Data = matches[2];
    const originalBuffer = Buffer.from(base64Data, 'base64');
    const originalSizeMB = (originalBuffer.length / 1024 / 1024).toFixed(2);

    console.log(`开始压缩图片：原始大小 ${originalSizeMB} MB，目标大小 ${(targetSizeBytes / 1024 / 1024).toFixed(2)} MB`);

    // 获取图片元信息
    const metadata = await sharp(originalBuffer).metadata();
    const originalWidth = metadata.width || 1024;
    const originalHeight = metadata.height || 1024;

    // 计算需要的缩放比例（基于面积）
    const currentRatio = originalBuffer.length / targetSizeBytes;
    let scaleFactor = 1 / Math.sqrt(currentRatio);
    scaleFactor = Math.max(0.3, Math.min(1, scaleFactor)); // 限制缩放范围 30%-100%

    // 计算新尺寸（保持宽高比）
    let newWidth = Math.round(originalWidth * scaleFactor);
    let newHeight = Math.round(originalHeight * scaleFactor);

    // 确保尺寸不小于 512px
    const minDimension = 512;
    if (newWidth < minDimension && newHeight < minDimension) {
      if (originalWidth >= originalHeight) {
        newWidth = minDimension;
        newHeight = Math.round(minDimension * (originalHeight / originalWidth));
      } else {
        newHeight = minDimension;
        newWidth = Math.round(minDimension * (originalWidth / originalHeight));
      }
    }

    console.log(`缩放尺寸：${originalWidth}x${originalHeight} → ${newWidth}x${newHeight}`);

    // 使用 sharp 压缩图片
    let quality = 80; // 初始质量
    let compressedBuffer: Buffer;
    let attempts = 0;
    const maxAttempts = 5;

    do {
      compressedBuffer = await sharp(originalBuffer)
        .resize(newWidth, newHeight, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality, progressive: true }) // 统一转为 JPEG 以获得更好的压缩
        .toBuffer();

      const compSizeMB = (compressedBuffer.length / 1024 / 1024).toFixed(2);
      console.log(`压缩尝试 ${attempts + 1}：质量 ${quality}%，大小 ${compSizeMB} MB`);

      if (compressedBuffer.length <= targetSizeBytes) {
        break;
      }

      // 如果还是太大，降低质量
      quality -= 15;
      attempts++;
    } while (quality > 20 && attempts < maxAttempts);

    const finalSizeMB = (compressedBuffer.length / 1024 / 1024).toFixed(2);
    console.log(`图片压缩完成：${originalSizeMB} MB → ${finalSizeMB} MB`);

    // 返回压缩后的 Base64
    return `data:image/jpeg;base64,${compressedBuffer.toString('base64')}`;
  } catch (error) {
    console.error("图片压缩失败:", error);
    return base64Image; // 压缩失败则返回原图
  }
}


interface ImageApiConfig {
  type: string;
  apiUrl: string;
  apiKey: string;
  model: string;
  apiEndpoint?: 'images' | 'chat'; // 'images' = /images/generations, 'chat' = /chat/completions
}

// Character 接口已从 @/lib/prompts 导入
// 本地定义一个兼容类型用于 RequestBody
interface LocalCharacter {
  name: string;
  description: string;
  referenceImages?: string[];
}

interface RequestBody {
  sceneDescription: string;  // 画面描述
  storyText: string;         // 故事文字（当前分镜）
  characters: Character[];    // 角色信息
  style: string;              // 风格：pixar 或 anime
  sceneIndex: number;         // 当前分镜索引（从1开始）
  totalScenes: number;        // 总分镜数
  storyTitle?: string;        // 故事标题/主题
  previousImageUrl?: string;  // 上一张生成的图片（用于保持连贯性）
  imageSize?: string;         // 图片尺寸，如 "1024x1024"
  imageAspectRatio?: string;  // 图片比例，如 "1:1", "16:9", "4:3"
  imageApiConfig: ImageApiConfig;
  isCharacterGeneration?: boolean; // 是否是角色生成请求（跳过绘本提示词包装）
}

// 根据比例和基础尺寸计算实际图片尺寸
function calculateImageSize(baseSize: string, aspectRatio: string): { width: number; height: number; sizeString: string } {
  // 解析基础尺寸（取第一个数字作为基准）
  const baseWidth = parseInt(baseSize.split('x')[0]) || 1024;

  // 解析比例
  const [ratioW, ratioH] = aspectRatio.split(':').map(Number);
  const ratio = ratioW / ratioH;

  let width: number;
  let height: number;

  if (ratio >= 1) {
    // 横向或正方形
    width = baseWidth;
    height = Math.round(baseWidth / ratio);
  } else {
    // 竖向
    height = baseWidth;
    width = Math.round(baseWidth * ratio);
  }

  // 确保尺寸是 64 的倍数（很多 AI 模型要求）
  width = Math.round(width / 64) * 64;
  height = Math.round(height / 64) * 64;

  return { width, height, sizeString: `${width}x${height}` };
}

// 以下函数已移至 @/lib/prompts.ts 统一管理:
// - getStylePrompt()
// - buildPictureBookPagePrompt()
// - buildCharacterPrompt()

// 构建场景上下文（增强连贯性）
function buildSceneContext(sceneIndex: number, totalScenes: number, storyTitle?: string): string {
  let context = `[Scene ${sceneIndex} of ${totalScenes}] `;

  if (storyTitle) {
    context += `Story: "${storyTitle}". `;
  }

  // 根据场景位置添加不同的提示
  if (sceneIndex === 1) {
    context += "Opening scene - establish the setting and introduce main character. ";
  } else if (sceneIndex === totalScenes) {
    context += "Final scene - conclusion of the story. ";
  } else {
    context += "Continuation scene - maintain visual continuity with previous scenes. ";
  }

  return context;
}

export async function POST(request: NextRequest) {
  try {
    const body: RequestBody = await request.json();
    const {
      sceneDescription,
      storyText = "",
      characters = [],
      style = "pixar",
      sceneIndex = 1,
      totalScenes = 1,
      storyTitle = "",
      previousImageUrl = "",
      imageSize = "1024x1024",
      imageAspectRatio = "1:1",
      imageApiConfig
    } = body;

    // 计算实际图片尺寸
    const imageDimensions = calculateImageSize(imageSize, imageAspectRatio);
    console.log("Image dimensions:", imageDimensions);

    console.log("Received request:", {
      sceneDescription,
      storyText,
      characters,
      style,
      sceneIndex,
      totalScenes,
      storyTitle,
      imageApiConfig: { ...imageApiConfig, apiKey: "***" }
    });

    // 验证必要参数
    if (!sceneDescription) {
      return NextResponse.json(
        { error: "缺少画面描述" },
        { status: 400 }
      );
    }

    if (!imageApiConfig) {
      return NextResponse.json(
        { error: "缺少图片生成 API 配置" },
        { status: 400 }
      );
    }

    if (!imageApiConfig.apiUrl || !imageApiConfig.apiKey || !imageApiConfig.model) {
      return NextResponse.json(
        { error: `图片生成 API 配置不完整: apiUrl=${!!imageApiConfig.apiUrl}, apiKey=${!!imageApiConfig.apiKey}, model=${!!imageApiConfig.model}` },
        { status: 400 }
      );
    }

    if (!imageApiConfig.type) {
      return NextResponse.json(
        { error: "缺少 API 接口类型配置" },
        { status: 400 }
      );
    }

    // 根据请求类型构建 prompt
    // 如果是角色生成请求，直接使用原始描述（不添加绘本相关的复杂提示词）
    const isCharacterGeneration = body.isCharacterGeneration === true;
    let fullPrompt: string;

    if (isCharacterGeneration) {
      // 角色生成：直接使用用户提供的描述
      fullPrompt = sceneDescription;
      console.log("角色生成模式：使用原始描述");
    } else {
      // 绘本场景生成：构建完整绘本页面的 prompt（包含文字和插图）
      const characterPrompt = buildCharacterPrompt(characters);
      fullPrompt = buildPictureBookPagePrompt(
        sceneDescription,
        storyText,
        style,
        sceneIndex,
        totalScenes,
        storyTitle,
        characterPrompt
      );
    }

    console.log("Generating image with prompt:", fullPrompt.substring(0, 200) + "...");
    console.log("Using API type:", imageApiConfig.type);
    console.log("Using model:", imageApiConfig.model);
    console.log("API URL:", imageApiConfig.apiUrl);

    // 检测是否是 Gemini 模型（通过 chat completions 生成图片）
    const isGeminiModel = imageApiConfig.model.toLowerCase().includes("gemini");
    console.log("Is Gemini model:", isGeminiModel);

    // 根据接口类型调用不同的 API
    if (imageApiConfig.type === "openai" && isGeminiModel) {
      // Gemini 模型图像生成
      // 支持两种端点：chat/completions（默认，兼容性更好）或 images/generations
      const apiUrl = imageApiConfig.apiUrl.endsWith("/")
        ? imageApiConfig.apiUrl
        : imageApiConfig.apiUrl + "/";

      // 默认使用 images/generations 端点
      const useImagesEndpoint = imageApiConfig.apiEndpoint !== 'chat';

      console.log("=== 准备 Gemini 图像生成 ===");
      console.log("使用端点类型:", useImagesEndpoint ? "images/generations" : "chat/completions");

      // 将像素尺寸转换为 sufy 支持的预设值（用于 images 端点）
      const getSufyImageSize = (pixelSize: string): string => {
        const width = parseInt(pixelSize.split('x')[0] || '1024', 10);
        if (width >= 2048) return "4K";
        if (width >= 1280) return "HD";
        return "1K";
      };

      // 收集所有角色的参考图（用于图生图）
      let allReferenceImages: string[] = [];
      const TARGET_IMAGE_SIZE = 1.5 * 1024 * 1024; // 压缩目标：1.5MB
      const MAX_SINGLE_IMAGE_SIZE = 2 * 1024 * 1024; // 单张图片超过 2MB 需要压缩
      const MAX_TOTAL_SIZE = 8 * 1024 * 1024; // 总共 8MB 限制

      // 1. 首先添加角色原始参考图（优先级最高）
      // 对超过 2MB 的图片进行压缩
      let currentSize = 0;
      for (const char of characters) {
        if (char.referenceImages && char.referenceImages.length > 0) {
          for (const refImg of char.referenceImages) {
            let imgToAdd = refImg;
            let imgSize = refImg.length;
            const originalSizeMB = (imgSize / 1024 / 1024).toFixed(2);

            // 如果图片超过 2MB，进行压缩
            if (imgSize > MAX_SINGLE_IMAGE_SIZE) {
              console.log(`角色 "${char.name}" 的参考图较大 (${originalSizeMB} MB)，开始压缩...`);
              try {
                imgToAdd = await compressBase64Image(refImg, TARGET_IMAGE_SIZE);
                imgSize = imgToAdd.length;
                console.log(`角色 "${char.name}" 参考图压缩完成`);
              } catch (err) {
                console.error(`角色 "${char.name}" 参考图压缩失败:`, err);
              }
            }

            const finalSizeMB = (imgSize / 1024 / 1024).toFixed(2);

            // 检查是否超过总大小限制
            if (currentSize + imgSize <= MAX_TOTAL_SIZE) {
              allReferenceImages.push(imgToAdd);
              currentSize += imgSize;
              console.log(`角色 "${char.name}" 添加参考图 (${finalSizeMB} MB)`);
            } else {
              console.log(`跳过角色 "${char.name}" 的一张参考图（已达总大小限制 ${(MAX_TOTAL_SIZE / 1024 / 1024).toFixed(0)} MB）`);
            }
          }
        }
      }

      // 2. 然后添加上一张生成的图片（用于保持场景连贯性）
      if (previousImageUrl && sceneIndex > 1) {
        const prevImgSize = previousImageUrl.length;
        if (currentSize + prevImgSize <= MAX_TOTAL_SIZE) {
          allReferenceImages.push(previousImageUrl);
          currentSize += prevImgSize;
          console.log("添加上一张生成的图片作为参考（保持连贯性）");
        } else {
          console.log("跳过上一张图片（参考图已达大小限制）");
        }
      }

      const totalSizeMB = (currentSize / 1024 / 1024).toFixed(2);
      console.log(`参考图数量: ${allReferenceImages.length}, 总大小约 ${totalSizeMB} MB`);

      // 根据端点类型选择不同的调用方式
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let requestBody: any;
      let endpoint: string;

      if (useImagesEndpoint) {
        // ===== 使用 /images/generations 或 /images/edits 端点 =====
        const hasReferenceImages = allReferenceImages.length > 0;
        endpoint = hasReferenceImages ? "images/edits" : "images/generations";

        console.log("使用接口:", endpoint);

        if (hasReferenceImages) {
          requestBody = {
            model: imageApiConfig.model,
            prompt: fullPrompt,
            image: allReferenceImages,
            image_config: {
              aspect_ratio: imageAspectRatio,
              image_size: getSufyImageSize(imageSize || "1024x1024")
            }
          };
          console.log("使用图生图模式，参考图数量:", allReferenceImages.length);
        } else {
          requestBody = {
            model: imageApiConfig.model,
            prompt: fullPrompt,
            image_config: {
              aspect_ratio: imageAspectRatio,
              image_size: getSufyImageSize(imageSize || "1024x1024")
            }
          };
          console.log("使用文生图模式");
        }
      } else {
        // ===== 使用 /chat/completions 端点（默认，兼容性更好）=====
        endpoint = "chat/completions";

        // 构建消息内容
        type ContentPart = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };
        const messageContent: ContentPart[] = [];

        // 如果有参考图，添加到消息中
        if (allReferenceImages.length > 0) {
          messageContent.push({
            type: "text",
            text: `【角色参考图】以下是角色参考图片，生成的图片中角色外观必须与参考图一致：`
          });

          for (const imgBase64 of allReferenceImages) {
            messageContent.push({
              type: "image_url",
              image_url: { url: imgBase64 }
            });
          }
        }

        // 添加生成指令
        messageContent.push({
          type: "text",
          text: fullPrompt
        });

        // 检测是否需要简单字符串格式（某些中转 API 不支持复杂格式）
        const isGemini3ProImage = imageApiConfig.model.toLowerCase().includes("gemini-3") &&
          imageApiConfig.model.toLowerCase().includes("image");

        if (isGemini3ProImage && allReferenceImages.length === 0) {
          // 无参考图时使用简单字符串格式
          console.log("检测到 Gemini 3 图像模型，使用简单字符串格式");
          requestBody = {
            model: imageApiConfig.model,
            messages: [
              {
                role: "user",
                content: fullPrompt
              }
            ],
          };
        } else {
          // 使用多部分消息格式（支持图片）
          requestBody = {
            model: imageApiConfig.model,
            messages: [
              {
                role: "user",
                content: messageContent
              }
            ],
          };
        }

        console.log("使用 chat/completions 模式");
      }

      console.log("Full API URL:", apiUrl + endpoint);
      console.log("Request Body (prompt):", fullPrompt.substring(0, 200) + "...");

      /*
      // 构建消息内容（包含文字和参考图片）
      type ContentPart = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };
      const messageContent: ContentPart[] = [];
      
      // 1. 添加角色参考图片
      let hasReferenceImages = false;
      console.log("处理角色参考图，角色数量:", characters.length);
      
      // 先添加总体角色一致性要求
      const validCharacters = characters.filter(c => c.referenceImages && c.referenceImages.length > 0);
      if (validCharacters.length > 0) {
        messageContent.push({
          type: "text",
          text: `🔴【最高优先级 - 角色一致性】🔴
      这是第 ${sceneIndex} 个分镜（共 ${totalScenes} 个），以下是本故事的角色参考图。
      ⚠️ 无论是第几个分镜，角色外观必须与参考图100%一致！
      ⚠️ 不要因为分镜位置靠后就忽略角色参考图！
      ⚠️ 每个角色的颜色、服装、体型、面部特征必须完全匹配参考图！`
        });
      }
      
      for (const char of characters) {
        console.log(`角色 "${char.name}" 参考图数量:`, char.referenceImages?.length || 0);
        if (char.referenceImages && char.referenceImages.length > 0) {
          hasReferenceImages = true;
          // 添加角色说明
          const charName = char.name || "主角";
          messageContent.push({
            type: "text",
            text: `【角色参考图 - ${charName}】⚡必须严格参考⚡ 以下是 "${charName}" 的参考图片，在本分镜中这个角色的外观必须与参考图完全一致（颜色、服装、体型、面部特征等一个都不能变）：`
          });
          // 添加角色的参考图片
          for (const imgBase64 of char.referenceImages) {
            messageContent.push({
              type: "image_url",
              image_url: { url: imgBase64 }
            });
          }
          // 如果有描述，添加描述
          if (char.description) {
            messageContent.push({
              type: "text",
              text: `角色"${charName}"的详细描述（必须遵守）：${char.description}`
            });
          }
        }
      }
      
      // 2. 如果有上一张图片，添加作为场景参考
      if (previousImageUrl && sceneIndex > 1) {
        messageContent.push({
          type: "text",
          text: `【上一个场景参考】这是上一个分镜的图片，请保持场景风格、光线、色调的连贯性，并且角色外观必须与上一张图片完全一致：`
        });
        messageContent.push({
          type: "image_url",
          image_url: { url: previousImageUrl }
        });
      }
      
      // 3. 添加生成指令
      const referenceNote = hasReferenceImages
        ? "请严格参考上面提供的角色参考图，保持角色的外观、服装、颜色完全一致。"
        : "";
      const previousSceneNote = (previousImageUrl && sceneIndex > 1)
        ? "请参考上一个场景的图片，保持画面风格和角色外观的连贯性。"
        : "";
      
      // 构建尺寸/比例提示
      const aspectRatioPrompt = (() => {
        const [ratioW, ratioH] = imageAspectRatio.split(':').map(Number);
        const ratio = ratioW / ratioH;
        if (ratio > 1) {
          return `【图片尺寸要求】生成一张 ${imageAspectRatio} 比例的横向图片（宽度大于高度），推荐尺寸 ${imageDimensions.width}x${imageDimensions.height}。`;
        } else if (ratio < 1) {
          return `【图片尺寸要求】生成一张 ${imageAspectRatio} 比例的竖向图片（高度大于宽度），推荐尺寸 ${imageDimensions.width}x${imageDimensions.height}。`;
        } else {
          return `【图片尺寸要求】生成一张 ${imageAspectRatio} 比例的正方形图片，推荐尺寸 ${imageDimensions.width}x${imageDimensions.height}。`;
        }
      })();
      
      // 构建角色一致性强调（针对后续分镜特别强调）
      const characterConsistencyNote = hasReferenceImages
        ? `\n🔴【关键提醒】这是第 ${sceneIndex}/${totalScenes} 个分镜，角色外观必须与上面提供的参考图100%一致！不要因为是后面的分镜就忽略参考图！`
        : "";
      
      messageContent.push({
        type: "text",
        text: `请生成一张专业级的儿童绘本漫画页面，使用对话气泡框呈现角色对话。
      
      ${aspectRatioPrompt}
        
      要求：
      1. 🔴【最重要】角色外观必须与提供的参考图完全一致 - 颜色、服装、体型、面部特征一个都不能变
      2. 🔴【对话呈现】必须使用漫画风格的对话气泡框（speech bubble）来呈现角色对话
      3. 气泡框放在说话角色的旁边，用尾巴指向说话的角色
      4. 整个画面是完整的插图，对话以气泡框形式嵌入画面中
      5. 不要在画面顶部单独设置文字区域，所有对话都通过气泡框呈现
      6. 旁白或叙述性文字可用方形文字框或放在画面边缘
      7. 严格按照指定的图片比例生成，不要生成其他比例的图片
      
      ${referenceNote}${previousSceneNote}${characterConsistencyNote}
      
      ${fullPrompt}`
      });
      
      console.log("Message content parts count:", messageContent.length);
      console.log("Has reference images:", hasReferenceImages);
      console.log("Has previous image:", !!previousImageUrl && sceneIndex > 1);
      
      // 检测是否是 Gemini 3.0 Pro Image Preview 模型（某些中转 API 只支持简单字符串格式）
      const isGemini3ProImage = imageApiConfig.model.toLowerCase().includes("gemini-3") &&
        imageApiConfig.model.toLowerCase().includes("image");
      
      // 构建请求体
      let requestBody;
      
      if (isGemini3ProImage) {
        // Gemini 3.0 Pro Image Preview 模型需要简单的字符串格式
        // 这些中转 API（如 cufy.com）不支持复杂的多部分消息
        console.log("检测到 Gemini 3.0 Pro Image 模型，使用简单字符串格式");
      
        // 只使用最后一个文本内容（完整的提示词）
        const textContent = messageContent
          .filter((part): part is { type: "text"; text: string } => part.type === "text")
          .map(part => part.text)
          .join("\n\n");
      
        requestBody = {
          model: imageApiConfig.model,
          messages: [
            {
              role: "user",
              content: textContent // 简单字符串格式
            }
          ],
        };
      
        console.log("Text content length:", textContent.length);
      } else {
        // 其他模型使用标准的多部分消息格式
        requestBody = {
          model: imageApiConfig.model,
          messages: [
            {
              role: "user",
              content: messageContent // 数组格式
            }
          ],
        };
      }
      
      // 计算请求体大小并记录日志
      const requestBodyString = JSON.stringify(requestBody);
      const requestSizeBytes = new TextEncoder().encode(requestBodyString).length;
      const requestSizeMB = (requestSizeBytes / (1024 * 1024)).toFixed(2);
      console.log(`Request body size: ${requestSizeMB} MB (${requestSizeBytes} bytes)`);
      
      // 检查请求大小是否超过 9MB（留 1MB 余量，API 限制是 10MB）
      const MAX_REQUEST_SIZE = 9 * 1024 * 1024; // 9MB
      if (requestSizeBytes > MAX_REQUEST_SIZE) {
        console.error(`Request size ${requestSizeMB}MB exceeds limit of 9MB`);
        return NextResponse.json(
          { error: `请求数据量过大（${requestSizeMB}MB），超过了 API 的 10MB 限制。请减少角色参考图片的数量或压缩图片大小。` },
          { status: 400 }
        );
      }
      
      // 验证消息内容不为空
      const contentToCheck = isGemini3ProImage
        ? (requestBody.messages[0].content as string)
        : messageContent;
      
      if ((typeof contentToCheck === 'string' && contentToCheck.length === 0) ||
        (Array.isArray(contentToCheck) && contentToCheck.length === 0)) {
        console.error("Message content is empty after building");
        return NextResponse.json(
          { error: "内部错误：消息内容为空" },
          { status: 500 }
        );
      }
      
            */

      // 使用 axios 发送请求（根据是否有参考图选择 /images/edits 或 /images/generations）
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let data: any;
      try {
        const response = await axiosWithRetry(
          `${apiUrl}${endpoint}`,
          requestBody,
          {
            "Connection": "close",
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) CherryStudio/0.1.0 Chrome/120.0.0.0 Electron/28.0.0 Safari/537.36",
            "Content-Type": "application/json",
            "Authorization": `Bearer ${imageApiConfig.apiKey}`,
          }
        );
        data = response.data;
        console.log("Gemini URL:", `${apiUrl}${endpoint}`);
        console.log("Gemini response received, status:", response.status);
      } catch (axiosError) {
        const error = axiosError as any; // Cast to avoid TS issues
        const errorMessage = error.message || "网络请求失败";
        console.error("Gemini API request failed:", errorMessage);

        // 尝试解析响应体中的错误信息
        if (axios.isAxiosError(error) && error.response?.data) {
          console.error("Server error response:", JSON.stringify(error.response.data));
          // 如果服务器返回了具体的错误消息，优先使用它
          const serverMsg = JSON.stringify(error.response.data);
          return NextResponse.json(
            { error: `图片生成失败 (服务器错误): ${serverMsg}` },
            { status: error.response.status || 500 }
          );
        }

        return NextResponse.json(
          { error: `图片生成网络请求失败: ${errorMessage}。请查看控制台获取更多详细信息。` },
          { status: 500 }
        );
      }

      // 截断 JSON 输出，只显示结构
      console.log("Gemini response structure:", JSON.stringify(data, null, 2).substring(0, 500) + "...[truncated]");

      // 从 Gemini 响应中提取图片
      // 不同的中转 API 可能返回不同格式，需要兼容多种情况
      const message = data.choices?.[0]?.message || data.candidates?.[0]?.content;
      let imageUrl = null;

      // 使用 console.error 确保日志一定会显示
      console.error("========================================");
      console.error("=== 开始解析 Gemini 响应 ===");
      console.error("message 存在:", !!message);
      console.error("message.content 类型:", typeof message?.content);
      console.error("message.parts 存在:", !!message?.parts);
      console.error("message.parts 长度:", message?.parts?.length);
      if (message?.parts?.[0]) {
        console.error("parts[0] keys:", Object.keys(message.parts[0]));
        console.error("parts[0].image 存在:", !!message.parts[0].image);
        if (message.parts[0].image) {
          console.error("parts[0].image keys:", Object.keys(message.parts[0].image));
        }
      }
      console.error("========================================");

      if (message) {
        // 格式1: content 是数组（OpenAI 兼容格式）
        if (Array.isArray(message.content)) {
          console.log("检测到 content 为数组，长度:", message.content.length);
          for (const part of message.content) {
            console.log("  part 类型:", part.type, "part keys:", Object.keys(part));

            // OpenAI 风格的 image_url
            if (part.type === "image_url" && part.image_url?.url) {
              imageUrl = part.image_url.url;
              console.log("  -> 找到 image_url 格式");
              break;
            }
            // Anthropic 风格的 image
            if (part.type === "image" && part.source?.data) {
              imageUrl = `data:${part.source.media_type || 'image/png'};base64,${part.source.data}`;
              console.log("  -> 找到 Anthropic image 格式");
              break;
            }
            // Gemini 3.0 Pro Image Preview 实际返回格式: {image: {data: "base64..."}, index: 0} (无 type 字段)
            if (part.image?.data) {
              imageUrl = `data:image/png;base64,${part.image.data}`;
              console.log("  -> 找到 Gemini image.data 格式 (无 type)");
              break;
            }
            // 某些中转 API 返回格式: {image: {image_bytes: "base64..."}, index: 0}
            if (part.image?.image_bytes) {
              imageUrl = `data:image/png;base64,${part.image.image_bytes}`;
              console.log("  -> 找到 Gemini image.image_bytes 格式");
              break;
            }
            // 某些中转 API 直接在 part 中放 base64
            if (part.type === "image" && part.data) {
              imageUrl = `data:image/png;base64,${part.data}`;
              console.log("  -> 找到 image.data 格式");
              break;
            }
            // 直接有 url 字段
            if (part.url) {
              imageUrl = part.url;
              console.log("  -> 找到 part.url 格式");
              break;
            }
            // 直接有 b64_json 字段
            if (part.b64_json) {
              imageUrl = `data:image/png;base64,${part.b64_json}`;
              console.log("  -> 找到 b64_json 格式");
              break;
            }
          }
        }

        // 格式2: content 是字符串，可能包含 base64 数据
        if (!imageUrl && typeof message.content === "string") {
          console.log("检测到 content 为字符串，长度:", message.content.length);
          // 尝试从文本中提取 base64 图片
          const base64Match = message.content.match(/data:image\/[^;]+;base64,[A-Za-z0-9+/=]+/);
          if (base64Match) {
            imageUrl = base64Match[0];
            console.log("  -> 从字符串中提取到 base64 图片");
          }
        }

        // 格式3: Gemini 原生格式 - parts 数组中的 inline_data 或 image
        if (!imageUrl && message.parts) {
          console.error(">>> 进入 message.parts 解析分支，长度:", message.parts.length);
          for (let i = 0; i < message.parts.length; i++) {
            const part = message.parts[i];
            console.error(`>>> 检查 parts[${i}]，keys:`, Object.keys(part));

            // 检查 part.image 存在
            if (part.image) {
              console.error(`>>> parts[${i}].image 存在，keys:`, Object.keys(part.image));
            }

            // inline_data
            if (part.inline_data?.data) {
              const mimeType = part.inline_data.mime_type || 'image/png';
              imageUrl = `data:${mimeType};base64,${part.inline_data.data}`;
              console.error(">>> 找到 inline_data 格式");
              break;
            }
            // inlineData
            if (part.inlineData?.data) {
              const mimeType = part.inlineData.mimeType || 'image/png';
              imageUrl = `data:${mimeType};base64,${part.inlineData.data}`;
              console.error(">>> 找到 inlineData (camelCase) 格式");
              break;
            }
            // Gemini image.image_bytes
            if (part.image?.image_bytes) {
              const mimeType = part.image.mime_type || 'image/png';
              imageUrl = `data:${mimeType};base64,${part.image.image_bytes}`;
              console.error(">>> 成功找到 Gemini parts[].image.image_bytes 格式!");
              console.error(">>> imageUrl 长度:", imageUrl.length);
              break;
            }
            // Gemini image.data
            if (part.image?.data) {
              const mimeType = part.image.mime_type || 'image/png';
              imageUrl = `data:${mimeType};base64,${part.image.data}`;
              console.error(">>> 找到 Gemini parts[].image.data 格式");
              break;
            }
          }
          console.error(">>> message.parts 解析完成，imageUrl 存在:", !!imageUrl);
        }
      }

      // 格式4: 某些中转 API 直接在 data 层级返回图片
      if (!imageUrl && data.data) {
        console.log("检测到 data.data，尝试解析...");
        if (Array.isArray(data.data)) {
          for (const item of data.data) {
            if (item.url) {
              imageUrl = item.url;
              console.log("  -> 找到 data[].url 格式");
              break;
            }
            if (item.b64_json) {
              imageUrl = `data:image/png;base64,${item.b64_json}`;
              console.log("  -> 找到 data[].b64_json 格式");
              break;
            }
          }
        }
      }

      // 格式5: 直接在 response 中返回图片 URL
      if (!imageUrl && data.image_url) {
        imageUrl = data.image_url;
        console.log("找到 data.image_url 格式");
      }
      if (!imageUrl && data.imageUrl) {
        imageUrl = data.imageUrl;
        console.log("找到 data.imageUrl 格式");
      }

      console.log("=== 解析完成，imageUrl 存在:", !!imageUrl, "===");

      if (!imageUrl) {
        console.error("Failed to extract image from Gemini response. Full response:", JSON.stringify(data, null, 2));
        return NextResponse.json(
          { error: "无法从 Gemini 响应中提取图片，请检查模型是否支持图片生成。详细信息请查看服务器控制台日志。" },
          { status: 500 }
        );
      }

      return NextResponse.json({ imageUrl, prompt: fullPrompt });

    } else if (imageApiConfig.type === "openai") {
      // OpenAI DALL-E API
      const apiUrl = imageApiConfig.apiUrl.endsWith("/")
        ? imageApiConfig.apiUrl
        : imageApiConfig.apiUrl + "/";

      const response = await fetch(`${apiUrl}images/generations`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${imageApiConfig.apiKey}`,
        },
        body: JSON.stringify({
          model: imageApiConfig.model,
          prompt: fullPrompt,
          n: 1,
          size: imageDimensions.sizeString,
          quality: "standard",
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error("OpenAI Image API Error:", errorText);
        let errorMessage = `图片生成失败: ${response.status} ${response.statusText}`;
        try {
          const errorJson = JSON.parse(errorText);
          if (errorJson.error?.message) {
            errorMessage = errorJson.error.message;
          }
        } catch {
          // 使用默认错误信息
        }
        return NextResponse.json(
          { error: errorMessage },
          { status: 500 }
        );
      }

      const data = await response.json();
      const imageUrl = data.data?.[0]?.url;

      if (!imageUrl) {
        return NextResponse.json(
          { error: "未获取到生成的图片" },
          { status: 500 }
        );
      }

      return NextResponse.json({ imageUrl, prompt: fullPrompt });

    } else if (imageApiConfig.type === "volcengine") {
      // 火山引擎图片生成 API（示例，需要根据实际 API 调整）
      const apiUrl = imageApiConfig.apiUrl.endsWith("/")
        ? imageApiConfig.apiUrl
        : imageApiConfig.apiUrl + "/";

      const response = await fetch(`${apiUrl}images/generations`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${imageApiConfig.apiKey}`,
        },
        body: JSON.stringify({
          model: imageApiConfig.model,
          prompt: fullPrompt,
          n: 1,
          size: imageDimensions.sizeString,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error("Volcengine Image API Error:", errorText);
        let errorMessage = `图片生成失败: ${response.status} ${response.statusText}`;
        try {
          const errorJson = JSON.parse(errorText);
          if (errorJson.error?.message) {
            errorMessage = errorJson.error.message;
          }
        } catch {
          // 使用默认错误信息
        }
        return NextResponse.json(
          { error: errorMessage },
          { status: 500 }
        );
      }

      const data = await response.json();
      const imageUrl = data.data?.[0]?.url || data.data?.[0]?.b64_json;

      if (!imageUrl) {
        return NextResponse.json(
          { error: "未获取到生成的图片" },
          { status: 500 }
        );
      }

      return NextResponse.json({ imageUrl, prompt: fullPrompt });

    } else if (imageApiConfig.type === "google-imagen") {
      // Google Imagen API（示例结构）
      const response = await fetch(imageApiConfig.apiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${imageApiConfig.apiKey}`,
        },
        body: JSON.stringify({
          instances: [{ prompt: fullPrompt }],
          parameters: {
            sampleCount: 1,
          },
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error("Google Imagen API Error:", errorText);
        let errorMessage = `图片生成失败: ${response.status} ${response.statusText}`;
        try {
          const errorJson = JSON.parse(errorText);
          if (errorJson.error?.message) {
            errorMessage = errorJson.error.message;
          }
        } catch {
          // 使用默认错误信息
        }
        return NextResponse.json(
          { error: errorMessage },
          { status: 500 }
        );
      }

      const data = await response.json();
      const imageBase64 = data.predictions?.[0]?.bytesBase64Encoded;

      if (!imageBase64) {
        return NextResponse.json(
          { error: "未获取到生成的图片" },
          { status: 500 }
        );
      }

      return NextResponse.json({
        imageUrl: `data:image/png;base64,${imageBase64}`,
        prompt: fullPrompt
      });

    } else {
      return NextResponse.json(
        { error: `不支持的接口类型: ${imageApiConfig.type}` },
        { status: 400 }
      );
    }
  } catch (error) {
    console.error("Generate image error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "服务器内部错误" },
      { status: 500 }
    );
  }
}

