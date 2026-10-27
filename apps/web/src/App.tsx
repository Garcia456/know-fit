import { LazyMotion, domAnimation } from 'motion/react';
import { useState } from 'react';
import { BrowserRouter, Route, Routes, useNavigate } from 'react-router';
import { HistoryDrawer } from './components/HistoryDrawer';
import { PageSwipe } from './components/PageSwipe';
import { TopNav } from './components/TopNav';
import { ChatPage } from './pages/ChatPage';
import { DataPage } from './pages/DataPage';
import { ProfilePage } from './pages/ProfilePage';
import { StatsPage } from './pages/StatsPage';

/** 四页路由；resetToken 传给聊天页做「新会话」。 */
export function AppRoutes({ resetToken = 0 }: { resetToken?: number }) {
  return (
    <Routes>
      <Route path="/" element={<ChatPage resetToken={resetToken} />} />
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
  const navigate = useNavigate();

  function newConversation() {
    setDrawerOpen(false);
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
          <AppRoutes resetToken={resetToken} />
        </PageSwipe>
        <HistoryDrawer
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          onSelectDate={(date) => {
            setDrawerOpen(false);
            navigate(`/data?date=${date}`);
          }}
          onNewConversation={newConversation}
        />
      </div>
    </LazyMotion>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <AppShell />
    </BrowserRouter>
  );
}
