import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { getProfile, putProfile } from '../api/client';
import type { Account, Goal } from '../api/types';
import { useAuthUser } from '../auth/AuthContext';
import {
  FileTextIcon,
  FlameIcon,
  IdCardIcon,
  InfoIcon,
  SettingsIcon,
  WarnIcon,
} from '../components/Icons';
import { LoadError } from '../components/LoadError';
import { OptionField } from '../components/OptionField';
import { TrainingField } from '../components/TrainingField';
import { formatMd } from '../lib/format';
import {
  formatTraining,
  parseProfileForm,
  toFormValues,
  totalTrainingMonths,
  type ProfileFormValues,
} from '../lib/profile';

const GOALS: Goal[] = ['增肌', '减脂', '维持', '增肌+减脂'];

/** 读取失败时用它占住表单；此时保存关闭，免得用空白覆盖库里已有档案 */
const EMPTY_VALUES: ProfileFormValues = {
  height: '',
  weight: '',
  goal: null,
  years: null,
  months: null,
};

/** 账号摘要：年龄按生日算好了，签名跟在后面。 */
function accountSummary(user: Account): string {
  const bits: string[] = [];
  if (user.age !== null) bits.push(`${user.age} 岁`);
  if (user.gender) bits.push(user.gender);
  if (user.bio) bits.push(user.bio);
  return bits.length ? bits.join(' · ') : '账号资料还没填';
}

function avatarText(user: Account): string {
  const first = Array.from(user.nickname.trim())[0];
  return first ?? '我';
}

/** 个人信息页：账号摘要 + 身体档案四字段读写。显示「已保存」之前必须真的写成功。 */
export function ProfilePage() {
  const user = useAuthUser();
  const [values, setValues] = useState<ProfileFormValues | null>(null);
  const [weightDate, setWeightDate] = useState<string | null>(null);
  const [errors, setErrors] = useState<Partial<Record<'height' | 'weight', string>>>({});
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);
  const hydrated = useRef(false);
  const savedKey = useRef<string | null>(null);
  const saveSeq = useRef(0);

  useEffect(() => {
    let alive = true;
    setLoadError(null);
    setLoaded(false);
    getProfile()
      .then((p) => {
        if (!alive) return;
        setValues(toFormValues(p));
        setWeightDate(p.weight_date);
        setLoaded(true);
      })
      .catch((e: unknown) => {
        if (!alive) return;
        setValues(EMPTY_VALUES);
        setLoadError(e instanceof Error ? e.message : '档案加载失败');
      });
    return () => {
      alive = false;
    };
  }, [reloadTick]);

  function update<K extends keyof ProfileFormValues>(key: K, value: ProfileFormValues[K]) {
    setValues((prev) => (prev ? { ...prev, [key]: value } : prev));
    setSaved(false);
    setSaveError(null);
    if (key === 'height' || key === 'weight') {
      setErrors((prev) => ({ ...prev, [key]: undefined }));
    }
  }

  // 改完就存：输入停 800ms / 选项点完立刻进入这里。无效值不写库，失焦时才报错。
  useEffect(() => {
    if (!values || !loaded || loadError) return;
    const key = JSON.stringify(values);
    if (!hydrated.current) {
      hydrated.current = true;
      savedKey.current = key;
      return;
    }
    if (key === savedKey.current) return;

    const seq = ++saveSeq.current;
    const parsed = parseProfileForm(values);
    if (!parsed.ok) return;

    const timer = setTimeout(() => {
      setSaving(true);
      setSaveError(null);
      putProfile(parsed.input)
        .then((savedProfile) => {
          if (seq !== saveSeq.current) return;
          // 以服务端回读为准；期间没有再改才覆盖表单
          const next = toFormValues(savedProfile);
          savedKey.current = JSON.stringify(next);
          setValues(next);
          setWeightDate(savedProfile.weight_date);
          setErrors({});
          setSaved(true);
        })
        .catch((e: unknown) => {
          if (seq !== saveSeq.current) return;
          setSaveError(e instanceof Error ? e.message : '保存失败，请重试');
          setSaved(false);
        })
        .finally(() => {
          if (seq === saveSeq.current) setSaving(false);
        });
    }, 800);

    return () => clearTimeout(timer);
  }, [values, loaded, loadError]);

  function showErrors() {
    const parsed = parseProfileForm(values ?? EMPTY_VALUES);
    setErrors(parsed.ok ? {} : parsed.errors);
  }

  if (!values) {
    return (
      <div className="body page-body">
        <p className="page-hint">正在加载…</p>
      </div>
    );
  }

  const goalText = values.goal
    ? values.goal === '增肌+减脂'
      ? values.goal
      : `${values.goal}期`
    : '目标未填';
  const trainingMonths = totalTrainingMonths(values.years, values.months);

  return (
    <div className="body page-body">
      <div className="profile profile--account">
        <span className="avatar" aria-hidden="true">
          {user?.avatar ? (
            <img className="avatar__img" src={user.avatar} alt="" />
          ) : user ? (
            avatarText(user)
          ) : (
            '我'
          )}
        </span>
        <div>
          <h2>{user?.nickname ?? '我的档案'}</h2>
          <p>
            {loadError
              ? '档案没读出来'
              : `${goalText} · ${
                  trainingMonths === null
                    ? '训练年限未填'
                    : `训练 ${formatTraining(values.years, values.months)}`
                }`}
          </p>
          {user ? <p className="profile-bio">{accountSummary(user)}</p> : null}
        </div>
        {user ? (
          <Link to="/settings" className="profile-settings" aria-label="设置">
            <SettingsIcon />
          </Link>
        ) : null}
      </div>

      {loadError ? (
        <LoadError
          message={`档案没读出来 · ${loadError}`}
          onRetry={() => setReloadTick((n) => n + 1)}
        />
      ) : null}

      <div>
        <section className="sec" aria-label="身体数据">
          <p className="group-label icon-label">
            <IdCardIcon />
            身体数据
          </p>
          <div className="list-card">
            <label className="set-row">
              <span className="lbl">身高</span>
              <span className="val">
                <input
                  className="set-input"
                  inputMode="decimal"
                  aria-label="身高（cm）"
                  placeholder="—"
                  value={values.height}
                  onChange={(e) => update('height', e.target.value)}
                  onBlur={showErrors}
                  aria-invalid={errors.height ? true : undefined}
                />
                <span className="unit">cm</span>
              </span>
            </label>
            <label className="set-row">
              <span className="lbl">体重</span>
              <span className="val">
                <input
                  className="set-input"
                  inputMode="decimal"
                  aria-label="体重（kg）"
                  placeholder="—"
                  value={values.weight}
                  onChange={(e) => update('weight', e.target.value)}
                  onBlur={showErrors}
                  aria-invalid={errors.weight ? true : undefined}
                />
                <span className="unit">kg</span>
                {weightDate ? (
                  <span className="date-hint">· {formatMd(weightDate)}</span>
                ) : null}
              </span>
            </label>
            <div className="set-row">
              <span className="lbl">目标</span>
              <span className="val">
                <OptionField
                  label="目标"
                  value={values.goal ?? ''}
                  options={[
                    { value: '', label: '未填' },
                    ...GOALS.map((g) => ({ value: g, label: g })),
                  ]}
                  onChange={(v) => update('goal', (v || null) as Goal | null)}
                />
              </span>
            </div>
          </div>
          {errors.height ? <p className="error-text">{errors.height}</p> : null}
          {errors.weight ? <p className="error-text">{errors.weight}</p> : null}
          <p className="card-meta">体重保存时记入当天；同一天再改会覆盖当天数字。</p>
        </section>

        <section className="sec" aria-label="训练" style={{ marginTop: 16 }}>
          <p className="group-label icon-label">
            <FlameIcon />
            训练
          </p>
          <div className="list-card">
            <div className="set-row">
              <span className="lbl">训练年限</span>
              <span className="val">
                <TrainingField
                  years={values.years}
                  months={values.months}
                  onChange={(years, months) => {
                    setValues((prev) => (prev ? { ...prev, years, months } : prev));
                    setSaved(false);
                    setSaveError(null);
                  }}
                />
              </span>
            </div>
            <button
              type="button"
              className="set-row is-disabled"
              disabled
              aria-label="每周频率（未开放）"
            >
              <span className="lbl">每周频率</span>
              <span className="val">未开放</span>
            </button>
            <button
              type="button"
              className="set-row is-disabled"
              disabled
              aria-label="自动换算磅（未开放）"
            >
              <span className="lbl">自动换算磅（lb）</span>
              <span className="val">未开放</span>
            </button>
          </div>
        </section>

        {trainingMonths !== null && trainingMonths < 3 ? (
          <div className="note-inline">
            <WarnIcon />
            <p>训练不足 3 个月时，这里只给通用建议，不出基于训练数据的评估。</p>
          </div>
        ) : null}

        <section className="sec" aria-label="隐私与数据" style={{ marginTop: 16 }}>
          <p className="group-label icon-label">
            <FileTextIcon />
            隐私与数据
          </p>
          <div className="list-card">
            <button
              type="button"
              className="set-row is-disabled"
              disabled
              aria-label="导出我的数据（未开放）"
            >
              <span className="lbl">导出我的数据</span>
              <span className="val">未开放</span>
            </button>
            <button
              type="button"
              className="set-row is-disabled"
              disabled
              aria-label="删除我的数据（未开放）"
            >
              <span className="lbl">删除我的数据</span>
              <span className="val">未开放</span>
            </button>
          </div>
          <div className="note-inline">
            <InfoIcon />
            <p>训练与身体数据只存在这套本地库里；导出与删除还没开放。</p>
          </div>
        </section>

        {saveError ? (
          <p className="error-text" role="alert">
            {saveError}
          </p>
        ) : null}

        {loadError || saving || saved ? (
          <div className="save-row">
            {loadError ? (
              <p className="saved-note">档案没读出来，重试后再改，免得覆盖库里已存的数据。</p>
            ) : saving ? (
              <p className="saved-note">正在保存…</p>
            ) : (
              <p className="saved-note" role="status">
                已自动保存
              </p>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}