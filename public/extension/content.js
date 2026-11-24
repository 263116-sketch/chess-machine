(() => {
  const PIECE_MAP = {
    wp: 'P', wn: 'N', wb: 'B', wr: 'R', wq: 'Q', wk: 'K',
    bp: 'p', bn: 'n', bb: 'b', br: 'r', bq: 'q', bk: 'k'
  };

  let settings = {
    enabled: true,
    showArrow: true,
    showHud: true,
    depth: 14,
    multiPv: 2,
    arrowColor: '#16a34a'
  };

  let lastBoardKey = '';
  let lastGrid = null;
  let castlingRights = { K: true, Q: true, k: true, q: true };
  let lastAnalysis = null;
  let debounceTimer = null;
  let boardObserver = null;
  let observedBoardEl = null;

  function findBoardElement() {
    return (
      document.querySelector('wc-chess-board') ||
      document.querySelector('chess-board') ||
      document.querySelector('.board')
    );
  }

  function isBoardFlipped(board) {
    return board.classList.contains('flipped') || board.hasAttribute('flipped');
  }

  function readBoardGrid(board) {
    const grid = Array.from({ length: 8 }, () => Array(8).fill(null));
    const pieceEls = board.querySelectorAll('.piece');
    let count = 0;

    pieceEls.forEach((el) => {
      if (el.classList.contains('dragging')) return;
      const cls = el.getAttribute('class') || '';
      const pieceMatch = cls.match(/\b([wb][pnbrqk])\b/);
      const sqMatch = cls.match(/\bsquare-(\d)(\d)\b/);
      if (!pieceMatch || !sqMatch) return;

      const file = parseInt(sqMatch[1], 10) - 1; // 0..7 (a..h)
      const rank = parseInt(sqMatch[2], 10) - 1; // 0..7 (1..8)
      if (file < 0 || file > 7 || rank < 0 || rank > 7) return;

      const fenChar = PIECE_MAP[pieceMatch[1]];
      if (!fenChar) return;

      const row = 7 - rank; // row 0 is rank 8
      grid[row][file] = fenChar;
      count++;
    });

    return { grid, count };
  }

  function gridToPlacement(grid) {
    return grid
      .map((row) => {
        let out = '';
        let empty = 0;
        for (const cell of row) {
          if (!cell) {
            empty++;
          } else {
            if (empty > 0) {
              out += empty;
              empty = 0;
            }
            out += cell;
          }
        }
        if (empty > 0) out += empty;
        return out;
      })
      .join('/');
  }

  function detectMoveListPlyCount() {
    const moveNodes = document.querySelectorAll(
      'wc-simple-move-list .node, .move-list .node, .vertical-move-list .node, [data-ply]'
    );
    if (moveNodes.length > 0) {
      let maxPly = 0;
      moveNodes.forEach((node) => {
        const plyAttr = node.getAttribute('data-ply');
        if (plyAttr) {
          const p = parseInt(plyAttr, 10);
          if (!Number.isNaN(p) && p > maxPly) maxPly = p;
        }
      });
      return maxPly > 0 ? maxPly : moveNodes.length;
    }
    return null;
  }

  function detectSideToMove(board, grid) {
    const plies = detectMoveListPlyCount();
    if (plies !== null && plies > 0) {
      return plies % 2 === 0 ? 'w' : 'b';
    }

    const flipped = isBoardFlipped(board);
    const bottomActive = document.querySelector('.clock-bottom.clock-player-turn');
    const topActive = document.querySelector('.clock-top.clock-player-turn');
    if (bottomActive) return flipped ? 'b' : 'w';
    if (topActive) return flipped ? 'w' : 'b';

    if (lastGrid) {
      let whiteChanged = false;
      let blackChanged = false;
      for (let r = 0; r < 8; r++) {
        for (let f = 0; f < 8; f++) {
          const prev = lastGrid[r][f];
          const curr = grid[r][f];
          if (prev !== curr) {
            if ((prev && prev === prev.toUpperCase()) || (curr && curr === curr.toUpperCase())) {
              whiteChanged = true;
            }
            if ((prev && prev === prev.toLowerCase()) || (curr && curr === curr.toLowerCase())) {
              blackChanged = true;
            }
          }
        }
      }
      if (whiteChanged && !blackChanged) return 'b';
      if (blackChanged && !whiteChanged) return 'w';
    }

    return 'w';
  }

  function updateCastlingRights(placement, grid) {
    if (placement === 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR') {
      castlingRights = { K: true, Q: true, k: true, q: true };
    }
    if (grid[7][4] !== 'K') {
      castlingRights.K = false;
      castlingRights.Q = false;
    }
    if (grid[7][7] !== 'R') castlingRights.K = false;
    if (grid[7][0] !== 'R') castlingRights.Q = false;

    if (grid[0][4] !== 'k') {
      castlingRights.k = false;
      castlingRights.q = false;
    }
    if (grid[0][7] !== 'r') castlingRights.k = false;
    if (grid[0][0] !== 'r') castlingRights.q = false;

    const str =
      (castlingRights.K ? 'K' : '') +
      (castlingRights.Q ? 'Q' : '') +
      (castlingRights.k ? 'k' : '') +
      (castlingRights.q ? 'q' : '');
    return str || '-';
  }

  function buildFen(board) {
    const { grid, count } = readBoardGrid(board);
    if (count < 2) return null;

    const placement = gridToPlacement(grid);
    const turn = detectSideToMove(board, grid);
    const castling = updateCastlingRights(placement, grid);
    const plies = detectMoveListPlyCount();
    const fullmove = plies ? Math.floor(plies / 2) + 1 : 1;

    lastGrid = grid;
    return {
      fen: `${placement} ${turn} ${castling} - 0 ${fullmove}`,
      key: `${placement}|${turn}|${castling}`,
      turn
    };
  }

  function squareToCenter(sq, flipped) {
    const file = sq.charCodeAt(0) - 97; // a=0..h=7
    const rank = parseInt(sq[1], 10) - 1; // 1=0..8=7
    const xIdx = flipped ? 7 - file : file;
    const yIdx = flipped ? rank : 7 - rank;
    return {
      x: xIdx * 100 + 50,
      y: yIdx * 100 + 50,
      rectX: xIdx * 100,
      rectY: yIdx * 100
    };
  }

  function ensureOverlaySvg(board) {
    let svg = board.querySelector(':scope > svg.ca-board-overlay');
    if (!svg) {
      svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('class', 'ca-board-overlay');
      svg.setAttribute('viewBox', '0 0 800 800');
      svg.setAttribute('preserveAspectRatio', 'none');
      board.appendChild(svg);
    }
    return svg;
  }

  function clearOverlay(board) {
    const svg = board?.querySelector(':scope > svg.ca-board-overlay');
    if (svg) svg.innerHTML = '';
  }

  function renderOverlay(board, analysis) {
    if (!board) return;
    if (!settings.enabled || !settings.showArrow || !analysis || !analysis.bestMove) {
      clearOverlay(board);
      return;
    }

    const svg = ensureOverlaySvg(board);
    const flipped = isBoardFlipped(board);
    const lines = analysis.lines && analysis.lines.length > 0
      ? analysis.lines
      : [{ multipv: 1, bestMove: analysis.bestMove }];

    let markup = '<defs>';
    lines.forEach((line, idx) => {
      const color = idx === 0 ? (settings.arrowColor || '#16a34a') : idx === 1 ? '#0284c7' : '#d97706';
      markup += `
        <marker id="ca-arrow-head-${idx}" markerWidth="4" markerHeight="4" refX="2.5" refY="2" orient="auto">
          <path d="M 0 0 L 4 2 L 0 4 z" fill="${color}" />
        </marker>`;
    });
    markup += '</defs>';

    const primary = lines[0]?.bestMove;
    if (primary && primary.length >= 4) {
      const fromPt = squareToCenter(primary.slice(0, 2), flipped);
      const toPt = squareToCenter(primary.slice(2, 4), flipped);
      const primaryColor = settings.arrowColor || '#16a34a';
      markup += `<rect x="${fromPt.rectX}" y="${fromPt.rectY}" width="100" height="100" fill="${primaryColor}" fill-opacity="0.16" />`;
      markup += `<rect x="${toPt.rectX}" y="${toPt.rectY}" width="100" height="100" fill="${primaryColor}" fill-opacity="0.24" />`;
    }

    // Draw secondary lines behind primary arrow
    for (let i = lines.length - 1; i >= 0; i--) {
      const uci = lines[i]?.bestMove;
      if (!uci || uci.length < 4) continue;
      const from = squareToCenter(uci.slice(0, 2), flipped);
      const to = squareToCenter(uci.slice(2, 4), flipped);
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const len = Math.hypot(dx, dy) || 1;
      const shortenEnd = 22;
      const x2 = to.x - (dx / len) * shortenEnd;
      const y2 = to.y - (dy / len) * shortenEnd;
      const color = i === 0 ? (settings.arrowColor || '#16a34a') : i === 1 ? '#0284c7' : '#d97706';
      const opacity = i === 0 ? '0.92' : '0.45';
      const width = i === 0 ? '15' : '10';

      markup += `
        <line
          x1="${from.x}" y1="${from.y}"
          x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}"
          stroke="${color}"
          stroke-width="${width}"
          stroke-linecap="round"
          stroke-opacity="${opacity}"
          marker-end="url(#ca-arrow-head-${i})"
        />`;
    }

    svg.innerHTML = markup;
  }

  function formatEval(analysis) {
    if (!analysis) return '--';
    if (analysis.mate != null) {
      return analysis.mate > 0 ? `+M${analysis.mate}` : `-M${Math.abs(analysis.mate)}`;
    }
    if (analysis.cp != null) {
      const val = (analysis.cp / 100).toFixed(2);
      return analysis.cp >= 0 ? `+${val}` : val;
    }
    return '0.00';
  }

  function ensureHud() {
    let hud = document.getElementById('ca-floating-hud');
    if (!hud) {
      hud = document.createElement('div');
      hud.id = 'ca-floating-hud';
      hud.innerHTML = `
        <div class="ca-hud-row">
          <span class="ca-hud-title">Stockfish 19</span>
          <button type="button" class="ca-hud-toggle" id="ca-hud-toggle-btn">ON</button>
        </div>
        <div class="ca-hud-metrics">
          <span class="ca-hud-eval" id="ca-hud-eval">--</span>
          <span class="ca-hud-move" id="ca-hud-move">대기 중</span>
          <span class="ca-hud-depth" id="ca-hud-depth">d0</span>
        </div>
      `;
      document.body.appendChild(hud);
      hud.querySelector('#ca-hud-toggle-btn').addEventListener('click', () => {
        const nextEnabled = !settings.enabled;
        chrome.runtime.sendMessage({
          type: 'UPDATE_SETTINGS',
          settings: { enabled: nextEnabled }
        });
      });
    }
    return hud;
  }

  function updateHud(analysis) {
    if (!settings.showHud) {
      const existing = document.getElementById('ca-floating-hud');
      if (existing) existing.style.display = 'none';
      return;
    }
    const hud = ensureHud();
    hud.style.display = 'flex';
    const toggleBtn = hud.querySelector('#ca-hud-toggle-btn');
    const evalEl = hud.querySelector('#ca-hud-eval');
    const moveEl = hud.querySelector('#ca-hud-move');
    const depthEl = hud.querySelector('#ca-hud-depth');

    toggleBtn.textContent = settings.enabled ? 'ON' : 'OFF';
    toggleBtn.classList.toggle('ca-off', !settings.enabled);

    if (!settings.enabled) {
      evalEl.textContent = 'PAUSE';
      moveEl.textContent = '일시정지';
      depthEl.textContent = '-';
      return;
    }

    if (analysis && analysis.bestMove) {
      evalEl.textContent = formatEval(analysis);
      const from = analysis.bestMove.slice(0, 2);
      const to = analysis.bestMove.slice(2, 4);
      const promo = analysis.bestMove.slice(4) ? `=${analysis.bestMove.slice(4).toUpperCase()}` : '';
      moveEl.textContent = `${from} → ${to}${promo}`;
      depthEl.textContent = `d${analysis.depth || 0}`;
    }
  }

  function scheduleEvaluation(force = false) {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      const board = findBoardElement();
      if (!board) return;

      if (!settings.enabled) {
        clearOverlay(board);
        updateHud(lastAnalysis);
        return;
      }

      const parsed = buildFen(board);
      if (!parsed) return;

      if (!force && parsed.key === lastBoardKey) {
        renderOverlay(board, lastAnalysis);
        return;
      }

      lastBoardKey = parsed.key;
      chrome.runtime.sendMessage({
        type: 'ANALYZE_FEN',
        fen: parsed.fen,
        depth: settings.depth,
        multiPv: settings.multiPv
      }).catch(() => {});
    }, 160);
  }

  function attachBoardObserver() {
    const board = findBoardElement();
    if (!board) return;
    if (observedBoardEl === board) return;

    if (boardObserver) boardObserver.disconnect();
    observedBoardEl = board;

    boardObserver = new MutationObserver(() => {
      scheduleEvaluation(false);
    });
    boardObserver.observe(board, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class']
    });

    scheduleEvaluation(true);
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (!message || !message.type) return;

    if (message.type === 'ANALYSIS_RESULT') {
      lastAnalysis = message.payload;
      const board = findBoardElement();
      if (board) renderOverlay(board, lastAnalysis);
      updateHud(lastAnalysis);
    }

    if (message.type === 'SETTINGS_CHANGED') {
      settings = { ...settings, ...(message.settings || {}) };
      const board = findBoardElement();
      if (!settings.enabled) {
        chrome.runtime.sendMessage({ type: 'ENGINE_STOP' }).catch(() => {});
        if (board) clearOverlay(board);
        updateHud(lastAnalysis);
      } else {
        updateHud(lastAnalysis);
        scheduleEvaluation(true);
      }
    }
  });

  chrome.runtime.sendMessage({ type: 'GET_SETTINGS' }, (resp) => {
    if (resp && resp.settings) {
      settings = { ...settings, ...resp.settings };
    }
    attachBoardObserver();
    updateHud(lastAnalysis);
  });

  // Watch for Chess.com SPA route transitions replacing the board node
  const rootObserver = new MutationObserver(() => {
    const board = findBoardElement();
    if (board && board !== observedBoardEl) {
      lastBoardKey = '';
      lastGrid = null;
      attachBoardObserver();
    }
  });
  rootObserver.observe(document.documentElement, { childList: true, subtree: true });
})();
