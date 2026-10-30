import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from 'react';
import type { AvatarImage } from '../lib/avatar';
import { cropAvatar } from '../lib/avatar';

const MIN_ZOOM = 1;
const MAX_ZOOM = 3;

interface Props {
  source: AvatarImage;
  onCancel: () => void;
  onConfirm: (dataUrl: string) => void;
}

/** 圆形取景框：拖动平移、滑块 / 滚轮缩放，确认后裁成正方形头像。 */
export function AvatarCropDialog({ source, onCancel, onConfirm }: Props) {
  const stageRef = useRef<HTMLDivElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const dragRef = useRef<{ id: number; x: number; y: number; ox: number; oy: number } | null>(
    null,
  );
  const [stageSize, setStageSize] = useState(280);
  const [zoom, setZoom] = useState(MIN_ZOOM);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [error, setError] = useState<string | null>(null);

  const { image, url } = source;
  const displayScale =
    Math.max(stageSize / image.naturalWidth, stageSize / image.naturalHeight) * zoom;
  const imgW = image.naturalWidth * displayScale;
  const imgH = image.naturalHeight * displayScale;
  const maxX = Math.max(0, (imgW - stageSize) / 2);
  const maxY = Math.max(0, (imgH - stageSize) / 2);

  const clamp = (next: { x: number; y: number }) => ({
    x: Math.min(maxX, Math.max(-maxX, next.x)),
    y: Math.min(maxY, Math.max(-maxY, next.y)),
  });

  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const measure = () => setStageSize(el.clientWidth || 280);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // 缩放后把图片拉回取景框内
  useEffect(() => {
    setOffset((prev) => ({
      x: Math.min(maxX, Math.max(-maxX, prev.x)),
      y: Math.min(maxY, Math.max(-maxY, prev.y)),
    }));
  }, [maxX, maxY]);

  useEffect(() => {
    confirmRef.current?.focus();
    function onKey(event: globalThis.KeyboardEvent) {
      if (event.key === 'Escape') onCancel();
    }
    window.addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [onCancel]);

  // 滚轮缩放：必须用非 passive 监听，才能挡住背后的页面滚动
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    function onWheel(event: globalThis.WheelEvent) {
      event.preventDefault();
      setZoom((prev) => {
        const next = prev - event.deltaY * 0.002;
        return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next));
      });
    }
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      ox: offset.x,
      oy: offset.y,
    };
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.id !== event.pointerId) return;
    setOffset(
      clamp({
        x: drag.ox + (event.clientX - drag.x),
        y: drag.oy + (event.clientY - drag.y),
      }),
    );
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const step = 8;
    const moves: Record<string, { x: number; y: number }> = {
      ArrowLeft: { x: -step, y: 0 },
      ArrowRight: { x: step, y: 0 },
      ArrowUp: { x: 0, y: -step },
      ArrowDown: { x: 0, y: step },
    };
    const move = moves[event.key];
    if (!move) return;
    event.preventDefault();
    setOffset((prev) => clamp({ x: prev.x + move.x, y: prev.y + move.y }));
  }

  function handleConfirm() {
    const sx = ((imgW - stageSize) / 2 - offset.x) / displayScale;
    const sy = ((imgH - stageSize) / 2 - offset.y) / displayScale;
    try {
      onConfirm(cropAvatar(image, { x: sx, y: sy, size: stageSize / displayScale }));
    } catch (e) {
      setError(e instanceof Error ? e.message : '图片处理失败，换一张试试');
    }
  }

  return (
    <div className="dialog-mask" role="presentation" onPointerDown={onCancel}>
      <div
        className="dialog crop-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="调整头像"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <h2>调整头像</h2>
        <p className="dialog-hint">拖动图片调整位置，滚轮缩放</p>

        <div
          ref={stageRef}
          className="crop-stage"
          tabIndex={0}
          role="application"
          aria-label="头像取景框，可拖动或用方向键移动"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={(e) => {
            if (dragRef.current?.id === e.pointerId) dragRef.current = null;
          }}
          onPointerCancel={() => {
            dragRef.current = null;
          }}
          onKeyDown={handleKeyDown}
        >
          <img
            className="crop-stage__img"
            src={url}
            alt=""
            draggable={false}
            style={{
              width: imgW,
              height: imgH,
              transform: `translate(-50%, -50%) translate(${offset.x}px, ${offset.y}px)`,
            }}
          />
          <span className="crop-stage__ring" aria-hidden="true" />
        </div>

        {error ? (
          <p className="error-text" role="alert">
            {error}
          </p>
        ) : null}

        <div className="dialog-actions">
          <button type="button" className="btn btn--ghost btn--sm" onClick={onCancel}>
            取消
          </button>
          <button ref={confirmRef} type="button" className="btn btn--sm" onClick={handleConfirm}>
            使用这张
          </button>
        </div>
      </div>
    </div>
  );
}
