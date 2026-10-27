import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import {
  ApiError,
  getConversation,
  postAssessment,
  postNudgeAction,
  postNudgeNext,
  postTurn,
} from '../api/client';
import type {
  AssessmentCard,
  ConversationMessage,
  Nudge,
  TurnResponse,
} from '../api/types';
import { writeConversationId } from '../lib/conversation';
import { AssessmentCardView } from '../components/AssessmentCardView';
import { CardView } from '../components/CardView';
import { Composer } from '../components/Composer';
import { CompletionPanel } from '../components/CompletionPanel';
import { LowDataCard } from '../components/LowDataCard';

const DRAFT_KEY = 'know-fit:chat-draft';

/** fill = 填入输入框等用户补全；send = 本身就是完整问题，点了直接发 */
const QUICK_ASKS: { label: string; mode: 'fill' | 'send' }[] = [
  { label: '今天练了背', mode: 'fill' },
  { label: '补记昨天的推日', mode: 'fill' },
  { label: '练胸有什么推荐动作', mode: 'send' },
  { label: '深蹲怎么练才标准', mode: 'send' },
  { label: '上周容量怎么样', mode: 'send' },
  { label: '我这样练够吗', mode: 'send' },
];

interface Entry {
  id: string;
  user: string;
  response: TurnResponse;
  extraAssessments: AssessmentCard[];
  assessmentNotices: string[];
  assessmentError: string | null;
  /** 判定算不出时缺的项；null 表示不缺 */
  lowData: string[] | null;
}

function readDraft(): string {
  try {
    return localStorage.getItem(DRAFT_KEY) ?? '';
  } catch {
    return '';
  }
}

function writeDraft(value: string): void {
  try {
    if (value) localStorage.setItem(DRAFT_KEY, value);
    else localStorage.removeItem(DRAFT_KEY);
  } catch {
    // 隐私模式 / 存储被禁：不阻塞发送
  }
}

let nextId = 0;
function makeId(): string {
  nextId += 1;
  return `entry-${nextId}`;
}

/** 库里的消息还原成屏上的轮次：一条用户消息 + 紧跟的助手响应 */
function entriesFromMessages(messages: ConversationMessage[]): Entry[] {
  const entries: Entry[] = [];
  let user: string | null = null;
  for (const message of messages) {
    if (message.role === 'user') {
      user = message.content;
      continue;
    }
    if (!message.response) continue;
    entries.push({
      id: `restored-${message.id}`,
      user: user ?? '',
      response: message.response,
      extraAssessments: [],
      assessmentNotices: [],
      assessmentError: null,
      lowData:
        message.response.assessment_lookup?.status === 'insufficient'
          ? message.response.assessment_lookup.missing
          : null,
    });
    user = null;
  }
  return entries;
}

interface Props {
  /** 顶栏「创建新会话」递增；变化即清空视图与草稿 */
  resetToken: number;
  /** 当前会话 —— 从抽屉选中或刷新恢复时变化 */
  activeConversationId?: string | null;
  onConversationChange?: (id: string | null) => void;
}

export function ChatPage({ resetToken, activeConversationId, onConversationChange }: Props) {
  const [draft, setDraft] = useState(readDraft);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [failedMessage, setFailedMessage] = useState<string | null>(null);
  const [assessingSessionId, setAssessingSessionId] = useState<string | null>(null);
  const [nudge, setNudge] = useState<Nudge | null>(null);
  const [nudgeDone, setNudgeDone] = useState(false);
  const [nudgeBusy, setNudgeBusy] = useState(false);
  const [params, setParams] = useSearchParams();
  const nudgeRequested = useRef(false);
  const lastReset = useRef(resetToken);
  /** 已经画出来的会话 —— 发送后自己写进来的响应不必再拉一次 */
  const loadedConversation = useRef<string | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // 进首页取一次提示；StrictMode 下也不会取两次（第二次会被服务端去重成 null）
  useEffect(() => {
    if (nudgeRequested.current) return;
    nudgeRequested.current = true;
    let alive = true;
    postNudgeNext()
      .then((r) => {
        if (alive) setNudge(r.nudge);
      })
      .catch(() => {
        // 提示拿不到不影响主流程
      });
    return () => {
      alive = false;
    };
  }, []);

  // 新会话 = 只清当前视图与草稿，不删库
  useEffect(() => {
    if (lastReset.current === resetToken) return;
    lastReset.current = resetToken;
    setEntries([]);
    setDraft('');
    writeDraft('');
    writeConversationId(null);
    loadedConversation.current = null;
    onConversationChange?.(null);
    setSendError(null);
    setFailedMessage(null);
    setParams({});
  }, [resetToken, setParams, onConversationChange]);

  // 选中 / 刷新恢复：从库里把消息与卡片画回来
  useEffect(() => {
    const id = activeConversationId;
    if (!id || loadedConversation.current === id) return;
    let alive = true;
    getConversation(id)
      .then((detail) => {
        if (!alive) return;
        loadedConversation.current = id;
        setEntries(entriesFromMessages(detail.messages));
        setSendError(null);
        setFailedMessage(null);
      })
      .catch((error) => {
        if (!alive) return;
        loadedConversation.current = null;
        if (error instanceof ApiError && error.status === 404) {
          writeConversationId(null);
          onConversationChange?.(null);
          return;
        }
        setSendError(error instanceof Error ? error.message : '会话读不出来');
      });
    return () => {
      alive = false;
    };
  }, [activeConversationId, onConversationChange]);

  useEffect(() => {
    const el = bodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [entries]);

  const completeId = params.get('complete');

  async function handleNudge(action: '补全' | '忽略') {
    if (!nudge || nudgeBusy) return;
    setNudgeBusy(true);
    try {
      await postNudgeAction(nudge.id, action);
    } catch {
      // 动作没记上也不挡用户；提示只在本会话隐藏
    } finally {
      setNudgeBusy(false);
      setNudgeDone(true);
    }
    if (action === '补全' && nudge.type === '补全') {
      setParams({ complete: nudge.session_id });
    }
  }

  function updateDraft(value: string) {
    setDraft(value);
    writeDraft(value);
  }

  /** 半截话先落进输入框，用户补完再发 */
  function fillDraft(text: string) {
    updateDraft(text);
    const el = inputRef.current;
    if (!el) return;
    el.focus({ preventScroll: true });
    requestAnimationFrame(() => el.setSelectionRange(el.value.length, el.value.length));
  }

  async function send(message: string) {
    const trimmed = message.trim();
    if (!trimmed || sending) return;

    setSending(true);
    setSendError(null);
    setFailedMessage(null);

    try {
      const response = await postTurn(trimmed, activeConversationId);
      loadedConversation.current = response.conversation_id;
      writeConversationId(response.conversation_id);
      onConversationChange?.(response.conversation_id);
      setEntries((prev) => [
        ...prev,
        {
          id: makeId(),
          user: trimmed,
          response,
          extraAssessments: [],
          assessmentNotices: [],
          assessmentError: null,
          lowData:
            response.assessment_lookup?.status === 'insufficient'
              ? response.assessment_lookup.missing
              : null,
        },
      ]);
      updateDraft('');
    } catch (error) {
      // 失败时文字不丢：输入框与 localStorage 都保留
      setFailedMessage(trimmed);
      setSendError(error instanceof Error ? error.message : '发送失败，请重试');
    } finally {
      setSending(false);
    }
  }

  async function assess(sessionId: string) {
    if (assessingSessionId) return;
    setAssessingSessionId(sessionId);

    try {
      const result = await postAssessment(sessionId);
      setEntries((prev) =>
        prev.map((entry) => {
          const card = entry.response.card;
          if (!card || card.kind !== 'workout' || card.session_id !== sessionId) return entry;
          if (result.lookup_status === 'insufficient') {
            return { ...entry, lowData: result.missing, assessmentError: null };
          }
          return {
            ...entry,
            extraAssessments: result.card
              ? [...entry.extraAssessments, result.card]
              : entry.extraAssessments,
            assessmentNotices: [...entry.assessmentNotices, ...result.notices],
            assessmentError: result.card ? null : (result.notices[0] ?? '没有生成评估'),
          };
        }),
      );
    } catch (error) {
      setEntries((prev) =>
        prev.map((entry) => {
          const card = entry.response.card;
          if (!card || card.kind !== 'workout' || card.session_id !== sessionId) return entry;
          return {
            ...entry,
            assessmentError: error instanceof Error ? error.message : '评估失败，请重试',
          };
        }),
      );
    } finally {
      setAssessingSessionId(null);
    }
  }

  return (
    <>
      <div className="body page-body" ref={bodyRef}>
        {nudge && !nudgeDone ? (
          <div className="strip" role="status">
            <p>{nudge.message}</p>
            {nudge.type === '补全' ? (
              <button type="button" disabled={nudgeBusy} onClick={() => void handleNudge('补全')}>
                补上 ›
              </button>
            ) : null}
            <button
              type="button"
              disabled={nudgeBusy}
              onClick={() => void handleNudge('忽略')}
            >
              {nudge.type === '补全' ? '忽略' : '知道了'}
            </button>
          </div>
        ) : null}

        {entries.length === 0 && !completeId ? (
          <>
            <div className="spacer" />
            <p className="agent-text">
              今天练了什么？直接说就行 —— 比如「<strong>卧推 70kg×8 四组</strong>」。
              <br />
              动作怎么练、要不要加重量，也能直接问我。
            </p>
            <div className="chips">
              {QUICK_ASKS.map((ask) => (
                <button
                  key={ask.label}
                  type="button"
                  className="chip"
                  onClick={() =>
                    ask.mode === 'fill' ? fillDraft(ask.label) : void send(ask.label)
                  }
                  disabled={sending}
                >
                  {ask.label}
                </button>
              ))}
            </div>
          </>
        ) : null}

        {entries.map((entry) => {
          const card = entry.response.card;
          const sessionId = card?.kind === 'workout' ? card.session_id : null;
          return (
            <div key={entry.id} className="turn">
              <div className="msg-user">
                <p>{entry.user}</p>
              </div>

              {card ? (
                <CardView
                  card={card}
                  onAssess={assess}
                  assessingSessionId={assessingSessionId}
                  onComplete={(id) => setParams({ complete: id })}
                  onQuickAsk={(message) => void send(message)}
                />
              ) : null}

              {entry.lowData ? (
                <LowDataCard
                  missing={entry.lowData}
                  onComplete={sessionId ? () => setParams({ complete: sessionId }) : undefined}
                />
              ) : null}

              {entry.response.assessment ? (
                <AssessmentCardView card={entry.response.assessment} />
              ) : null}

              {entry.extraAssessments.map((assessment) => (
                <AssessmentCardView key={assessment.assessment_id} card={assessment} />
              ))}

              {entry.response.notices.map((notice, i) => (
                <p key={`turn-notice-${i}`} className="notice">
                  {notice}
                </p>
              ))}

              {entry.assessmentNotices.map((notice, i) => (
                <p key={`assess-notice-${i}`} className="notice">
                  {notice}
                </p>
              ))}

              {entry.assessmentError ? (
                <p className="error-text" role="alert">
                  {entry.assessmentError}
                </p>
              ) : null}
            </div>
          );
        })}

        {completeId ? (
          <CompletionPanel sessionId={completeId} onDone={() => setParams({})} />
        ) : null}

        {sendError ? (
          <div className="error-bar" role="alert">
            <span>{sendError}</span>
            {failedMessage ? (
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={() => void send(failedMessage)}
                disabled={sending}
              >
                重试
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      <Composer
        value={draft}
        onChange={updateDraft}
        onSend={() => void send(draft)}
        sending={sending}
        inputRef={inputRef}
      />
    </>
  );
}