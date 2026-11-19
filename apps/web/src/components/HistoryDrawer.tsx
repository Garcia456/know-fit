import { AnimatePresence, m, useReducedMotion } from 'motion/react';
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import {
  deleteConversation,
  getConversations,
  renameConversation,
  setConversationPinned,
} from '../api/client';
import type { ConversationSummary } from '../api/types';
import { toDateKey } from '../lib/calendar';
import { CheckIcon, CloseIcon, ListChecksIcon, PencilIcon, PinIcon, PlusIcon, TrashIcon } from './Icons';

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

interface MenuState {
  id: string;
  pinned: boolean;
  top: number;
  left: number;
}

const MENU_WIDTH = 148;
const MENU_HEIGHT = 132;

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
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  /** 多选模式：置顶分组标签行右侧的按钮开关，开启后每一行左侧出现圆形 checkbox */
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [bulkConfirm, setBulkConfirm] = useState(false);
  const reduced = useReducedMotion();
  const drawerRef = useRef<HTMLElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const pressRef = useRef<{ timer: number; x: number; y: number } | null>(null);
  const skipClickRef = useRef(false);

  useEffect(() => {
    if (!open) {
      setSelecting(false);
      setSelected(new Set());
      setBulkConfirm(false);
      return;
    }
    let alive = true;
    setFailed(false);
    setEditingId(null);
    setConfirmId(null);
    setMenu(null);
    setActionError(null);
    setSelecting(false);
    setSelected(new Set());
    setBulkConfirm(false);
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
      if (e.key !== 'Escape') return;
      if (bulkConfirm) {
        setBulkConfirm(false);
        return;
      }
      if (editingId || confirmId) {
        setEditingId(null);
        setConfirmId(null);
        return;
      }
      if (selecting) {
        setSelecting(false);
        setSelected(new Set());
        return;
      }
      if (menu) {
        setMenu(null);
        return;
      }
      onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose, editingId, confirmId, menu, selecting, bulkConfirm]);

  // 点菜单外面收起
  useEffect(() => {
    if (!menu) return;
    const onDown = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenu(null);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [menu]);

  useEffect(() => () => cancelPress(), []);

  function cancelPress() {
    const press = pressRef.current;
    if (press) {
      window.clearTimeout(press.timer);
      pressRef.current = null;
    }
  }

  function startPress(
    event: ReactPointerEvent<HTMLButtonElement>,
    item: ConversationSummary,
  ) {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    cancelPress();
    const el = event.currentTarget;
    const { clientX: x, clientY: y } = event;
    const timer = window.setTimeout(() => {
      pressRef.current = null;
      skipClickRef.current = true;
      openMenu(item, el);
    }, 450);
    pressRef.current = { timer, x, y };
  }

  function movePress(event: ReactPointerEvent<HTMLButtonElement>) {
    const press = pressRef.current;
    if (!press) return;
    if (Math.hypot(event.clientX - press.x, event.clientY - press.y) > 8) cancelPress();
  }

  function openMenu(item: ConversationSummary, el: HTMLElement) {
    const drawer = drawerRef.current;
    if (!drawer) return;
    const drawerRect = drawer.getBoundingClientRect();
    const rowRect = el.getBoundingClientRect();
    const left = Math.max(
      8,
      Math.min(rowRect.right - drawerRect.left - MENU_WIDTH, drawerRect.width - MENU_WIDTH - 8),
    );
    let top = rowRect.top - drawerRect.top - MENU_HEIGHT - 6;
    if (top < 8) top = rowRect.bottom - drawerRect.top + 6;
    setMenu({ id: item.id, pinned: item.pinned_at !== null, top, left });
    setActionError(null);
  }

  function selectRow(id: string) {
    if (skipClickRef.current) {
      skipClickRef.current = false;
      return;
    }
    onSelectConversation(id);
  }

  function applyItem(next: ConversationSummary) {
    setItems((prev) =>
      prev
        ? sortItems(
            prev.map((item) =>
              item.id === next.id
                ? { ...item, ...next, last_message: item.last_message }
                : item,
            ),
          )
        : prev,
    );
  }

  function startRename(item: ConversationSummary) {
    setMenu(null);
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
      applyItem(res.conversation);
      setEditingId(null);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : '改名失败，请重试');
    } finally {
      setBusy(false);
    }
  }

  async function togglePin(id: string, pinned: boolean) {
    setMenu(null);
    setBusy(true);
    setActionError(null);
    try {
      const res = await setConversationPinned(id, !pinned);
      applyItem(res.conversation);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : '置顶失败，请重试');
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

  function toggleSelecting() {
    setMenu(null);
    setEditingId(null);
    setConfirmId(null);
    setActionError(null);
    setSelected(new Set());
    setSelecting((prev) => !prev);
  }

  function toggleSelected(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  /** 选中的都置顶了就是「取消置顶」，否则把没置顶的那几个置顶 */
  async function bulkPin() {
    const targets = (items ?? []).filter((item) => selected.has(item.id));
    if (targets.length === 0 || busy) return;
    const pin = targets.some((item) => item.pinned_at === null);
    setBusy(true);
    setActionError(null);
    try {
      const results = await Promise.all(
        targets
          .filter((item) => (item.pinned_at === null) === pin)
          .map((item) => setConversationPinned(item.id, pin)),
      );
      for (const res of results) applyItem(res.conversation);
      setSelecting(false);
      setSelected(new Set());
    } catch (error) {
      setActionError(error instanceof Error ? error.message : '置顶失败，请重试');
      setReloadTick((n) => n + 1);
    } finally {
      setBusy(false);
    }
  }

  async function bulkRemove() {
    const ids = [...selected];
    if (ids.length === 0 || busy) return;
    setBusy(true);
    setActionError(null);
    let failedCount = 0;
    for (const id of ids) {
      try {
        await deleteConversation(id);
        setItems((prev) => (prev ? prev.filter((item) => item.id !== id) : prev));
        onDeleted(id);
      } catch {
        failedCount += 1;
      }
    }
    setBusy(false);
    setBulkConfirm(false);
    setSelecting(false);
    setSelected(new Set());
    if (failedCount > 0) {
      setActionError(`有 ${failedCount} 个会话没删掉，请重试`);
      setReloadTick((n) => n + 1);
    }
  }

  const groups = groupByTime(items ?? []);
  const menuItem = menu ? items?.find((item) => item.id === menu.id) : null;
  const editingItem = editingId ? items?.find((item) => item.id === editingId) : null;
  const selectedItems = (items ?? []).filter((item) => selected.has(item.id));
  const canSelect = (items?.length ?? 0) > 0;

  return (
    <>
      <AnimatePresence>
        {open ? (
          <m.div
            key="scrim"
            className="scrim"
            aria-hidden="true"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduced ? 0 : 0.18 }}
            onClick={onClose}
          />
        ) : null}
        {open ? (
          <m.aside
            key="drawer"
            ref={drawerRef}
            className="drawer"
            role="dialog"
            aria-modal="true"
            aria-label="对话历史"
            initial={reduced ? false : { x: '-100%' }}
            animate={{ x: 0 }}
            exit={reduced ? { opacity: 0 } : { x: '-100%' }}
            transition={
              reduced
                ? { duration: 0 }
                : { type: 'spring', stiffness: 420, damping: 42, mass: 0.9 }
            }
          >
            <div className="drawer-hd">
              <h2>{selecting ? '选择会话' : '对话历史'}</h2>
            </div>

            <div className="drawer-body" onScroll={() => setMenu(null)}>
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
                groups.map((group, index) => (
                  <div key={group.label}>
                    <p className="group-label">
                      <span>{group.label}</span>
                      {index === 0 ? (
                        <button
                          type="button"
                          className={`conv-select-toggle${selecting ? ' is-on' : ''}`}
                          aria-pressed={selecting}
                          aria-label={selecting ? '退出多选' : '多选'}
                          title={selecting ? '退出多选' : '多选'}
                          disabled={!canSelect}
                          onClick={toggleSelecting}
                        >
                          {selecting ? <CloseIcon size={12} /> : <ListChecksIcon size={16} />}
                        </button>
                      ) : null}
                    </p>
                    {group.items.map((item) => {
                      const checked = selected.has(item.id);
                      return (
                        <div
                          key={item.id}
                          className={`conv-row${item.id === activeConversationId ? ' is-active' : ''}${selecting ? ' is-selecting' : ''}${checked ? ' is-checked' : ''}`}
                        >
                          <AnimatePresence initial={false}>
                            {selecting ? (
                              <m.span
                                key="check"
                                className="conv-check-slot"
                                aria-hidden="true"
                                initial={reduced ? false : { width: 0, opacity: 0 }}
                                animate={{ width: 16, opacity: 1 }}
                                exit={reduced ? { opacity: 0 } : { width: 0, opacity: 0 }}
                                transition={
                                  reduced ? { duration: 0 } : { duration: 0.18, ease: 'easeOut' }
                                }
                              >
                                <span className="conv-check">
                                  {checked ? <CheckIcon size={11} /> : null}
                                </span>
                              </m.span>
                            ) : null}
                          </AnimatePresence>
                          <button
                            type="button"
                            className="conv conv-main"
                            role={selecting ? 'checkbox' : undefined}
                            aria-checked={selecting ? checked : undefined}
                            aria-haspopup={selecting ? undefined : 'menu'}
                            aria-label={
                              selecting ? `${checked ? '取消选择' : '选择'} ${item.title}` : undefined
                            }
                            onClick={() =>
                              selecting ? toggleSelected(item.id) : selectRow(item.id)
                            }
                            onPointerDown={
                              selecting ? undefined : (e) => startPress(e, item)
                            }
                            onPointerUp={selecting ? undefined : cancelPress}
                            onPointerLeave={selecting ? undefined : cancelPress}
                            onPointerCancel={selecting ? undefined : cancelPress}
                            onPointerMove={selecting ? undefined : movePress}
                            onContextMenu={
                              selecting
                                ? (e) => e.preventDefault()
                                : (e) => {
                                    e.preventDefault();
                                    cancelPress();
                                    openMenu(item, e.currentTarget);
                                  }
                            }
                          >
                            <p>{item.title}</p>
                            {previewText(item) ? <span>{previewText(item)}</span> : null}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                ))
              )}
            </div>

           {menu && menuItem ? (
              <div
                className="conv-menu"
                role="menu"
                aria-label="会话操作"
                ref={menuRef}
                style={{ top: menu.top, left: menu.left }}
              >
                <button
                  type="button"
                  role="menuitem"
                  disabled={busy}
                  onClick={() => void togglePin(menuItem.id, menu.pinned)}
                >
                  <PinIcon off={menu.pinned} />
                  {menu.pinned ? '取消置顶' : '置顶'}
                </button>
                <button
                  type="button"
                  role="menuitem"
                  disabled={busy}
                  onClick={() => startRename(menuItem)}
                >
                  <PencilIcon />
                  重命名
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="is-danger"
                  disabled={busy}
                  onClick={() => {
                    setMenu(null);
                    setConfirmId(menuItem.id);
                    setActionError(null);
                  }}
                >
                  <TrashIcon />
                  删除
                </button>
              </div>
            ) : null}

            {selecting ? (
              <div className="drawer-ft drawer-ft--select">
                <button
                  type="button"
                  className="btn btn--ghost"
                  disabled={busy || selected.size === 0}
                  onClick={() => void bulkPin()}
                >
                  <PinIcon size={15} />
                  置顶
                  {selected.size > 0 ? <span className="drawer-ft__count">{selected.size}</span> : null}
                </button>
                <button
                  type="button"
                  className="btn btn--danger"
                  disabled={busy || selected.size === 0}
                  onClick={() => setBulkConfirm(true)}
                >
                  <TrashIcon size={15} />
                  删除
                  {selected.size > 0 ? <span className="drawer-ft__count">{selected.size}</span> : null}
                </button>
              </div>
            ) : (
              <div className="drawer-ft">
                <button type="button" className="btn" onClick={onNewConversation}>
                  <PlusIcon />
                  创建新会话
                </button>
              </div>
            )}
          </m.aside>
        ) : null}
      </AnimatePresence>

      {open && editingItem ? (
        <div
          className="modal-layer"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setEditingId(null);
          }}
        >
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="rename-title">
            <h2 id="rename-title">重命名会话</h2>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void saveRename(editingItem.id);
              }}
            >
              <input
                className="modal-input"
                aria-label="会话标题"
                value={editTitle}
                maxLength={40}
                autoFocus
                onChange={(e) => setEditTitle(e.target.value)}
              />
              {actionError ? (
                <p className="error-text" role="alert">
                  {actionError}
                </p>
              ) : null}
              <div className="modal-actions">
                <button
                  type="button"
                  className="btn btn--ghost"
                  disabled={busy}
                  onClick={() => setEditingId(null)}
                >
                  取消
                </button>
                <button type="submit" className="btn" disabled={busy}>
                  保存
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {open && bulkConfirm ? (
        <div
          className="modal-layer"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget && !busy) setBulkConfirm(false);
          }}
        >
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="bulk-delete-title">
            <h2 id="bulk-delete-title">删除 {selected.size} 个会话</h2>
            <p className="modal-text">删除后不可恢复；训练记录不受影响。</p>
            {actionError ? (
              <p className="error-text" role="alert">
                {actionError}
              </p>
            ) : null}
            <div className="modal-actions">
              <button
                type="button"
                className="btn btn--ghost"
                disabled={busy}
                onClick={() => setBulkConfirm(false)}
              >
                取消
              </button>
              <button
                type="button"
                className="btn btn--danger"
                disabled={busy || selectedItems.length === 0}
                onClick={() => void bulkRemove()}
              >
                {busy ? '删除中…' : '确认删除'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {open && confirmId ? (
        <div
          className="modal-layer"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setConfirmId(null);
          }}
        >
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="delete-title">
            <h2 id="delete-title">删除会话</h2>
            <p className="modal-text">删除后不可恢复；训练记录不受影响。</p>
            {actionError ? (
              <p className="error-text" role="alert">
                {actionError}
              </p>
            ) : null}
            <div className="modal-actions">
              <button
                type="button"
                className="btn btn--ghost"
                disabled={busy}
                onClick={() => setConfirmId(null)}
              >
                取消
              </button>
              <button
                type="button"
                className="btn btn--danger"
                disabled={busy}
                onClick={() => void remove(confirmId)}
              >
                确认删除
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

function previewText(item: ConversationSummary): string {
  const preview = item.last_message?.replace(/\s+/g, ' ').trim() ?? '';
  return [...preview].slice(0, 30).join('');
}

/** 置顶在前，其余按最后更新时间分组：今天 / 昨天 / 前天 / 7天内 / 具体月份 */
export function groupByTime(items: ConversationSummary[], now = new Date()): Group[] {
  const today = toDateKey(now);
  const yesterday = toDateKey(daysAgo(now, 1));
  const dayBefore = toDateKey(daysAgo(now, 2));
  const weekStart = toDateKey(daysAgo(now, 6));

  const pinned: ConversationSummary[] = [];
  const buckets = new Map<string, ConversationSummary[]>();
  for (const item of items) {
    if (item.pinned_at) {
      pinned.push(item);
      continue;
    }
    const day = toDateKey(new Date(item.updated_at));
    let label: string;
    if (day >= today) label = '今天';
    else if (day === yesterday) label = '昨天';
    else if (day === dayBefore) label = '前天';
    else if (day >= weekStart) label = '7天内';
    else {
      const d = new Date(item.updated_at);
      label = `${d.getFullYear()}年${d.getMonth() + 1}月`;
    }
    const bucket = buckets.get(label) ?? [];
    bucket.push(item);
    buckets.set(label, bucket);
  }

  const groups: Group[] = [];
  if (pinned.length > 0) groups.push({ label: '置顶', items: pinned });
  for (const [label, bucket] of buckets) groups.push({ label, items: bucket });
  return groups;
}

function daysAgo(now: Date, days: number): Date {
  const d = new Date(now);
  d.setDate(d.getDate() - days);
  return d;
}

function sortItems(items: ConversationSummary[]): ConversationSummary[] {
  return [...items].sort((a, b) => {
    if (a.pinned_at && !b.pinned_at) return -1;
    if (!a.pinned_at && b.pinned_at) return 1;
    return b.updated_at.localeCompare(a.updated_at);
  });
}