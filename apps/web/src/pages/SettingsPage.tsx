import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import {
  clearTrainingRecords,
  deleteAccount as deleteAccountRequest,
  patchAccount,
} from '../api/client';
import type { Account, AccountInput, ClearTrainingResult, Gender } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { DateField } from '../components/DateField';
import { ArrowLeftIcon, InfoIcon, WarnIcon } from '../components/Icons';
import { OptionField } from '../components/OptionField';

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
  });
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

  function update<K extends keyof AccountInput>(key: K, value: AccountInput[K]) {
    setValues((prev) => ({ ...prev, [key]: value }));
    setSaved(false);
    setSaveError(null);
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
      });
      setUser(res.user);
      setValues({
        nickname: res.user.nickname,
        birthday: res.user.birthday,
        gender: res.user.gender,
        bio: res.user.bio,
      });
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

  return (
    <div className="settings-page">
      <header className="settings-hd">
        <Link to="/profile" className="icon-btn" aria-label="返回我的">
          <ArrowLeftIcon />
        </Link>
        <h1>设置</h1>
        <span className="settings-hd__spacer" aria-hidden="true" />
      </header>

      <div className="body page-body">
        <form onSubmit={handleSave} noValidate>
          <section className="sec" aria-label="账号资料">
            <p className="group-label">账号资料</p>
            <div className="list-card">
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
                <span className="lbl">个性签名</span>
                <textarea
                  className="bio-input"
                  aria-label="个性签名"
                  maxLength={80}
                  rows={2}
                  placeholder="一句话介绍你的训练状态"
                  value={values.bio ?? ''}
                  onChange={(e) => update('bio', e.target.value)}
                />
              </label>
            </div>
            <p className="card-meta">签名 {(values.bio ?? '').length}/80</p>
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
    </div>
  );
}