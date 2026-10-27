import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { getMe, postLogin, postLogout, postRegister } from '../api/client';
import type { Account } from '../api/types';

type Status = 'loading' | 'anonymous' | 'authenticated';

interface AuthValue {
  status: Status;
  user: Account | null;
  signIn: (email: string, password: string) => Promise<Account>;
  signUp: (input: { email: string; password: string; nickname: string }) => Promise<Account>;
  signOut: () => Promise<void>;
  setUser: (user: Account) => void;
}

const AuthContext = createContext<AuthValue | null>(null);

/** 启动时问一次「当前是谁」；任何 401 都退回未登录，交给 AuthGate 跳转。 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('loading');
  const [user, setUserState] = useState<Account | null>(null);

  useEffect(() => {
    let alive = true;
    getMe()
      .then(({ user: me }) => {
        if (!alive) return;
        setUserState(me);
        setStatus('authenticated');
      })
      .catch(() => {
        if (!alive) return;
        setUserState(null);
        setStatus('anonymous');
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    function onUnauthorized() {
      setUserState(null);
      setStatus('anonymous');
    }
    window.addEventListener('kf:unauthorized', onUnauthorized);
    return () => window.removeEventListener('kf:unauthorized', onUnauthorized);
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const { user: me } = await postLogin(email, password);
    setUserState(me);
    setStatus('authenticated');
    return me;
  }, []);

  const signUp = useCallback(
    async (input: { email: string; password: string; nickname: string }) => {
      const { user: me } = await postRegister(input);
      setUserState(me);
      setStatus('authenticated');
      return me;
    },
    [],
  );

  const signOut = useCallback(async () => {
    try {
      await postLogout();
    } catch {
      // 服务端没答也照样清本地 —— 不然「退出」会卡在设置页
    }
    setUserState(null);
    setStatus('anonymous');
  }, []);

  const setUser = useCallback((me: Account) => setUserState(me), []);

  const value = useMemo(
    () => ({ status, user, signIn, signUp, signOut, setUser }),
    [status, user, signIn, signUp, signOut, setUser],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth 必须在 AuthProvider 里用');
  return value;
}

/** 单独渲染的页面（组件测试里）拿不到 Provider 时返回 null，不炸。 */
export function useAuthUser(): Account | null {
  return useContext(AuthContext)?.user ?? null;
}