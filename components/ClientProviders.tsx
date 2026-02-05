"use client";

/**
 * 客户端组件提供者
 * 用于在服务端布局中嵌入客户端组件
 */
export function ClientProviders({ children }: { children: React.ReactNode }) {
    return <>{children}</>;
}
