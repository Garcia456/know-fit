import { useEffect, useState } from 'react';
import { getHistory } from '../api/client';
import type { HistoryItem } from '../api/types';
import { startOfWeekKey, toDateKey } from '../lib/calendar';
import { formatKg, formatMd } from '../lib/format';
import { CloseIcon, PlusIcon } from './Icons';

interface Props {
  open: boolean;
  onClose: () => void;
  onSelectDate: (date: string) => void;
  onNewConversation: () => void;
}

interface Group {
  label: string;
  items: HistoryItem[];
}

export function HistoryDrawer({ open, onClose, onSelectDate, onNewConversation }: Props) {
  const [items, setItems] = useState<HistoryItem[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setFailed(false);
    getHistory()
      .then((res) => {
        if (alive) setItems(res.items);
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
          {failed ? (
            <div className="drawer-state">
              <p>历史暂时读不出来</p>
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
            <p className="drawer-state">还没有训练记录</p>
          ) : (
            groups.map((group) => (
              <div key={group.label}>
                <p className="group-label">{group.label}</p>
                {group.items.map((item) => (
                  <button
                    key={item.session_id}
                    type="button"
                    className="conv"
                    onClick={() => onSelectDate(item.date)}
                  >
                    <p>{rowTitle(item)}</p>
                    <span>{rowMeta(item)}</span>
                  </button>
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

/** 记录不是会话：标题只写记录本身，不造会话名。 */
function rowTitle(item: HistoryItem): string {
  const split = item.split_label ?? '训练';
  if (item.status === 'incomplete') return `${split} · 记到一半`;
  return `${split} · ${item.exercise_count} 个动作 / ${item.working_sets} 组`;
}

function rowMeta(item: HistoryItem): string {
  const day = item.date === toDateKey(new Date()) ? '今天' : formatMd(item.date);
  if (item.status === 'incomplete') {
    const n = item.missing_fields.length;
    return `${n > 0 ? `待补 ${n} 项` : '待补'} · ${day}`;
  }
  return `${formatKg(item.volume_kg)} · ${day}`;
}

function groupByTime(items: HistoryItem[]): Group[] {
  const today = toDateKey(new Date());
  const weekStart = startOfWeekKey(new Date());
  const todayItems: HistoryItem[] = [];
  const weekItems: HistoryItem[] = [];
  const olderItems: HistoryItem[] = [];
  for (const item of items) {
    if (item.date >= today) todayItems.push(item);
    else if (item.date >= weekStart) weekItems.push(item);
    else olderItems.push(item);
  }
  return [
    { label: '今天', items: todayItems },
    { label: '本周', items: weekItems },
    { label: '更早', items: olderItems },
  ].filter((group) => group.items.length > 0);
}