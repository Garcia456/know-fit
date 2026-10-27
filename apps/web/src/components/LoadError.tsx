interface Props {
  message: string;
  onRetry?: () => void;
}

/** 页面级读取失败：占数据的位置，页面结构不拆。 */
export function LoadError({ message, onRetry }: Props) {
  return (
    <div className="error-bar" role="alert">
      <span>{message}</span>
      {onRetry ? (
        <button type="button" className="btn btn--ghost btn--sm" onClick={onRetry}>
          重试
        </button>
      ) : null}
    </div>
  );
}