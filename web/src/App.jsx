import { useEffect } from "react";
import { NavLink, Route, Routes } from "react-router-dom";
import CardPage from "./pages/CardPage";
import TutorPage from "./pages/TutorPage";
import NotebookPage from "./pages/NotebookPage";
import PullPage from "./pages/PullPage";
import SearchPage from "./pages/SearchPage";
import SettingsPage from "./pages/SettingsPage";
import { emitPanelShow } from "./lib/usePanelShow";

export default function App() {
  // 面板每次显示（含收起后再打开）都通知页面一声：用户刚在 PDF 里选完字就开面板，
  // 这时候应该直接看到那段选区，不用再点一次「读取当前选区」。
  useEffect(() => {
    const onPanelShow = () => emitPanelShow();
    window.__onPanelShow = onPanelShow;
    return () => {
      if (window.__onPanelShow === onPanelShow) delete window.__onPanelShow;
    };
  }, []);

  return (
    <div className="app">
      <header className="app-head">
        <span className="brand">懒学</span>
        <nav className="tabs">
          <NavLink to="/" end>
            摘录制卡
          </NavLink>
          <NavLink to="/tutor">助教</NavLink>
          <NavLink to="/search">考点找题</NavLink>
          <NavLink to="/pull">取回卡片</NavLink>
          <NavLink to="/notebook">专题导入</NavLink>
          <NavLink to="/settings">设置</NavLink>
        </nav>
      </header>
      <main className="app-main">
        <Routes>
          <Route path="/" element={<CardPage />} />
          <Route path="/tutor" element={<TutorPage />} />
          <Route path="/search" element={<SearchPage />} />
          <Route path="/pull" element={<PullPage />} />
          <Route path="/notebook" element={<NotebookPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
      </main>
    </div>
  );
}
