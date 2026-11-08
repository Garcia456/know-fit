import { LazyMotion, domAnimation } from 'motion/react';
import { useCallback, useState } from 'react';
import { BrowserRouter, Route, Routes, useLocation, useNavigate } from 'react-router';
import { AuthGate } from './auth/AuthGate';
import { AuthProvider } from './auth/AuthContext';
import { HistoryDrawer } from './components/HistoryDrawer';
import { writeConversationId } from './lib/conversation';
import { PageSwipe } from './components/PageSwipe';
import { TopNav } from './components/TopNav';
import { ChatPage } from './pages/ChatPage';
import { DataPage } from './pages/DataPage';
import { LoginPage } from './pages/LoginPage';
import { ProfilePage } from './pages/ProfilePage';
import { RegisterPage } from './pages/RegisterPage';
import { SettingsPage } from './pages/SettingsPage';
import { StatsPage } from './pages/StatsPage';

/** 非会话三页路由；会话页常驻在 AppShell 里，不随 tab 切换卸载。 */
export function AppRoutes() {
  return (
    <Routes>
      <Route path="/stats" element={<StatsPage />} />
      <Route path="/data" element={<DataPage />} />
      <Route path="/profile" element={<ProfilePage />} />
    </Routes>
  );
}

/** 顶部导航 + 四页 + 历史抽屉。 */
export function AppShell() {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [resetToken, setResetToken] = useState(0);
  // 每次进入页面开新会话：不接上次留下的 id，历史要从抽屉里主动选
  const [activeConversationId, setActiveConversationId] = useState<string | null>(() => {
    writeConversationId(null);
    return null;
  });
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const chatActive = pathname === '/';

  const onConversationChange = useCallback((id: string | null) => {
    setActiveConversationId(id);
  }, []);

  function newConversation() {
    setDrawerOpen(false);
    writeConversationId(null);
    setActiveConversationId(null);
    setResetToken((n) => n + 1);
    navigate('/');
  }

  function selectConversation(id: string) {
    setDrawerOpen(false);
    writeConversationId(id);
    setActiveConversationId(id);
    navigate('/');
  }

  function conversationDeleted(id: string) {
    if (id !== activeConversationId) return;
    writeConversationId(null);
    setActiveConversationId(null);
    setResetToken((n) => n + 1);
    navigate('/');
  }

  return (
    <LazyMotion features={domAnimation} strict>
      <div className="app-shell">
        <TopNav
          onOpenHistory={() => setDrawerOpen(true)}
          onNewConversation={newConversation}
        />
        <PageSwipe>
          {/* 会话页常驻：切 tab 不卸载，未回复的消息与「思考中」不会丢 */}
          <div className="page-slot" hidden={!chatActive}>
            <ChatPage
              resetToken={resetToken}
              activeConversationId={activeConversationId}
              onConversationChange={onConversationChange}
              active={chatActive}
            />
          </div>
          <AppRoutes />
        </PageSwipe>
        <HistoryDrawer
          open={drawerOpen}
          activeConversationId={activeConversationId}
          onClose={() => setDrawerOpen(false)}
          onSelectConversation={selectConversation}
          onDeleted={conversationDeleted}
          onNewConversation={newConversation}
        />
      </div>
    </LazyMotion>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route
            path="/settings"
            element={
              <AuthGate>
                <SettingsPage />
              </AuthGate>
            }
          />
          <Route
            path="*"
            element={
              <AuthGate>
                <AppShell />
              </AuthGate>
            }
          />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
