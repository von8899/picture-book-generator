"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Settings } from "lucide-react";

interface ApiConfig {
  text: {
    type: string;
    apiUrl: string;
    apiKey: string;
    model: string;
  };
  image: {
    type: string;
    apiUrl: string;
    apiKey: string;
    model: string;
  };
}

const defaultConfig: ApiConfig = {
  text: {
    type: "openai",
    apiUrl: "",
    apiKey: "",
    model: "",
  },
  image: {
    type: "openai",
    apiUrl: "",
    apiKey: "",
    model: "",
  },
};

export function ApiConfigDialog() {
  const [open, setOpen] = useState(false);
  const [config, setConfig] = useState<ApiConfig>(defaultConfig);

  // 加载配置
  useEffect(() => {
    const saved = localStorage.getItem("api-config");
    if (saved) {
      try {
        setConfig(JSON.parse(saved));
      } catch {
        // 解析失败时使用默认配置
      }
    }
  }, []);

  const handleSave = () => {
    localStorage.setItem("api-config", JSON.stringify(config));
    setOpen(false);
  };

  const handleCancel = () => {
    // 恢复保存的配置
    const saved = localStorage.getItem("api-config");
    if (saved) {
      try {
        setConfig(JSON.parse(saved));
      } catch {
        setConfig(defaultConfig);
      }
    } else {
      setConfig(defaultConfig);
    }
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <Settings className="mr-2 h-4 w-4" />
          配置 API
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[550px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>API 配置</DialogTitle>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* 文字生成 API */}
          <div className="space-y-4">
            <h3 className="font-semibold text-gray-800 border-b pb-2">
              文字生成 API
            </h3>

            <div className="grid gap-4">
              <div className="grid gap-2">
                <Label htmlFor="text-type">接口类型</Label>
                <Select
                  value={config.text.type}
                  onValueChange={(value) =>
                    setConfig({
                      ...config,
                      text: { ...config.text, type: value },
                    })
                  }
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="选择接口类型" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="openai">OpenAI 兼容</SelectItem>
                    <SelectItem value="volcengine">火山引擎</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="grid gap-2">
                <Label htmlFor="text-url">API 地址</Label>
                <Input
                  id="text-url"
                  placeholder="https://api.openai.com/v1"
                  value={config.text.apiUrl}
                  onChange={(e) =>
                    setConfig({
                      ...config,
                      text: { ...config.text, apiUrl: e.target.value },
                    })
                  }
                />
              </div>

              <div className="grid gap-2">
                <Label htmlFor="text-key">API Key</Label>
                <Input
                  id="text-key"
                  type="password"
                  placeholder="sk-..."
                  value={config.text.apiKey}
                  onChange={(e) =>
                    setConfig({
                      ...config,
                      text: { ...config.text, apiKey: e.target.value },
                    })
                  }
                />
              </div>

              <div className="grid gap-2">
                <Label htmlFor="text-model">模型名称</Label>
                <Input
                  id="text-model"
                  placeholder="gpt-4"
                  value={config.text.model}
                  onChange={(e) =>
                    setConfig({
                      ...config,
                      text: { ...config.text, model: e.target.value },
                    })
                  }
                />
              </div>
            </div>
          </div>

          {/* 图片生成 API */}
          <div className="space-y-4">
            <h3 className="font-semibold text-gray-800 border-b pb-2">
              图片生成 API
            </h3>

            <div className="grid gap-4">
              <div className="grid gap-2">
                <Label htmlFor="image-type">接口类型</Label>
                <Select
                  value={config.image.type}
                  onValueChange={(value) =>
                    setConfig({
                      ...config,
                      image: { ...config.image, type: value },
                    })
                  }
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="选择接口类型" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="openai">OpenAI 兼容</SelectItem>
                    <SelectItem value="volcengine">火山引擎</SelectItem>
                    <SelectItem value="google-imagen">Google Imagen</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="grid gap-2">
                <Label htmlFor="image-url">API 地址</Label>
                <Input
                  id="image-url"
                  placeholder="https://api.openai.com/v1"
                  value={config.image.apiUrl}
                  onChange={(e) =>
                    setConfig({
                      ...config,
                      image: { ...config.image, apiUrl: e.target.value },
                    })
                  }
                />
              </div>

              <div className="grid gap-2">
                <Label htmlFor="image-key">API Key</Label>
                <Input
                  id="image-key"
                  type="password"
                  placeholder="sk-..."
                  value={config.image.apiKey}
                  onChange={(e) =>
                    setConfig({
                      ...config,
                      image: { ...config.image, apiKey: e.target.value },
                    })
                  }
                />
              </div>

              <div className="grid gap-2">
                <Label htmlFor="image-model">模型名称</Label>
                <Input
                  id="image-model"
                  placeholder={
                    config.image.type === "openai" 
                      ? "dall-e-3" 
                      : config.image.type === "google-imagen"
                        ? "imagen-3.0-generate-001"
                        : "图片生成模型名称"
                  }
                  value={config.image.model}
                  onChange={(e) =>
                    setConfig({
                      ...config,
                      image: { ...config.image, model: e.target.value },
                    })
                  }
                />
                <p className="text-xs text-gray-500">
                  {config.image.type === "openai" && "支持 DALL-E (dall-e-2, dall-e-3) 和 Gemini (gemini-2.0-flash-exp 等) 模型"}
                  {config.image.type === "volcengine" && "请填写火山引擎支持的图片生成模型名称"}
                  {config.image.type === "google-imagen" && "Google 支持的模型：imagen-3.0-generate-001"}
                </p>
              </div>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleCancel}>
            取消
          </Button>
          <Button onClick={handleSave}>保存配置</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

