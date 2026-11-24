const btnEnabled = document.getElementById('btn-enabled');
const evalScoreEl = document.getElementById('eval-score');
const bestMoveEl = document.getElementById('best-move');
const turnLabelEl = document.getElementById('turn-label');
const depthLabelEl = document.getElementById('depth-label');
const pvListEl = document.getElementById('pv-list');
const depthInput = document.getElementById('input-depth');
const depthValEl = document.getElementById('depth-val');
const multiPvSelect = document.getElementById('select-multipv');
const chkArrow = document.getElementById('chk-arrow');
const chkHud = document.getElementById('chk-hud');
const fenInput = document.getElementById('fen-input');
const btnAnalyzeFen = document.getElementById('btn-analyze-fen');

let currentSettings = {
  enabled: true,
  showArrow: true,
  showHud: true,
  depth: 14,
  multiPv: 2,
  arrowColor: '#16a34a'
};

function formatScore(line) {
  if (!line) return '0.00';
  if (line.mate != null) {
    return line.mate > 0 ? `+M${line.mate}` : `-M${Math.abs(line.mate)}`;
  }
  if (line.cp != null) {
    const val = (line.cp / 100).toFixed(2);
    return line.cp >= 0 ? `+${val}` : val;
  }
  return '0.00';
}

function renderSettings() {
  btnEnabled.textContent = currentSettings.enabled ? '활성' : '일시정지';
  btnEnabled.classList.toggle('is-off', !currentSettings.enabled);
  depthInput.value = String(currentSettings.depth);
  depthValEl.textContent = String(currentSettings.depth);
  multiPvSelect.value = String(currentSettings.multiPv);
  chkArrow.checked = Boolean(currentSettings.showArrow);
  chkHud.checked = Boolean(currentSettings.showHud);
}

function saveSettings(partial) {
  currentSettings = { ...currentSettings, ...partial };
  renderSettings();
  chrome.runtime.sendMessage({ type: 'UPDATE_SETTINGS', settings: currentSettings });
}

function renderAnalysis(payload) {
  if (!payload) return;
  if (payload.fen && document.activeElement !== fenInput) {
    fenInput.value = payload.fen;
  }

  evalScoreEl.textContent = formatScore(payload);
  if (payload.bestMove && payload.bestMove.length >= 4) {
    bestMoveEl.textContent = `${payload.bestMove.slice(0, 2)} → ${payload.bestMove.slice(2, 4)}`;
  } else {
    bestMoveEl.textContent = '--';
  }

  turnLabelEl.textContent = `차례: ${payload.sideToMove === 'b' ? '흑 (Black)' : '백 (White)'}`;
  depthLabelEl.textContent = `탐색 깊이: d${payload.depth || 0}`;

  if (Array.isArray(payload.lines) && payload.lines.length > 0) {
    pvListEl.innerHTML = payload.lines
      .map((line) => {
        const moves = (line.pv || []).slice(0, 5).join(' ');
        return `<li class="pv-item"><span class="pv-score">${formatScore(line)}</span><span class="pv-moves">${moves}</span></li>`;
      })
      .join('');
  }
}

btnEnabled.addEventListener('click', () => {
  saveSettings({ enabled: !currentSettings.enabled });
});

depthInput.addEventListener('input', () => {
  depthValEl.textContent = depthInput.value;
});

depthInput.addEventListener('change', () => {
  saveSettings({ depth: parseInt(depthInput.value, 10) });
});

multiPvSelect.addEventListener('change', () => {
  saveSettings({ multiPv: parseInt(multiPvSelect.value, 10) });
});

chkArrow.addEventListener('change', () => {
  saveSettings({ showArrow: chkArrow.checked });
});

chkHud.addEventListener('change', () => {
  saveSettings({ showHud: chkHud.checked });
});

btnAnalyzeFen.addEventListener('click', () => {
  const fen = fenInput.value.trim();
  if (!fen) return;
  chrome.runtime.sendMessage({
    type: 'ANALYZE_FEN',
    fen,
    depth: currentSettings.depth,
    multiPv: currentSettings.multiPv
  });
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg && msg.type === 'POPUP_ANALYSIS_UPDATE') {
    renderAnalysis(msg.payload);
  }
});

chrome.runtime.sendMessage({ type: 'GET_SETTINGS' }, (res) => {
  if (res && res.settings) {
    currentSettings = { ...currentSettings, ...res.settings };
  }
  renderSettings();
});

chrome.runtime.sendMessage({ type: 'GET_LATEST_ANALYSIS' }, (res) => {
  if (res && res.payload) {
    renderAnalysis(res.payload);
  }
});
