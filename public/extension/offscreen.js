let worker = null;
let engineReady = false;
let isSearching = false;
let currentSearch = null;
let pendingSearch = null;

function initEngine() {
  if (worker) return;
  worker = new Worker(chrome.runtime.getURL('engine/stockfish-19-lite-single.js'));

  worker.onmessage = (event) => {
    const line = typeof event.data === 'string' ? event.data : String(event.data || '');
    handleUciLine(line);
  };

  worker.onerror = (err) => {
    console.error('[Stockfish Offscreen] Worker error:', err);
  };

  worker.postMessage('uci');
}

function sendUci(cmd) {
  if (!worker) initEngine();
  worker.postMessage(cmd);
}

function startSearch(req) {
  if (!engineReady) {
    pendingSearch = req;
    return;
  }

  if (isSearching) {
    pendingSearch = req;
    sendUci('stop');
    return;
  }

  const sideToMove = (req.fen.split(' ')[1] || 'w') === 'b' ? 'b' : 'w';
  currentSearch = {
    requestId: req.requestId,
    fen: req.fen,
    targetDepth: Math.max(4, Math.min(22, Number(req.depth) || 14)),
    multiPv: Math.max(1, Math.min(3, Number(req.multiPv) || 2)),
    tabId: req.tabId,
    sideToMove,
    lines: {},
    lastEmitDepth: 0
  };
  isSearching = true;

  sendUci(`setoption name MultiPV value ${currentSearch.multiPv}`);
  sendUci(`position fen ${currentSearch.fen}`);
  sendUci(`go depth ${currentSearch.targetDepth}`);
}

function parseInfoLine(line) {
  if (!currentSearch) return;
  const tokens = line.trim().split(/\s+/);
  let depth = null;
  let multipv = 1;
  let scoreType = null;
  let scoreVal = null;
  let nodes = null;
  let nps = null;
  let pv = [];

  for (let i = 1; i < tokens.length; i++) {
    const t = tokens[i];
    if (t === 'depth' && tokens[i + 1]) {
      depth = parseInt(tokens[++i], 10);
    } else if (t === 'multipv' && tokens[i + 1]) {
      multipv = parseInt(tokens[++i], 10);
    } else if (t === 'nodes' && tokens[i + 1]) {
      nodes = parseInt(tokens[++i], 10);
    } else if (t === 'nps' && tokens[i + 1]) {
      nps = parseInt(tokens[++i], 10);
    } else if (t === 'score' && tokens[i + 1] && tokens[i + 2]) {
      scoreType = tokens[++i];
      scoreVal = parseInt(tokens[++i], 10);
    } else if (t === 'pv') {
      pv = tokens.slice(i + 1);
      break;
    }
  }

  if (depth == null || scoreType == null || scoreVal == null || pv.length === 0) return;
  if (scoreType !== 'cp' && scoreType !== 'mate') return;

  // Normalize score to White's perspective
  const perspectiveSign = currentSearch.sideToMove === 'b' ? -1 : 1;
  const whiteCp = scoreType === 'cp' ? scoreVal * perspectiveSign : null;
  const whiteMate = scoreType === 'mate' ? scoreVal * perspectiveSign : null;

  currentSearch.lines[multipv] = {
    multipv,
    depth,
    scoreType,
    cp: whiteCp,
    mate: whiteMate,
    sideCp: scoreType === 'cp' ? scoreVal : null,
    sideMate: scoreType === 'mate' ? scoreVal : null,
    pv,
    bestMove: pv[0]
  };

  if (multipv === 1 && depth >= 4 && depth !== currentSearch.lastEmitDepth && depth % 2 === 0) {
    currentSearch.lastEmitDepth = depth;
    emitResult(false);
  }
}

function emitResult(isFinal, bestMoveOverride, ponderOverride) {
  if (!currentSearch) return;
  const sortedLines = Object.values(currentSearch.lines).sort((a, b) => a.multipv - b.multipv);
  const top = sortedLines[0] || null;
  const bestMove = bestMoveOverride || top?.bestMove || null;
  if (!bestMove || bestMove === '(none)') return;

  chrome.runtime.sendMessage({
    type: 'ENGINE_RESULT',
    payload: {
      requestId: currentSearch.requestId,
      tabId: currentSearch.tabId,
      fen: currentSearch.fen,
      sideToMove: currentSearch.sideToMove,
      depth: top?.depth || currentSearch.targetDepth,
      bestMove,
      ponder: ponderOverride || null,
      cp: top?.cp ?? null,
      mate: top?.mate ?? null,
      lines: sortedLines,
      isFinal,
      timestamp: Date.now()
    }
  }).catch(() => {});
}

function handleUciLine(line) {
  if (line === 'uciok') {
    sendUci('isready');
    return;
  }

  if (line === 'readyok') {
    engineReady = true;
    if (pendingSearch) {
      const next = pendingSearch;
      pendingSearch = null;
      startSearch(next);
    }
    return;
  }

  if (line.startsWith('info ')) {
    parseInfoLine(line);
    return;
  }

  if (line.startsWith('bestmove ')) {
    const parts = line.trim().split(/\s+/);
    const bestMove = parts[1] || null;
    const ponderIdx = parts.indexOf('ponder');
    const ponder = ponderIdx !== -1 ? parts[ponderIdx + 1] : null;

    if (!pendingSearch && currentSearch) {
      emitResult(true, bestMove, ponder);
    }

    isSearching = false;
    currentSearch = null;

    if (pendingSearch) {
      const next = pendingSearch;
      pendingSearch = null;
      startSearch(next);
    }
  }
}

chrome.runtime.onMessage.addListener((message) => {
  if (!message || message.target !== 'offscreen') return;

  if (message.type === 'ENGINE_ANALYZE') {
    initEngine();
    startSearch(message);
  } else if (message.type === 'ENGINE_STOP') {
    pendingSearch = null;
    if (isSearching) {
      sendUci('stop');
    }
  }
});

initEngine();
