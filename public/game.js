'use strict';
/* global io */

const socket = io();

// ── State ──────────────────────────────────────────────────────────────────
let myId = null;
let myName = '';
let roomCode = '';
let isHost = false;
let currentCzarId = null;
let currentBlackCard = null;
let selectedCards = [];   // indices into hand array
let handCards = [];        // full hand from server
let timerInterval = null;
let timerTotal = 0;
let nextRoundTimer = null;

// ── Utilities ──────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  $(id).classList.add('active');
}

function setError(id, msg) { $(id).textContent = msg; }
function clearError(id) { $(id).textContent = ''; }

function renderCardText(text) {
  return (text || '').replace(/___/g, '<span class="blank"></span>');
}

function renderCard(card, opts = {}) {
  const { selectable, order, winner, clickable, imageAbove } = opts;
  const isWild = card.type === 'wild';
  const hasImage = card.image;

  let inner = '';
  if (hasImage) {
    inner += `<img src="${card.image}" style="width:100%;max-height:80px;object-fit:cover;margin-bottom:.4rem;display:block" alt="">`;
  }
  if (isWild) {
    inner += '<span style="color:var(--cyan);font-style:italic">WILD — type anything</span>';
  } else {
    inner += renderCardText(card.text);
  }

  const classes = ['white-card'];
  if (selectable) classes.push('selectable-card');
  if (winner) classes.push('winner-highlight');

  const orderBadge = order != null ? `<span class="card-order">${order}</span>` : '';
  return `<div class="${classes.join(' ')}" data-wild="${isWild}" style="cursor:${clickable||selectable?'pointer':'default'}">${inner}${orderBadge}</div>`;
}

// ── Screens ────────────────────────────────────────────────────────────────
function goToMenu() {
  showScreen('s-menu');
  stopTimer();
  if (nextRoundTimer) clearTimeout(nextRoundTimer);
  roomCode = '';
  myId = null;
  isHost = false;
}

// Menu
$('btn-create').addEventListener('click', () => {
  const name = $('menu-name').value.trim();
  if (!name) return setError('menu-error', 'Enter your name');
  clearError('menu-error');
  myName = name;
  socket.emit('create-room', { name, options: gatherOptions() });
});

$('btn-goto-join').addEventListener('click', () => {
  $('join-name').value = $('menu-name').value;
  showScreen('s-join');
});

// Join
$('btn-back-menu').addEventListener('click', () => showScreen('s-menu'));

$('join-code').addEventListener('input', e => {
  e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
});

$('btn-join').addEventListener('click', () => {
  const name = $('join-name').value.trim();
  const code = $('join-code').value.trim().toUpperCase();
  if (!name) return setError('join-error', 'Enter your name');
  if (code.length !== 6) return setError('join-error', 'Enter the 6-character room code');
  clearError('join-error');
  myName = name;
  socket.emit('join-room', { code, name });
});

// ── Lobby ─────────────────────────────────────────────────────────────────
function gatherOptions() {
  return {
    scoreGoal: Number($('opt-score')?.value) || 7,
    timerSeconds: Number($('opt-timer')?.value) || 60,
    rando: $('opt-rando')?.checked ?? true,
    packs: getSelectedPacks(),
  };
}

function getSelectedPacks() {
  const checked = document.querySelectorAll('#pack-grid input:checked');
  const packs = [...checked].map(el => el.value);
  return packs.length ? packs : ['all'];
}

// Sync options to server on change
['opt-score', 'opt-timer', 'opt-rando'].forEach(id => {
  const el = $(id);
  if (!el) return;
  el.addEventListener('change', () => {
    if (isHost) socket.emit('update-options', gatherOptions());
  });
});

function initPackGrid(packs) {
  const grid = $('pack-grid');
  grid.innerHTML = '';
  const allItem = document.createElement('label');
  allItem.className = 'pack-item';
  allItem.innerHTML = `<input type="checkbox" value="all"> ALL PACKS`;
  grid.appendChild(allItem);

  packs.forEach(pack => {
    const item = document.createElement('label');
    item.className = 'pack-item';
    item.innerHTML = `<input type="checkbox" value="${pack.id}" checked> ${pack.name.toUpperCase()}`;
    grid.appendChild(item);
  });

  grid.querySelectorAll('input').forEach(el => {
    el.addEventListener('change', () => {
      if (el.value === 'all') {
        grid.querySelectorAll('input[value!="all"]').forEach(x => { x.checked = false; x.closest('.pack-item').classList.remove('selected'); });
        el.closest('.pack-item').classList.toggle('selected', el.checked);
      } else {
        $('pack-grid').querySelector('input[value="all"]').checked = false;
        $('pack-grid').querySelector('input[value="all"]').closest('.pack-item').classList.remove('selected');
        el.closest('.pack-item').classList.toggle('selected', el.checked);
      }
      if (isHost) socket.emit('update-options', gatherOptions());
    });
  });
}

$('btn-start').addEventListener('click', () => {
  clearError('lobby-error');
  socket.emit('start-game');
});

$('btn-leave-lobby').addEventListener('click', () => {
  socket.disconnect();
  socket.connect();
  goToMenu();
});

// ── Custom cards modal ────────────────────────────────────────────────────
let pendingImageCards = []; // { url, caption } objects awaiting add

$('btn-custom-cards').addEventListener('click', () => {
  $('modal-custom').classList.add('open');
});
$('btn-close-modal').addEventListener('click', () => {
  $('modal-custom').classList.remove('open');
  pendingImageCards = [];
  $('img-preview-wrap').classList.add('hidden');
  clearError('upload-error');
});
$('modal-custom').addEventListener('click', e => {
  if (e.target === $('modal-custom')) {
    $('modal-custom').classList.remove('open');
    pendingImageCards = [];
    $('img-preview-wrap').classList.add('hidden');
  }
});

// Image upload
$('btn-upload-img').addEventListener('click', async () => {
  clearError('upload-error');
  const file = $('img-upload').files[0];
  if (!file) return setError('upload-error', 'Select an image first');
  const form = new FormData();
  form.append('image', file);
  try {
    const res = await fetch('/upload/image', { method: 'POST', body: form });
    if (!res.ok) throw new Error('Upload failed');
    const { url } = await res.json();
    const caption = $('img-caption').value.trim();
    pendingImageCards.push({ image: url, text: caption || '' });
    $('img-preview').src = url;
    $('img-preview-label').textContent = `✓ Image queued (${pendingImageCards.length} total)`;
    $('img-preview-wrap').classList.remove('hidden');
    $('img-upload').value = '';
    $('img-caption').value = '';
  } catch { setError('upload-error', 'Upload failed — try again'); }
});

$('btn-add-custom').addEventListener('click', () => {
  clearError('modal-error');
  const blackLines = $('custom-black').value.split('\n').map(l => l.trim()).filter(Boolean);
  const whiteText = $('custom-white').value.split('\n').map(l => l.trim()).filter(Boolean);
  const white = [...whiteText, ...pendingImageCards];
  if (!blackLines.length && !white.length) return setError('modal-error', 'Enter at least one card');
  socket.emit('add-custom-cards', { black: blackLines, white });
  $('custom-black').value = '';
  $('custom-white').value = '';
  pendingImageCards = [];
  $('img-preview-wrap').classList.add('hidden');
  $('modal-custom').classList.remove('open');
});

// Community packs browser
$('btn-browse-community').addEventListener('click', async () => {
  $('modal-community').classList.add('open');
  $('community-pack-list').innerHTML = '<div class="spinner"></div>';
  try {
    const res = await fetch('/api/community-packs');
    const packs = await res.json();
    renderCommunityPacks(packs);
  } catch { $('community-pack-list').innerHTML = '<div class="text-muted">Failed to load packs.</div>'; }
});

$('btn-close-community').addEventListener('click', () => {
  $('modal-community').classList.remove('open');
});
$('modal-community').addEventListener('click', e => {
  if (e.target === $('modal-community')) $('modal-community').classList.remove('open');
});

function renderCommunityPacks(packs) {
  const list = $('community-pack-list');
  if (!packs.length) { list.innerHTML = '<div class="text-muted">No community packs yet. Be the first!</div>'; return; }
  list.innerHTML = packs.map(p => `
    <div class="pack-item" style="flex-direction:column;align-items:flex-start;width:100%;cursor:default;margin-bottom:.4rem">
      <div style="display:flex;justify-content:space-between;width:100%;align-items:center">
        <span style="color:var(--text)">${escHtml(p.name)}</span>
        <button class="btn btn-secondary" style="width:auto;padding:.3rem .7rem;font-size:.75rem"
          onclick="addCommunityPack(${p.id})">ADD</button>
      </div>
      <div class="text-muted">${p.black_count} black · ${p.white_count} white · by ${escHtml(p.author)}</div>
    </div>
  `).join('');
}

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

window.addCommunityPack = async (packId) => {
  try {
    const res = await fetch(`/api/community-packs/${packId}/cards`);
    const data = await res.json();
    socket.emit('add-custom-cards', { black: data.black, white: data.white });
    $('modal-community').classList.remove('open');
  } catch { alert('Failed to load pack'); }
};

// Save pack to community DB
$('btn-save-community').addEventListener('click', async () => {
  const packName = $('community-pack-name').value.trim();
  const authorName = myName || 'Anonymous';
  if (!packName) return setError('save-pack-error', 'Enter a pack name');
  const blackLines = $('custom-black').value.split('\n').map(l => l.trim()).filter(Boolean);
  const whiteText = $('custom-white').value.split('\n').map(l => l.trim()).filter(Boolean);
  const white = [...whiteText, ...pendingImageCards];
  if (!blackLines.length && !white.length) return setError('save-pack-error', 'Add some cards first');
  try {
    const res = await fetch('/api/community-packs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: packName, author: authorName, black: blackLines, white }),
    });
    if (!res.ok) throw new Error();
    setError('save-pack-error', '');
    $('community-pack-name').value = '';
    $('btn-save-community').textContent = '✓ SAVED!';
    setTimeout(() => { $('btn-save-community').textContent = 'SAVE TO COMMUNITY'; }, 2000);
  } catch { setError('save-pack-error', 'Failed to save pack'); }
});

// ── Timer ─────────────────────────────────────────────────────────────────
function startTimer(seconds) {
  stopTimer();
  if (!seconds) { $('timer-wrap').style.display = 'none'; return; }
  timerTotal = seconds;
  $('timer-wrap').style.display = '';
  $('timer-bar').style.transition = 'none';
  $('timer-bar').style.width = '100%';
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      $('timer-bar').style.transition = `width ${seconds}s linear`;
      $('timer-bar').style.width = '0%';
    });
  });
}

function stopTimer() {
  clearInterval(timerInterval);
  $('timer-bar').style.transition = 'none';
  $('timer-bar').style.width = '100%';
}

// ── Header ────────────────────────────────────────────────────────────────
function updateHeader(round, czarName, czarId, scores, players) {
  $('hdr-round').textContent = `ROUND ${round}`;
  $('hdr-czar').textContent = `CZAR: ${czarName}`;
  currentCzarId = czarId;

  const pills = $('hdr-scores');
  pills.innerHTML = '';
  const maxScore = Math.max(...players.map(p => p.score), 0);
  players.forEach(p => {
    const sc = scores[p.id] ?? 0;
    const pill = document.createElement('div');
    pill.className = 'score-pill' +
      (p.id === myId ? ' is-me' : '') +
      (p.id === czarId ? ' is-czar' : '') +
      (sc > 0 && sc === maxScore ? ' is-winning' : '');
    pill.textContent = `${p.name}: ${sc}`;
    pills.appendChild(pill);
  });
}

// ── Hand rendering ────────────────────────────────────────────────────────
function renderHand() {
  const container = $('hand-container');
  container.innerHTML = '';
  selectedCards = [];
  updateSubmitBtn();

  handCards.forEach((card, i) => {
    const el = document.createElement('div');
    const isWild = card.type === 'wild';
    el.className = 'white-card';
    el.dataset.index = i;
    el.dataset.wild = isWild;

    if (card.image) {
      const img = document.createElement('img');
      img.src = card.image;
      img.style.cssText = 'width:100%;max-height:70px;object-fit:cover;display:block;margin-bottom:.4rem';
      el.appendChild(img);
    }

    if (isWild) {
      el.innerHTML += '<span style="color:var(--cyan);font-style:italic;font-size:.78rem">✎ WILD</span>';
    } else {
      const span = document.createElement('span');
      span.innerHTML = renderCardText(card.text);
      el.appendChild(span);
    }

    el.addEventListener('click', () => onCardClick(i, el, isWild));
    container.appendChild(el);
  });
}

function onCardClick(idx, el, isWild) {
  if (myId === currentCzarId) return;
  const pick = currentBlackCard?.pick || 1;

  const already = selectedCards.indexOf(idx);
  if (already !== -1) {
    selectedCards.splice(already, 1);
    el.classList.remove('selected');
    el.querySelector('.card-order')?.remove();
    reindexOrders();
    updateSubmitBtn();
    return;
  }

  if (selectedCards.length >= pick) return;

  if (isWild) {
    const typed = prompt('Type your answer:');
    if (!typed || !typed.trim()) return;
    handCards[idx] = { ...handCards[idx], text: typed.trim(), type: 'wild-filled', originalWild: true };
    el.innerHTML = '';
    const span = document.createElement('span');
    span.innerHTML = escHtml(typed.trim());
    el.appendChild(span);
    el.dataset.wild = 'false';
  }

  selectedCards.push(idx);
  el.classList.add('selected');
  const orderEl = document.createElement('span');
  orderEl.className = 'card-order';
  orderEl.textContent = selectedCards.length;
  el.appendChild(orderEl);
  updateSubmitBtn();
}

function reindexOrders() {
  const container = $('hand-container');
  let orderNum = 1;
  [...container.children].forEach(el => {
    const orderEl = el.querySelector('.card-order');
    if (orderEl) orderEl.textContent = orderNum++;
  });
}

function updateSubmitBtn() {
  const pick = currentBlackCard?.pick || 1;
  $('btn-submit-cards').disabled = selectedCards.length !== pick;
  $('pick-label').textContent = pick;
  $('pick-badge').textContent = pick > 1 ? `PICK ${pick}` : '';
}

$('btn-submit-cards').addEventListener('click', () => {
  if (selectedCards.length !== (currentBlackCard?.pick || 1)) return;
  socket.emit('play-cards', { indices: selectedCards, typedCards: getTypedCards() });
  $('phase-playing').classList.add('hidden');
  $('hand-container').innerHTML = '';
  const status = document.createElement('div');
  status.className = 'status-text';
  status.textContent = 'Cards submitted! Waiting for others...';
  $('phase-playing').classList.remove('hidden');
  $('hand-container').appendChild(status);
  $('btn-submit-cards').style.display = 'none';
});

function getTypedCards() {
  const typed = {};
  selectedCards.forEach(idx => {
    const card = handCards[idx];
    if (card.originalWild) typed[idx] = card.text;
  });
  return typed;
}

// ── Socket events ─────────────────────────────────────────────────────────
socket.on('connect', () => { myId = socket.id; });

socket.on('room-created', ({ code }) => {
  roomCode = code;
  isHost = true;
  $('lobby-code').textContent = code;
  $('host-settings').classList.remove('hidden');
  $('guest-waiting').classList.add('hidden');
  fetch('/api/packs').then(r => r.json()).then(packs => initPackGrid(packs)).catch(() => {});
  showScreen('s-lobby');
});

socket.on('room-joined', ({ code }) => {
  roomCode = code;
  isHost = false;
  $('lobby-code').textContent = code;
  $('host-settings').classList.add('hidden');
  $('guest-waiting').classList.remove('hidden');
  showScreen('s-lobby');
});

socket.on('join-error', msg => setError('join-error', msg));
socket.on('error-msg', msg => setError('lobby-error', msg));

socket.on('lobby-update', ({ players, hostId, options, customCounts }) => {
  isHost = socket.id === hostId;
  if (isHost) {
    $('host-settings').classList.remove('hidden');
    $('guest-waiting').classList.add('hidden');
  } else {
    $('host-settings').classList.add('hidden');
    $('guest-waiting').classList.remove('hidden');
  }

  const list = $('lobby-players');
  list.innerHTML = '';
  players.forEach(p => {
    const item = document.createElement('div');
    item.className = 'player-item' + (p.id === hostId ? ' is-host' : '');
    item.innerHTML = `
      <span class="player-name">${escHtml(p.name)}${p.isRando ? ' <span style="color:var(--muted)">[BOT]</span>' : ''}</span>
      <span class="player-badge">${p.id === hostId ? 'HOST' : 'PLAYER'}</span>
    `;
    list.appendChild(item);
  });

  if (customCounts) {
    const total = customCounts.black + customCounts.white;
    $('custom-count').textContent = total ? `(${total})` : '';
  }

  if (options && isHost) {
    $('opt-score').value = options.scoreGoal;
    $('opt-timer').value = options.timerSeconds;
    $('opt-rando').checked = options.rando;
  }
});

socket.on('custom-cards-added', ({ count }) => {
  $('custom-count').textContent = `(${count.black + count.white})`;
});

socket.on('player-left', () => {});

socket.on('round-start', ({ blackCard, czarId, czarName, round, hand, scores, timerSeconds, players }) => {
  currentBlackCard = blackCard;
  handCards = hand;
  selectedCards = [];
  showScreen('s-game');

  // Header
  const playerList = players || Object.keys(scores).map(id => ({ id, score: scores[id], name: id }));
  updateHeader(round, czarName, czarId, scores, playerList);

  // Black card
  $('black-card-text').innerHTML = renderCardText(blackCard.text);
  $('pick-badge').textContent = blackCard.pick > 1 ? `PICK ${blackCard.pick}` : '';

  // Timer
  startTimer(timerSeconds);

  // Phase
  hideAllPhases();
  if (myId === czarId) {
    $('phase-czar-wait').classList.remove('hidden');
    $('czar-sub-count').textContent = `0/${playerList.filter(p => p.id !== czarId).length || '?'}`;
  } else {
    $('phase-playing').classList.remove('hidden');
    $('btn-submit-cards').style.display = '';
    $('pick-label').textContent = blackCard.pick;
    renderHand();
  }
});

socket.on('submission-count', ({ submitted, total }) => {
  $('sub-count-display').textContent = `${submitted} / ${total} submitted`;
  $('czar-sub-count').textContent = `${submitted}/${total}`;
});

socket.on('cards-played', () => {
  // Server confirmed our play
});

socket.on('judging-start', ({ submissions, czarId, blackCard }) => {
  hideAllPhases();
  stopTimer();
  currentBlackCard = blackCard;

  if (myId === czarId) {
    $('phase-judging').classList.remove('hidden');
    $('judge-label').textContent = 'PICK THE WINNING ANSWER';
    renderSubmissions(submissions, true);
  } else {
    $('phase-awaiting-czar').classList.remove('hidden');
    $('phase-judging').classList.remove('hidden');
    $('judge-label').textContent = 'THE SUBMISSIONS';
    renderSubmissions(submissions, false);
  }
});

function renderSubmissions(submissions, clickable) {
  const grid = $('submissions-grid');
  grid.innerHTML = '';
  submissions.forEach((sub, idx) => {
    const card = document.createElement('div');
    card.className = 'submission-card' + (clickable ? ' clickable' : '');

    sub.cards.forEach((c, ci) => {
      const p = document.createElement('div');
      if (c.image) {
        const img = document.createElement('img');
        img.src = c.image;
        img.style.cssText = 'width:100%;max-height:70px;object-fit:cover;display:block;margin-bottom:.3rem';
        p.appendChild(img);
      }
      const t = document.createElement('span');
      t.innerHTML = escHtml(c.text);
      p.appendChild(t);
      if (ci < sub.cards.length - 1) {
        const sep = document.createElement('div');
        sep.className = 'sub-sep';
        p.appendChild(sep);
      }
      card.appendChild(p);
    });

    const num = document.createElement('span');
    num.className = 'card-num';
    num.textContent = `#${idx + 1}`;
    card.appendChild(num);

    if (clickable) {
      card.addEventListener('click', () => socket.emit('judge-pick', idx));
    }
    grid.appendChild(card);
  });
}

socket.on('round-result', ({ winnerId, winnerName, winningCards, blackCard, allSubmissions, scores, players }) => {
  hideAllPhases();
  stopTimer();
  $('phase-result').classList.remove('hidden');

  const isMe = winnerId === myId;
  $('result-winner-name').textContent = isMe ? '🏆 YOU WIN THIS ROUND!' : `${winnerName} wins!`;
  $('result-winner-sub').textContent = '';

  // Show winning cards
  const rc = $('result-cards');
  rc.innerHTML = '';
  winningCards.forEach(c => {
    const el = document.createElement('div');
    el.className = 'submission-card winner-card';
    if (c.image) {
      const img = document.createElement('img');
      img.src = c.image;
      img.style.cssText = 'width:100%;max-height:70px;object-fit:cover;display:block;margin-bottom:.3rem';
      el.appendChild(img);
    }
    const t = document.createElement('div');
    t.innerHTML = escHtml(c.text);
    el.appendChild(t);
    rc.appendChild(el);
  });

  // Scoreboard
  const sb = $('result-scoreboard');
  sb.innerHTML = '';
  const playerList = players || [];
  const sortedScores = Object.entries(scores).sort(([,a],[,b]) => b - a);
  sortedScores.forEach(([id, sc], rank) => {
    const p = playerList.find(x => x.id === id);
    const name = p?.name ?? (id === myId ? myName : id.slice(0, 6));
    const row = document.createElement('div');
    row.className = 'score-row' + (rank === 0 ? ' top' : '');
    row.innerHTML = `<span>${escHtml(name)}</span><span class="score-val">${sc}</span>`;
    sb.appendChild(row);
  });

  // Countdown
  let t = 5;
  $('next-round-countdown').textContent = t;
  if (nextRoundTimer) clearInterval(nextRoundTimer);
  nextRoundTimer = setInterval(() => {
    t--;
    $('next-round-countdown').textContent = t;
    if (t <= 0) clearInterval(nextRoundTimer);
  }, 1000);
});

socket.on('game-over', ({ winnerId, winnerName, scores, players }) => {
  showScreen('s-gameover');
  const isMe = winnerId === myId;
  $('go-winner').textContent = isMe ? 'YOU WIN!' : `${winnerName} WINS!`;
  $('go-sub').textContent = isMe ? 'Congratulations, you magnificent bastard.' : 'Better luck next time.';

  const playerList = players || [];
  const sb = $('go-scores');
  sb.innerHTML = '';
  Object.entries(scores).sort(([,a],[,b]) => b - a).forEach(([id, sc], rank) => {
    const p = playerList.find(x => x.id === id);
    const name = p?.name ?? (id === myId ? myName : id.slice(0, 6));
    const row = document.createElement('div');
    row.className = 'score-row' + (rank === 0 ? ' top' : '');
    row.innerHTML = `<span>${escHtml(name)}</span><span class="score-val">${sc}</span>`;
    sb.appendChild(row);
  });
});

$('btn-play-again').addEventListener('click', () => {
  socket.disconnect();
  socket.connect();
  goToMenu();
});
$('btn-go-home').addEventListener('click', () => {
  socket.disconnect();
  socket.connect();
  goToMenu();
});

function hideAllPhases() {
  ['phase-playing','phase-czar-wait','phase-judging','phase-awaiting-czar','phase-result'].forEach(id => {
    $(id).classList.add('hidden');
  });
}

// URL code prefill
const urlCode = new URLSearchParams(location.search).get('code');
if (urlCode) {
  $('join-code').value = urlCode.toUpperCase();
  showScreen('s-join');
}
