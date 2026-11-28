import { useEffect, useState } from 'react';

/** 等回复：转圈 + 已等待秒数。秒数 3 秒后才出现，前几秒没必要让数字抢戏。 */
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
      {seconds >= 3 ? <span className="thinking-time">{seconds}s</span> : null}
    </div>
  );
}
