/**
 * 任务执行器模块
 * 注册各种任务类型的执行逻辑
 */

import { registerExecutor, ServerTask } from './serverTaskQueue';
import { TEXTBOOK_SYSTEM_PROMPT, buildTextbookUserPrompt } from './prompts';

// 脚本生成执行器
registerExecutor('generate-script', async (task, updateProgress) => {
    const { images, plotDirection, textApiConfig } = task.payload as {
        images: string[];
        plotDirection: string;
        textApiConfig: {
            type: string;
            apiUrl: string;
            apiKey: string;
            model: string;
        };
    };

    updateProgress(10, '准备生成脚本...');

    // 验证参数
    if (!images || images.length === 0) {
        throw new Error('请上传至少一张课本图片');
    }

    if (!textApiConfig?.apiUrl || !textApiConfig?.apiKey) {
        throw new Error('API 配置不完整');
    }

    updateProgress(20, `正在处理 ${images.length} 张图片...`);

    // 构建 API 请求
    const apiUrl = textApiConfig.apiUrl.endsWith('/')
        ? textApiConfig.apiUrl
        : textApiConfig.apiUrl + '/';

    const systemPrompt = TEXTBOOK_SYSTEM_PROMPT;
    const userPrompt = buildTextbookUserPrompt(images.length, plotDirection);

    // 构建消息内容
    const content: Array<{ type: string; text?: string; image_url?: { url: string } }> = [
        { type: 'text', text: userPrompt }
    ];

    for (const imageBase64 of images) {
        content.push({
            type: 'image_url',
            image_url: { url: imageBase64 }
        });
    }

    updateProgress(30, '正在调用 AI 生成脚本...');

    // 调用 API
    const controller = new AbortController();
    const timeoutMs = 10 * 60 * 1000; // 10 分钟
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const response = await fetch(`${apiUrl}chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${textApiConfig.apiKey}`,
            },
            body: JSON.stringify({
                model: textApiConfig.model,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: content },
                ],
                temperature: 0.8,
                max_tokens: 8000,
            }),
            signal: controller.signal,
        });

        clearTimeout(timeoutId);
        updateProgress(80, '正在解析响应...');

        if (!response.ok) {
            const errorText = await response.text();
            console.error('[TaskExecutor] 脚本生成 API 错误:', errorText);
            throw new Error(`API 调用失败: ${response.status}`);
        }

        const data = await response.json();
        const script = data.choices?.[0]?.message?.content;

        if (!script) {
            throw new Error('AI 未返回有效内容');
        }

        updateProgress(100, '脚本生成完成');

        return { script };

    } catch (error) {
        clearTimeout(timeoutId);
        throw error;
    }
});

// 分镜拆分执行器
registerExecutor('split-script', async (task, updateProgress) => {
    const { script, textApiConfig } = task.payload as {
        script: string;
        textApiConfig: {
            type: string;
            apiUrl: string;
            apiKey: string;
            model: string;
        };
    };

    updateProgress(10, '准备拆分分镜...');

    if (!script) {
        throw new Error('请提供脚本内容');
    }

    updateProgress(30, '正在调用 AI 拆分分镜...');

    // 调用分镜拆分 API
    const apiUrl = textApiConfig.apiUrl.endsWith('/')
        ? textApiConfig.apiUrl
        : textApiConfig.apiUrl + '/';

    const response = await fetch(`${apiUrl}chat/completions`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${textApiConfig.apiKey}`,
        },
        body: JSON.stringify({
            model: textApiConfig.model,
            messages: [
                {
                    role: 'system',
                    content: '你是一个专业的绘本分镜师，请将用户提供的脚本拆分成多个分镜场景。'
                },
                {
                    role: 'user',
                    content: `请将以下脚本拆分成分镜：\n\n${script}`
                }
            ],
            temperature: 0.7,
            max_tokens: 4000,
        }),
    });

    updateProgress(70, '正在解析分镜...');

    if (!response.ok) {
        throw new Error(`分镜拆分失败: ${response.status}`);
    }

    const data = await response.json();
    const result = data.choices?.[0]?.message?.content;

    updateProgress(100, '分镜拆分完成');

    return { scenes: result };
});

console.log('[TaskExecutor] 任务执行器已注册');
