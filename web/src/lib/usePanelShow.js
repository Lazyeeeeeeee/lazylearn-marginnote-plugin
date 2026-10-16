import { useEffect } from "react";

// 面板被收起再打开时，MN 侧会调 window.__onPanelShow()（见 src/WebPanelController.js
// 的 viewWillAppear）。App 里把它转成一个事件，页面各自决定要不要重新读选区。
const PANEL_SHOW_EVENT = "lazylearn:panel-show";

export function emitPanelShow() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(PANEL_SHOW_EVENT));
}

export function usePanelShow(handler) {
  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const listener = () => handler();
    window.addEventListener(PANEL_SHOW_EVENT, listener);
    return () => window.removeEventListener(PANEL_SHOW_EVENT, listener);
  }, [handler]);
}
