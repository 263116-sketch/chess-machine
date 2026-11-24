const DEFAULT_SETTINGS = {
  enabled: true,
  showArrow: true,
  showHud: true,
  depth: 14,
  multiPv: 2,
  arrowColor: '#16a34a'
};

let creatingOffscreen = null;
const latestAnalysisByTab = new Map();
let lastAnalysis = null;

chrome.runtime.onInstalled.addListener(async () => {
  const existing = await chrome.storage.local.get('settings');
  if (!existing.settings) {
    await chrome.storage.local.set({ settings: DEFAULT_SETTINGS });
  }
});

async function hasOffscreenDocument() {
  if (chrome.runtime.getContexts) {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT'],
      documentUrls: [chrome.runtime.getURL('offscreen.html')]
    });
    return contexts.length > 0;
  }
  if (chrome.offscreen && chrome.offscreen.hasDocument) {
    return await chrome.offscreen.hasDocument();
  }
  return false;
}

async function ensureOffscreenDocument() {
  if (await hasOffscreenDocument()) {
    return;
  }
  if (creatingOffscreen) {
    await creatingOffscreen;
    return;
  }
  creatingOffscreen = chrome.offscreen.createDocument({
    url: 'offscreen.html',
    reasons: ['WORKERS'],
    justification: 'Run local Stockfish 19 WebAssembly engine inside a Web Worker.'
  });
  try {
    await creatingOffscreen;
  } finally {
    creatingOffscreen = null;
  }
}

async function getSettings() {
  const res = await chrome.storage.local.get('settings');
  return { ...DEFAULT_SETTINGS, ...(res.settings || {}) };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.type) return false;

  if (message.type === 'GET_SETTINGS') {
    getSettings().then((settings) => sendResponse({ settings }));
    return true;
  }

  if (message.type === 'UPDATE_SETTINGS') {
    (async () => {
      const current = await getSettings();
      const next = { ...current, ...(message.settings || {}) };
      await chrome.storage.local.set({ settings: next });
      const tabs = await chrome.tabs.query({ url: 'https://www.chess.com/*' });
      for (const tab of tabs) {
        if (tab.id != null) {
          chrome.tabs.sendMessage(tab.id, { type: 'SETTINGS_CHANGED', settings: next }).catch(() => {});
        }
      }
      sendResponse({ settings: next });
    })();
    return true;
  }

  if (message.type === 'ANALYZE_FEN') {
    (async () => {
      try {
        await ensureOffscreenDocument();
        const settings = await getSettings();
        const tabId = sender.tab?.id ?? message.tabId ?? null;
        chrome.runtime.sendMessage({
          target: 'offscreen',
          type: 'ENGINE_ANALYZE',
          requestId: message.requestId || `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          fen: message.fen,
          depth: message.depth ?? settings.depth,
          multiPv: message.multiPv ?? settings.multiPv,
          tabId
        }).catch(() => {});
        sendResponse({ ok: true });
      } catch (err) {
        sendResponse({ ok: false, error: err?.message || 'Offscreen init failed' });
      }
    })();
    return true;
  }

  if (message.type === 'ENGINE_STOP') {
    chrome.runtime.sendMessage({ target: 'offscreen', type: 'ENGINE_STOP' }).catch(() => {});
    sendResponse({ ok: true });
    return false;
  }

  if (message.type === 'ENGINE_RESULT') {
    const payload = message.payload;
    lastAnalysis = payload;
    if (payload && payload.tabId != null) {
      latestAnalysisByTab.set(payload.tabId, payload);
      chrome.tabs.sendMessage(payload.tabId, {
        type: 'ANALYSIS_RESULT',
        payload
      }).catch(() => {});
    }
    chrome.runtime.sendMessage({
      type: 'POPUP_ANALYSIS_UPDATE',
      payload
    }).catch(() => {});
    return false;
  }

  if (message.type === 'GET_LATEST_ANALYSIS') {
    (async () => {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const activeTabId = tabs[0]?.id;
      const payload = (activeTabId != null && latestAnalysisByTab.get(activeTabId)) || lastAnalysis || null;
      sendResponse({ payload });
    })();
    return true;
  }

  return false;
});
