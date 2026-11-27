import { recoveryMetrics } from '../services/recovery-metrics.js';
import { closeDb } from '../services/pool.js';

/**
 * 断点恢复率 CLI —— 只读；不联网、不需要 key。
 * 用法：pnpm --filter @know-fit/api metrics:recovery -- --from 2026-11-01 --to 2026-11-30
 */

function arg(name: string): string | null {
  const i = process.argv.indexOf(name);
  if (i < 0) return null;
  return process.argv[i + 1] ?? null;
}

const from = arg('--from');
const to = arg('--to');

if (!from || !to) {
  console.error('用法：metrics:recovery -- --from YYYY-MM-DD --to YYYY-MM-DD');
  process.exitCode = 2;
} else {
  try {
    const metrics = await recoveryMetrics({ from, to });
    console.log(JSON.stringify(metrics, null, 2));
  } finally {
    await closeDb();
  }
}
