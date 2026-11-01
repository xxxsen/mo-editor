// Physical window measurements are used so Windows display scaling is respected.
export function startupWindowAdjustment({ viewportHeight, inner, outer, position, workArea, overflow }) {
  if (!viewportHeight || !inner?.height || !workArea?.size?.height || !workArea?.position) return null;

  const frameHeight = Math.max(0, outer.height - inner.height);
  const availableHeight = workArea.size.height - frameHeight;
  if (availableHeight <= 0) return null;

  const growth = overflow > 0 ? Math.ceil((overflow + 2) * inner.height / viewportHeight) : 0;
  const height = Math.min(inner.height + growth, availableHeight);
  const top = workArea.position.y;
  const bottom = top + workArea.size.height;
  const y = Math.max(top, Math.min(position.y, bottom - height - frameHeight));
  return { width: inner.width, height, x: position.x, y };
}

// This is called once after the initial project has loaded, never on later edits or resizes.
export async function fitStartupWindow(isUnchanged) {
  const api = window.__TAURI__?.window;
  if (!api?.getCurrentWindow || !api.currentMonitor || !api.PhysicalSize || !api.PhysicalPosition || !isUnchanged()) return;

  const viewportHeight = window.innerHeight;
  const detail = document.querySelector('.detail-body');
  const sidebar = document.querySelector('.sidebar');
  const overflow = Math.max(0,
    (detail?.scrollHeight || 0) - (detail?.clientHeight || 0),
    (sidebar?.scrollHeight || 0) - (sidebar?.clientHeight || 0),
    document.documentElement.scrollHeight - document.documentElement.clientHeight);
  const appWindow = api.getCurrentWindow();
  const [inner, outer, position, monitor] = await Promise.all([
    appWindow.innerSize(), appWindow.outerSize(), appWindow.outerPosition(), api.currentMonitor(),
  ]);
  if (!monitor || !isUnchanged()) return;

  const adjustment = startupWindowAdjustment({ viewportHeight, inner, outer, position, workArea: monitor.workArea, overflow });
  if (!adjustment || !isUnchanged()) return;
  if (adjustment.height !== inner.height) await appWindow.setSize(new api.PhysicalSize(adjustment.width, adjustment.height));
  if (adjustment.y !== position.y) await appWindow.setPosition(new api.PhysicalPosition(adjustment.x, adjustment.y));
}
