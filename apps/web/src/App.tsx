import { BrowserRouter, Route, Routes } from 'react-router';
import { ChatPage } from './pages/ChatPage';
import { DataPage } from './pages/DataPage';
import { ProfilePage } from './pages/ProfilePage';

/**
 * 三页路由骨架（技术方案 §五）。
 * ⚠️ 只建路由与空占位页 —— **页面内容归 dev-006**（dev-001 §二 第 9 条）。
 */
export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<ChatPage />} />
      <Route path="/data" element={<DataPage />} />
      <Route path="/profile" element={<ProfilePage />} />
    </Routes>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  );
}