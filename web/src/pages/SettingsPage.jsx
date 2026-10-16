import { useCallback, useEffect, useState } from "react";
import { getSession, login, logout, me, saveBaseUrl } from "../lib/pluginApi";

export default function SettingsPage() {
  const [baseUrl, setBaseUrl] = useState("");
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    try {
      const current = await getSession();
      setSession(current);
      setBaseUrl(current?.baseUrl || "");
      setUsername(current?.username || "");
    } catch (issue) {
      setError(issue.message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleSaveBaseUrl() {
    setError("");
    setNotice("");
    try {
      const saved = await saveBaseUrl(baseUrl);
      setSession(saved);
      setNotice(`接口地址已保存：${saved.baseUrl}`);
    } catch (issue) {
      setError(issue.message);
    }
  }

  async function handleLogin() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await login(username, password);
      setSession({ baseUrl: result.baseUrl, username: result.username, loggedIn: result.loggedIn });
      setProfile(result.profile || null);
      setPassword("");
      setNotice(`已登录：${result.profile?.nickname || result.username}`);
    } catch (issue) {
      setError(issue.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleCheck() {
    setError("");
    setNotice("");
    try {
      const current = await me();
      setProfile(current);
      setNotice(`连接正常：${current?.nickname || current?.username || "已登录"}`);
    } catch (issue) {
      setError(issue.message);
    }
  }

  async function handleLogout() {
    setError("");
    setNotice("");
    try {
      const result = await logout();
      setSession(result);
      setProfile(null);
      setNotice("已退出登录");
    } catch (issue) {
      setError(issue.message);
    }
  }

  return (
    <section className="page">
      <h2>懒学账号</h2>
      <p className="hint">
        当前状态：{session?.loggedIn ? `已登录 ${session.username}` : "未登录"}
        {profile?.nickname ? ` · ${profile.nickname}` : ""}
      </p>

      <label className="field">
        <span>接口地址</span>
        <input value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} />
      </label>
      <div className="row">
        <button type="button" className="ghost" onClick={handleSaveBaseUrl}>
          保存接口地址
        </button>
        <button type="button" className="ghost" onClick={handleCheck} disabled={!session?.loggedIn}>
          测试连接
        </button>
      </div>

      <h2>登录</h2>
      <label className="field">
        <span>账号</span>
        <input value={username} onChange={(event) => setUsername(event.target.value)} />
      </label>
      <label className="field">
        <span>密码</span>
        <input
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") handleLogin();
          }}
        />
      </label>
      <div className="row">
        <button type="button" onClick={handleLogin} disabled={busy || !username || !password}>
          {busy ? "正在登录…" : "登录"}
        </button>
        <button type="button" className="ghost" onClick={handleLogout} disabled={!session?.loggedIn}>
          退出登录
        </button>
      </div>

      {error ? <p className="error">{error}</p> : null}
      {notice ? <p className="ok">{notice}</p> : null}
      <p className="hint">密码只用于换取会话，会话存在 MarginNote 插件设置里，不会写进网页缓存。</p>
    </section>
  );
}
