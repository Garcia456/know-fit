import { useEffect, useState } from 'react';

/** 等回复：转圈 + 已等待秒数，每秒跳一次 */
export function ThinkingIndicator() {
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setSeconds((n) => n + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="thinking" role="status">
      <span className="spinner" aria-hidden="true" />
      <span>思考中...</span>
      <span className="thinking-time">{seconds}s</span>
    </div>
  );
}