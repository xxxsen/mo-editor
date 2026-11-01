import test from 'node:test';
import assert from 'node:assert/strict';
import { fitStartupWindow, startupWindowAdjustment } from '../src/startup-window.js';

const metrics = {
  viewportHeight: 950,
  inner: { width: 2160, height: 1425 },
  outer: { width: 2182, height: 1480 },
  position: { x: 266, y: 266 },
  workArea: { position: { x: 0, y: 0 }, size: { width: 3840, height: 2088 } },
  overflow: 260,
};

test('startup height fits the initial content at the display scale and stays on screen', () => {
  assert.deepEqual(startupWindowAdjustment(metrics), { width: 2160, height: 1818, x: 266, y: 215 });
});

test('startup height is limited to the monitor work area when content cannot fit', () => {
  const workArea = { position: { x: -1920, y: -100 }, size: { width: 1920, height: 1200 } };
  assert.deepEqual(startupWindowAdjustment({ ...metrics, workArea, position: { x: -1800, y: 50 } }),
    { width: 2160, height: 1145, x: -1800, y: -100 });
});

test('a resize during startup cancels the pending automatic adjustment', async () => {
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  let unchanged = true;
  const calls = [];
  try {
    const nativeWindow = {
      innerSize: async () => { unchanged = false; return metrics.inner; },
      outerSize: async () => metrics.outer,
      outerPosition: async () => metrics.position,
      setSize: async () => calls.push('size'),
      setPosition: async () => calls.push('position'),
    };
    globalThis.window = { innerHeight: metrics.viewportHeight, __TAURI__: { window: {
      getCurrentWindow: () => nativeWindow,
      currentMonitor: async () => ({ workArea: metrics.workArea }),
      PhysicalSize: class {}, PhysicalPosition: class {},
    } } };
    globalThis.document = {
      querySelector: () => ({ scrollHeight: 730, clientHeight: 470 }),
      documentElement: { scrollHeight: 950, clientHeight: 950 },
    };
    await fitStartupWindow(() => unchanged);
    assert.deepEqual(calls, []);
  } finally {
    if (originalWindow === undefined) delete globalThis.window; else globalThis.window = originalWindow;
    if (originalDocument === undefined) delete globalThis.document; else globalThis.document = originalDocument;
  }
});
