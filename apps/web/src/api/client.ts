import type {
  Account,
  AccountInput,
  AssessmentResponse,
  ClearTrainingResult,
  ConversationDetail,
  ConversationListResponse,
  ConversationSummary,
  HistoryResponse,
  NudgeNextResponse,
  Profile,
  ProfileInput,
  SessionDetail,
  SessionListResponse,
  SetDrop,
  SetTag,
  StatsRange,
  TurnResponse,
  WeeklyVolume,
  WeightHistory,
} from './types';

/** 接口失败时界面只拿这一层信息，不猜后端内部原因。 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    // 只有带 body 才设 JSON 头 —— 空 body + content-type 会被 Fastify 判成 400
    headers: {
      ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
      ...init.headers,
    },
  });

  if (!response.ok) {
    let detail = `请求失败（${response.status}）`;
    try {
      const body = (await response.json()) as { error?: unknown };
      if (typeof body.error === 'string' && body.error) detail = body.error;
    } catch {
      // 非 JSON 错误体，保留状态码
    }
    // 会话过期：让 AuthProvider 统一退回登录页；登录接口自己的 401 不算
    if (response.status === 401 && !path.startsWith('/api/auth/')) {
      window.dispatchEvent(new Event('kf:unauthorized'));
    }
    throw new ApiError(response.status, detail);
  }

  // 204 没有 body —— 例如删除会话
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export function getMe(): Promise<{ user: Account }> {
  return request('/api/auth/me', { method: 'GET' });
}

export function postLogin(email: string, password: string): Promise<{ user: Account }> {
  return request('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
}

export function postRegister(input: {
  email: string;
  password: string;
  nickname: string;
}): Promise<{ user: Account }> {
  return request('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function postLogout(): Promise<{ ok: true }> {
  return request('/api/auth/logout', { method: 'POST' });
}

export function patchAccount(input: AccountInput): Promise<{ user: Account }> {
  return request('/api/account', { method: 'PATCH', body: JSON.stringify(input) });
}

export function clearTrainingRecords(): Promise<{ ok: true; cleared: ClearTrainingResult }> {
  return request('/api/account/training-records', { method: 'DELETE' });
}

export function deleteAccount(): Promise<{ ok: true }> {
  return request('/api/account', { method: 'DELETE' });
}

export function postTurn(message: string, conversationId?: string | null): Promise<TurnResponse> {
  return request('/api/turns', {
    method: 'POST',
    body: JSON.stringify({
      message,
      ...(conversationId ? { conversation_id: conversationId } : {}),
    }),
  });
}

export function getConversations(): Promise<ConversationListResponse> {
  return request('/api/conversations', { method: 'GET' });
}

export function getConversation(id: string): Promise<ConversationDetail> {
  return request(`/api/conversations/${encodeURIComponent(id)}`, { method: 'GET' });
}

export function renameConversation(
  id: string,
  title: string,
): Promise<{ conversation: ConversationSummary }> {
  return request(`/api/conversations/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ title }),
  });
}

export function setConversationPinned(
  id: string,
  pinned: boolean,
): Promise<{ conversation: ConversationSummary }> {
  return request(`/api/conversations/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ pinned }),
  });
}

export function deleteConversation(id: string): Promise<void> {
  return request(`/api/conversations/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export function postAssessment(
  relatedRecordId: string,
  trigger: 'explicit' | 'hook' = 'hook',
): Promise<AssessmentResponse> {
  return request('/api/assessments', {
    method: 'POST',
    body: JSON.stringify({ related_record_id: relatedRecordId, trigger }),
  });
}

export function getSessions(from: string, to: string): Promise<SessionListResponse> {
  return request(`/api/sessions?from=${from}&to=${to}`, { method: 'GET' });
}

export function getSession(id: string): Promise<SessionDetail> {
  return request(`/api/sessions/${encodeURIComponent(id)}`, { method: 'GET' });
}

export function getWeeklyVolume(weeks = 4): Promise<WeeklyVolume> {
  return request(`/api/metrics/weekly?weeks=${weeks}`, { method: 'GET' });
}

export function getWeightHistory(weeks = 8): Promise<WeightHistory> {
  return request(`/api/metrics/weight?weeks=${weeks}`, { method: 'GET' });
}

export function getHistory(limit = 20): Promise<HistoryResponse> {
  return request(`/api/history?limit=${limit}`, { method: 'GET' });
}

export function getStats(from: string, to: string): Promise<StatsRange> {
  return request(`/api/stats?from=${from}&to=${to}`, { method: 'GET' });
}

export function getProfile(): Promise<Profile> {
  return request('/api/profile', { method: 'GET' });
}

export function putProfile(input: ProfileInput): Promise<Profile> {
  return request('/api/profile', { method: 'PUT', body: JSON.stringify(input) });
}

export function postNudgeNext(): Promise<NudgeNextResponse> {
  return request('/api/nudges/next', { method: 'POST' });
}

export function postNudgeAction(
  id: string,
  action: '补全' | '忽略' | '未响应',
): Promise<{ ok: true }> {
  return request(`/api/nudges/${encodeURIComponent(id)}/action`, {
    method: 'POST',
    body: JSON.stringify({ action }),
  });
}

export interface PatchSetInput {
  weight_kg: number | null;
  reps: number | null;
  set_type: 'warmup' | 'working';
  is_inferred: boolean;
}

export interface PatchExerciseInput {
  raw_name: string;
  sets: PatchSetInput[];
}

export function patchSession(
  id: string,
  exercises: PatchExerciseInput[],
  note?: string,
): Promise<SessionDetail> {
  return request(`/api/sessions/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ exercises, ...(note ? { note } : {}) }),
  });
}

export interface UpdateExerciseInput {
  raw_name: string;
  sets: {
    weight_kg: number | null;
    reps: number | null;
    tags?: SetTag[];
    drops?: SetDrop[] | null;
  }[];
}

/** 手动编辑：按现有顺序覆盖动作名 / 重量 / 次数 */
export function putSession(
  id: string,
  exercises: UpdateExerciseInput[],
  note?: string | null,
): Promise<SessionDetail> {
  return request(`/api/sessions/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify({ exercises, ...(note === undefined ? {} : { note }) }),
  });
}

export function deleteSession(id: string): Promise<void> {
  return request(`/api/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' });
}