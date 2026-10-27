import { useEffect, useState } from 'react';
import { deleteConversation, getConversations, renameConversation } from '../api/client';
import type { ConversationSummary } from '../api/types';
import { startOfWeekKey, toDateKey } from '../lib/calendar';
import { formatMd } from '../lib/format';
import { CloseIcon, PlusIcon } from './Icons';

interface Props {
  open: boolean;
  activeConversationId?: string | null;
  onClose: () => void;
  onSelectConversation: (id: string) => void;
  onDeleted: (id: string) => void;
  onNewConversation: () => void;
}

interface Group {
  label: string;
  items: ConversationSummary[];
}

export function HistoryDrawer({
  open,
  activeConversationId,
  onClose,
  onSelectConversation,
  onDeleted,
  onNewConversation,
}: Props) {
  const [items, setItems] = useState<ConversationSummary[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setFailed(false);
    setEditingId(null);
    setConfirmId(null);
    setActionError(null);
    getConversations()
      .then((res) => {
        if (alive) setItems(res.conversations);
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [open, reloadTick]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  function startRename(item: ConversationSummary) {
    setEditingId(item.id);
    setEditTitle(item.title);
    setConfirmId(null);
    setActionError(null);
  }

  async function saveRename(id: string) {
    const title = editTitle.trim();
    if (title.length === 0 || [...title].length > 40) {
      setActionError('标题需要 1–40 字');
      return;
    }
    setBusy(true);
    setActionError(null);
    try {
      const res = await renameConversation(id, title);
      setItems((prev) =>
        prev
          ? prev.map((item) =>
              item.id === id ? { ...item, title: res.conversation.title } : item,
            )
          : prev,
      );
      setEditingId(null);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : '改名失败，请重试');
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setBusy(true);
    setActionError(null);
    try {
      await deleteConversation(id);
      setItems((prev) => (prev ? prev.filter((item) => item.id !== id) : prev));
      setConfirmId(null);
      onDeleted(id);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : '删除失败，请重试');
    } finally {
      setBusy(false);
    }
  }

  const groups = groupByTime(items ?? []);

  return (
    <>
      <div className="scrim" aria-hidden="true" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-modal="true" aria-label="对话历史">
        <div className="drawer-hd">
          <h2>对话历史</h2>
          <button type="button" className="icon-btn" aria-label="关闭" onClick={onClose}>
            <CloseIcon />
          </button>
        </div>

        <div className="drawer-body">
          {actionError ? (
            <p className="error-text" role="alert">
              {actionError}
            </p>
          ) : null}

          {failed ? (
            <div className="drawer-state">
              <p>会话暂时读不出来</p>
              <button
                type="button"
                className="btn btn--sm"
                onClick={() => setReloadTick((n) => n + 1)}
              >
                重试
              </button>
            </div>
          ) : items === null ? (
            <p className="drawer-state">读取中…</p>
          ) : items.length === 0 ? (
            <p className="drawer-state">还没有会话</p>
          ) : (
            groups.map((group) => (
              <div key={group.label}>
                <p className="group-label">{group.label}</p>
                {group.items.map((item) => (
                  <div
                    key={item.id}
                    className={`conv-row${item.id === activeConversationId ? ' is-active' : ''}`}
                  >
                    {editingId === item.id ? (
                      <form
                        className="conv-edit"
                        onSubmit={(e) => {
                          e.preventDefault();
                          void saveRename(item.id);
                        }}
                      >
                        <input
                          aria-label="会话标题"
                          value={editTitle}
                          maxLength={40}
                          autoFocus
                          onChange={(e) => setEditTitle(e.target.value)}
                        />
                        <button type="submit" className="btn btn--sm" disabled={busy}>
                          保存
                        </button>
                        <button
                          type="button"
                          className="btn btn--ghost btn--sm"
                          onClick={() => setEditingId(null)}
                          disabled={busy}
                        >
                          取消
                        </button>
                      </form>
                    ) : confirmId === item.id ? (
                      <div className="conv-del">
                        <p>删除这条会话？删了不可恢复，训练记录不受影响。</p>
                        <button
                          type="button"
                          className="btn btn--sm"
                          onClick={() => void remove(item.id)}
                          disabled={busy}
                        >
                          确认删除
                        </button>
                        <button
                          type="button"
                          className="btn btn--ghost btn--sm"
                          onClick={() => setConfirmId(null)}
                          disabled={busy}
                        >
                          取消
                        </button>
                      </div>
                    ) : (
                      <>
                        <button
                          type="button"
                          className="conv conv-main"
                          onClick={() => onSelectConversation(item.id)}
                        >
                          <p>{item.title}</p>
                          <span>{rowMeta(item)}</span>
                        </button>
                        <div className="conv-actions">
                          <button
                            type="button"
                            className="btn btn--ghost btn--sm"
                            aria-label={`重命名 ${item.title}`}
                            onClick={() => startRename(item)}
                          >
                            改名
                          </button>
                          <button
                            type="button"
                            className="btn btn--ghost btn--sm"
                            aria-label={`删除 ${item.title}`}
                            onClick={() => {
                              setConfirmId(item.id);
                              setEditingId(null);
                            }}
                          >
                            删除
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                ))}
              </div>
            ))
          )}
        </div>

        <div className="drawer-ft">
          <button type="button" className="btn" onClick={onNewConversation}>
            <PlusIcon />
            创建新会话
          </button>
        </div>
      </aside>
    </>
  );
}

function rowMeta(item: ConversationSummary): string {
  const dayKey = toDateKey(new Date(item.updated_at));
  const day = dayKey === toDateKey(new Date()) ? '今天' : formatMd(dayKey);
  const preview = item.last_message?.replace(/\s+/g, ' ').trim() ?? '';
  const short = [...preview].slice(0, 30).join('');
  return short ? `${short} · ${day}` : day;
}

function groupByTime(items: ConversationSummary[]): Group[] {
  const today = toDateKey(new Date());
  const weekStart = startOfWeekKey(new Date());
  const todayItems: ConversationSummary[] = [];
  const weekItems: ConversationSummary[] = [];
  const olderItems: ConversationSummary[] = [];
  for (const item of items) {
    const day = toDateKey(new Date(item.updated_at));
    if (day >= today) todayItems.push(item);
    else if (day >= weekStart) weekItems.push(item);
    else olderItems.push(item);
  }
  return [
    { label: '今天', items: todayItems },
    { label: '本周', items: weekItems },
    { label: '更早', items: olderItems },
  ].filter((group) => group.items.length > 0);
}