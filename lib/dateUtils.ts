// 日期工具函数

/**
 * 判断时间戳是否为今天
 */
export function isToday(timestamp: number): boolean {
    const date = new Date(timestamp);
    const today = new Date();
    return (
        date.getFullYear() === today.getFullYear() &&
        date.getMonth() === today.getMonth() &&
        date.getDate() === today.getDate()
    );
}

/**
 * 判断时间戳是否为昨天
 */
export function isYesterday(timestamp: number): boolean {
    const date = new Date(timestamp);
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    return (
        date.getFullYear() === yesterday.getFullYear() &&
        date.getMonth() === yesterday.getMonth() &&
        date.getDate() === yesterday.getDate()
    );
}

/**
 * 格式化日期分组标题
 * 返回 "今天" / "昨天" / "2023-10-25"
 */
export function formatDateGroup(timestamp: number): string {
    if (isToday(timestamp)) return "今天";
    if (isYesterday(timestamp)) return "昨天";

    const date = new Date(timestamp);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

/**
 * 格式化时间（时:分:秒）
 * 返回 "14:30:45"
 */
export function formatTime(timestamp: number): string {
    const date = new Date(timestamp);
    const hours = String(date.getHours()).padStart(2, "0");
    const minutes = String(date.getMinutes()).padStart(2, "0");
    const seconds = String(date.getSeconds()).padStart(2, "0");
    return `${hours}:${minutes}:${seconds}`;
}

/**
 * 格式化日期时间（用于卡片显示）
 * 今天: "14:30:45"
 * 昨天: "昨天 14:30:45"
 * 更早: "10/25 14:30:45"
 */
export function formatDateTime(timestamp: number): string {
    const time = formatTime(timestamp);
    if (isToday(timestamp)) return time;
    if (isYesterday(timestamp)) return `昨天 ${time}`;

    const date = new Date(timestamp);
    const month = date.getMonth() + 1;
    const day = date.getDate();
    return `${month}/${day} ${time}`;
}

/**
 * 格式化相对时间
 * 返回 "刚刚" / "5分钟前" / "2小时前" / "3天前" / "2023-10-25"
 */
export function formatRelativeTime(timestamp: number): string {
    const now = Date.now();
    const diff = now - timestamp;

    if (diff < 60000) return "刚刚";
    if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`;
    if (diff < 604800000) return `${Math.floor(diff / 86400000)} 天前`;

    const date = new Date(timestamp);
    return date.toLocaleDateString("zh-CN");
}

/**
 * 获取日期的日期键（用于分组）
 * 返回 "YYYY-MM-DD" 格式
 */
export function getDateKey(timestamp: number): string {
    const date = new Date(timestamp);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

/**
 * 将旧的日期字符串转换为时间戳
 * 用于数据迁移兼容
 */
export function migrateDate(date: string | number | undefined): number {
    if (typeof date === "number") return date;
    if (typeof date === "string") {
        const parsed = new Date(date).getTime();
        return isNaN(parsed) ? Date.now() : parsed;
    }
    return Date.now();
}
