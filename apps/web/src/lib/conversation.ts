const KEY = 'know-fit:conversation-id';

/** 当前会话 id —— 刷新后按它恢复 */
export function readConversationId(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function writeConversationId(id: string | null): void {
  try {
    if (id) localStorage.setItem(KEY, id);
    else localStorage.removeItem(KEY);
  } catch {
    // 隐私模式 / 存储被禁：不影响本轮发送
  }
}