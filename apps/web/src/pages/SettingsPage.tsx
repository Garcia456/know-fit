import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import {
  clearTrainingRecords,
  deleteAccountAiKey,
  deleteAccount as deleteAccountRequest,
  getAccountAi,
  patchAccount,
  postKnowledgeAccess,
  putAccountAiKey,
} from '../api/client';
import type {
  Account,
  AccountAi,
  AccountInput,
  ClearTrainingResult,
  Gender,
} from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { AvatarCropDialog } from '../components/AvatarCropDialog';
import { DateField } from '../components/DateField';
import { ArrowLeftIcon, InfoIcon, WarnIcon } from '../components/Icons';
import { OptionField } from '../components/OptionField';
import { loadAvatarImage, type AvatarImage } from '../lib/avatar';

const GENDER_OPTIONS = [
  { value: '', label: '不填' },
  { value: '男', label: '男' },
  { value: '女', label: '女' },
  { value: '其他', label: '其他' },
];

function todayKey(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function initialOf(name: string): string {
  return Array.from(name.trim())[0] ?? '我';
}

/** 设置页：改账号资料 / 清空训练记录 / 退出 / 注销。 */
export function SettingsPage() {
  const { user } = useAuth();
  // 表单初值只在拿到用户后建，免得先用空值渲染再被吞掉
  if (!user) return null;
  return <SettingsForm user={user} />;
}

function SettingsForm({ user }: { user: Account }) {
  const { setUser, signOut } = useAuth();
  const navigate = useNavigate();

  const [values, setValues] = useState<AccountInput>({
    nickname: user.nickname,
    birthday: user.birthday,
    gender: user.gender,
    bio: user.bio,
    avatar: user.avatar,
  });
  const [avatarDirty, setAvatarDirty] = useState(false);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const [avatarPreview, setAvatarPreview] = useState(false);
  const [cropSource, setCropSource] = useState<AvatarImage | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [confirmClear, setConfirmClear] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [cleared, setCleared] = useState<ClearTrainingResult | null>(null);
  const [clearError, setClearError] = useState<string | null>(null);

  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteWord, setDeleteWord] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const [inviteCode, setInviteCode] = useState('');
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);

  const [ai, setAi] = useState<AccountAi | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [modelChoice, setModelChoice] = useState<'system' | 'deepseek-flash'>('system');
  const [keyBusy, setKeyBusy] = useState(false);
  const [keySaved, setKeySaved] = useState(false);
  const [keyError, setKeyError] = useState<string | null>(null);

  function update<K extends keyof AccountInput>(key: K, value: AccountInput[K]) {
    setValues((prev) => ({ ...prev, [key]: value }));
    setSaved(false);
    setSaveError(null);
  }

  // 预览层打开时锁住背景滚动，Esc 可关
  useEffect(() => {
    if (!avatarPreview) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setAvatarPreview(false);
    }
    window.addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [avatarPreview]);

  // AI 状态单独取：账号信息里没有 Key 状态，且授权可能刚在别处变过
  useEffect(() => {
    let cancelled = false;
    getAccountAi()
      .then((view) => {
        if (cancelled) return;
        setAi(view);
        // 下拉只暴露「系统」与 deepseek-flash；已有 Key 就落到 deepseek 档
        setModelChoice(view.key ? 'deepseek-flash' : 'system');
      })
      .catch((e: unknown) => {
        if (!cancelled) setAiError(e instanceof Error ? e.message : 'AI 设置读不出来');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleAvatarFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // 同一张图再选一次也要触发 change
    event.target.value = '';
    if (!file) return;
    setAvatarError(null);
    setAvatarBusy(true);
    try {
      const source = await loadAvatarImage(file);
      setCropSource(source);
      setAvatarPreview(false);
    } catch (e) {
      setAvatarError(e instanceof Error ? e.message : '图片处理失败，换一张试试');
    } finally {
      setAvatarBusy(false);
    }
  }

  function closeCrop() {
    if (cropSource) URL.revokeObjectURL(cropSource.url);
    setCropSource(null);
  }

  function applyCrop(avatar: string) {
    setValues((prev) => ({ ...prev, avatar }));
    setAvatarDirty(true);
    setSaved(false);
    setSaveError(null);
    closeCrop();
  }

  async function handleSave(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    const nickname = values.nickname.trim();
    if (nickname.length === 0 || nickname.length > 20) {
      setSaveError('昵称 1–20 字');
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const res = await patchAccount({
        nickname,
        birthday: values.birthday,
        gender: values.gender,
        bio: values.bio?.trim() ? values.bio.trim() : null,
        ...(avatarDirty ? { avatar: values.avatar ?? null } : {}),
      });
      setUser(res.user);
      setValues({
        nickname: res.user.nickname,
        birthday: res.user.birthday,
        gender: res.user.gender,
        bio: res.user.bio,
        avatar: res.user.avatar,
      });
      setAvatarDirty(false);
      setSaved(true);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : '保存失败，请重试');
      setSaved(false);
    } finally {
      setSaving(false);
    }
  }

  async function handleClear() {
    if (clearing) return;
    setClearing(true);
    setClearError(null);
    try {
      const res = await clearTrainingRecords();
      setCleared(res.cleared);
      setConfirmClear(false);
    } catch (e) {
      setClearError(e instanceof Error ? e.message : '清空失败，请重试');
    } finally {
      setClearing(false);
    }
  }

  async function handleDelete() {
    if (deleting || deleteWord.trim() !== '注销') return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteAccountRequest();
      await signOut();
      navigate('/login', { replace: true });
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : '注销失败，请重试');
      setDeleting(false);
    }
  }

  async function handleSignOut() {
    await signOut();
    navigate('/login', { replace: true });
  }

  async function handleUnlockKnowledge(event: FormEvent) {
    event.preventDefault();
    const code = inviteCode.trim();
    if (inviteBusy || code.length === 0) return;
    setInviteBusy(true);
    setInviteError(null);
    try {
      await postKnowledgeAccess(code);
      setUser({ ...user, invite_unlocked: true });
      setInviteCode('');
    } catch (e) {
      setInviteError(e instanceof Error ? e.message : '邀请码验证失败，请重试');
    } finally {
      setInviteBusy(false);
    }
  }

  async function handleSaveAi(event: FormEvent) {
    event.preventDefault();
    if (keyBusy || !ai) return;
    const key = apiKey.trim();
    if (modelChoice === 'deepseek-flash' && key.length < 8) return;
    setKeyBusy(true);
    setKeyError(null);
    setKeySaved(false);
    try {
      if (modelChoice === 'system') {
        if (ai.key) await deleteAccountAiKey();
        setAi((prev) => (prev ? { ...prev, key: null } : prev));
        setApiKey('');
        setKeySaved(true);
        return;
      }
      const res = await putAccountAiKey(key, 'deepseek-flash');
      setAi((prev) => (prev ? { ...prev, key: res.key } : prev));
      // 明文只进请求：保存后立刻清空输入框，不回填
      setApiKey('');
      setKeySaved(true);
    } catch (e) {
      setKeyError(e instanceof Error ? e.message : 'Key 没保存成功，请重试');
    } finally {
      setKeyBusy(false);
    }
  }

  function handleModelChange(value: string) {
    setModelChoice(value === 'system' ? 'system' : 'deepseek-flash');
    setKeyError(null);
    setKeySaved(false);
    if (value === 'system') setApiKey('');
  }

  const hasKey = ai?.key != null;

  return (
    <div className="settings-page">
      <header className="settings-hd">
        <Link to="/profile" className="icon-btn" aria-label="返回我的">
          <ArrowLeftIcon />
        </Link>
        <h1>设置</h1>
        <span className="settings-hd__spacer" aria-hidden="true" />
      </header>

      <div className="body page-body settings-body">
        <form onSubmit={handleSave} noValidate>
          <section className="sec" aria-label="账号资料">
            <p className="group-label">账号资料</p>
            <div className="list-card">
              <div className="set-row">
                <span className="lbl">头像</span>
                <span className="val">
                  <button
                    type="button"
                    className="avatar avatar--sm avatar-btn"
                    aria-label="查看头像"
                    onClick={() => setAvatarPreview(true)}
                  >
                    {values.avatar ? (
                      <img className="avatar__img" src={values.avatar} alt="" />
                    ) : (
                      initialOf(values.nickname)
                    )}
                  </button>
                </span>
              </div>
              <div className="set-row">
                <span className="lbl">邮箱</span>
                <span className="val">{user.email}</span>
              </div>
              <label className="set-row">
                <span className="lbl">昵称</span>
                <input
                  className="set-input"
                  aria-label="昵称"
                  maxLength={20}
                  placeholder="怎么称呼你"
                  value={values.nickname}
                  onChange={(e) => update('nickname', e.target.value)}
                />
              </label>
              <div className="set-row">
                <span className="lbl">生日</span>
                <span className="val">
                  <DateField
                    label="生日"
                    compact
                    minYear={1930}
                    defaultValue="2000-01-01"
                    value={values.birthday ?? ''}
                    max={todayKey()}
                    onChange={(v) => update('birthday', v || null)}
                  />
                </span>
              </div>
              <div className="set-row">
                <span className="lbl">性别</span>
                <span className="val">
                  <OptionField
                    label="性别"
                    value={values.gender ?? ''}
                    options={GENDER_OPTIONS}
                    onChange={(v) => update('gender', (v || null) as Gender | null)}
                  />
                </span>
              </div>
              <label className="set-row set-row--stack">
                <span className="bio-hd">
                  <span className="lbl">个性签名</span>
                  <span className="bio-count">{(values.bio ?? '').length}/60</span>
                </span>
                <textarea
                  className="bio-input"
                  aria-label="个性签名"
                  maxLength={60}
                  rows={2}
                  placeholder="一句话介绍你的训练状态"
                  value={values.bio ?? ''}
                  onChange={(e) => update('bio', e.target.value)}
                />
              </label>
            </div>

            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              aria-label="选择头像图片"
              style={{ display: 'none' }}
              onChange={handleAvatarFile}
            />

            {avatarError ? (
              <p className="error-text" role="alert">
                {avatarError}
              </p>
            ) : null}
          </section>

          {saveError ? (
            <p className="error-text" role="alert">
              {saveError}
            </p>
          ) : null}
          <div className="save-row">
            <button type="submit" className="btn btn--block" disabled={saving}>
              {saving ? '正在保存…' : '保存资料'}
            </button>
            {saved ? <p className="saved-note">已保存</p> : null}
          </div>
        </form>

        <section className="sec" aria-label="知识库" style={{ marginTop: 20 }}>
          <p className="group-label">知识库</p>
          {user.invite_unlocked ? (
            <div className="list-card">
              <div className="set-row">
                <span className="lbl">知识库</span>
                <span className="val">已开启</span>
              </div>
            </div>
          ) : (
            <form onSubmit={handleUnlockKnowledge} noValidate>
              <div className="list-card">
                <label className="set-row">
                  <span className="lbl">邀请码</span>
                  <input
                    className="set-input"
                    style={{ width: 168 }}
                    aria-label="知识库邀请码"
                    placeholder="填入邀请码"
                    autoComplete="off"
                    spellCheck={false}
                    value={inviteCode}
                    onChange={(e) => {
                      setInviteCode(e.target.value);
                      setInviteError(null);
                    }}
                  />
                </label>
              </div>
              {inviteError ? (
                <p className="error-text" role="alert">
                  {inviteError}
                </p>
              ) : null}
              <div className="save-row">
                <button
                  type="submit"
                  className="btn btn--block"
                  disabled={inviteBusy || inviteCode.trim().length === 0}
                >
                  {inviteBusy ? '正在验证…' : '开启知识库'}
                </button>
              </div>
            </form>
          )}
          <div className="note-inline">
            <InfoIcon />
            <p>
              {user.invite_unlocked
                ? '训练建议会引用知识库里的博主原片，并附视频与起始时间戳。'
                : '没开启时，记录、统计与计划照常可用；知识类问题会提示先开启。'}
            </p>
          </div>
        </section>

        <section className="sec" aria-label="AI 模型" style={{ marginTop: 20 }}>
          <p className="group-label">AI 模型</p>
          {aiError ? (
            <p className="error-text" role="alert">
              {aiError}
            </p>
          ) : null}

          <form onSubmit={handleSaveAi} noValidate>
            <div className="list-card">
              <label className="set-row">
                <span className="lbl">模型</span>
                <select
                  className="set-select"
                  aria-label="模型"
                  value={modelChoice}
                  disabled={!ai}
                  onChange={(e) => handleModelChange(e.target.value)}
                >
                  <option value="system">系统</option>
                  <option value="deepseek-flash">deepseek-flash</option>
                </select>
              </label>
              {modelChoice === 'deepseek-flash' ? (
                <label className="set-row">
                  <span className="lbl">API Key</span>
                  <input
                    className="set-input"
                    style={{ width: 200 }}
                    type="password"
                    aria-label="DeepSeek API Key"
                    placeholder={
                      hasKey
                        ? `已保存（末 4 位 ${ai?.key?.hint ?? ''}），填入新 Key 可替换`
                        : 'sk-...'
                    }
                    autoComplete="new-password"
                    spellCheck={false}
                    value={apiKey}
                    onChange={(e) => {
                      setApiKey(e.target.value);
                      setKeyError(null);
                      setKeySaved(false);
                    }}
                  />
                </label>
              ) : null}
            </div>

            {keyError ? (
              <p className="error-text" role="alert">
                {keyError}
              </p>
            ) : null}
            <div className="save-row">
              <button
                type="submit"
                className="btn btn--block"
                disabled={
                  keyBusy ||
                  !ai ||
                  (modelChoice === 'deepseek-flash' && apiKey.trim().length < 8)
                }
              >
                {keyBusy
                  ? '正在保存…'
                  : modelChoice === 'deepseek-flash'
                    ? '保存 Key'
                    : '保存'}
              </button>
              {keySaved ? (
                <p className="saved-note" role="status">
                  已保存
                </p>
              ) : null}
            </div>
          </form>

          <div className="note-inline">
            <InfoIcon />
            <p>
              Key 只用于你自己的对话，服务端加密保存、只显示末 4 位；Embedding
              与重排仍走服务端。端点固定为 DeepSeek，不接受其他地址。
            </p>
          </div>
        </section>

        <section className="sec" aria-label="训练记录" style={{ marginTop: 20 }}>
          <p className="group-label">训练记录</p>
          <div className="list-card">
            <button
              type="button"
              className="set-row set-row--button"
              onClick={() => {
                setConfirmClear(true);
                setCleared(null);
                setClearError(null);
              }}
            >
              <span className="lbl">清空训练记录</span>
              <span className="val">不可撤销</span>
            </button>
          </div>

          {confirmClear ? (
            <div className="danger-box" role="alertdialog" aria-label="确认清空训练记录">
              <p>
                会删除全部训练、动作、对话、评估与提示记录；身体档案和体重历史保留。
              </p>
              <div className="danger-actions">
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  onClick={() => setConfirmClear(false)}
                >
                  取消
                </button>
                <button
                  type="button"
                  className="btn btn--danger btn--sm"
                  onClick={handleClear}
                  disabled={clearing}
                >
                  {clearing ? '正在清空…' : '确认清空'}
                </button>
              </div>
            </div>
          ) : null}

          {clearError ? (
            <p className="error-text" role="alert">
              {clearError}
            </p>
          ) : null}
          {cleared ? (
            <p className="saved-note" role="status">
              已清空：训练 {cleared.sessions} 次 · 对话 {cleared.turns} 条 · 评估{' '}
              {cleared.assessments} 份 · 提示 {cleared.nudges} 条
            </p>
          ) : null}

          <div className="note-inline">
            <InfoIcon />
            <p>档案与体重历史不在这项里 —— 清空训练不会把身体数据一起抹掉。</p>
          </div>
        </section>

        <section className="sec" aria-label="账号" style={{ marginTop: 20 }}>
          <p className="group-label">账号</p>
          <div className="list-card">
            <button type="button" className="set-row set-row--button" onClick={handleSignOut}>
              <span className="lbl">退出登录</span>
              <span className="val">这台设备</span>
            </button>
            <button
              type="button"
              className="set-row set-row--button is-danger"
              onClick={() => {
                setConfirmDelete(true);
                setDeleteWord('');
                setDeleteError(null);
              }}
            >
              <span className="lbl">注销账号</span>
              <span className="val">永久删除</span>
            </button>
          </div>

          {confirmDelete ? (
            <div className="danger-box" role="alertdialog" aria-label="确认注销账号">
              <p>
                <WarnIcon />
                账号、训练记录、身体档案会一起删除，无法恢复。输入「注销」确认。
              </p>
              <input
                className="set-input"
                aria-label="输入注销确认"
                placeholder="注销"
                value={deleteWord}
                onChange={(e) => setDeleteWord(e.target.value)}
              />
              {deleteError ? (
                <p className="error-text" role="alert">
                  {deleteError}
                </p>
              ) : null}
              <div className="danger-actions">
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  onClick={() => setConfirmDelete(false)}
                  disabled={deleting}
                >
                  取消
                </button>
                <button
                  type="button"
                  className="btn btn--danger btn--sm"
                  onClick={handleDelete}
                  disabled={deleting || deleteWord.trim() !== '注销'}
                >
                  {deleting ? '正在注销…' : '确认注销'}
                </button>
              </div>
            </div>
          ) : null}
        </section>
      </div>

      {avatarPreview ? (
        <div
          className="dialog-mask dialog-mask--avatar"
          role="presentation"
          onClick={() => setAvatarPreview(false)}
        >
          <div className="avatar-preview-wrap">
            <div className="avatar-preview" role="img" aria-label="头像大图">
              {values.avatar ? (
                <img src={values.avatar} alt="当前头像" />
              ) : (
                <span>{initialOf(values.nickname)}</span>
              )}
            </div>
            <button
              type="button"
              className="avatar-preview__change"
              disabled={avatarBusy}
              onClick={(e) => {
                e.stopPropagation();
                fileRef.current?.click();
              }}
            >
              {avatarBusy ? '处理中…' : '更换头像'}
            </button>
          </div>
        </div>
      ) : null}

      {cropSource ? (
        <AvatarCropDialog source={cropSource} onCancel={closeCrop} onConfirm={applyCrop} />
      ) : null}
    </div>
  );
}
