'use strict';
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { readFileSync, mkdirSync } = require('fs');
const multer = require('multer');
const Database = require('better-sqlite3');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3029;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');

mkdirSync(DATA_DIR, { recursive: true });
mkdirSync(path.join(DATA_DIR, 'uploads'), { recursive: true });

const ALL_CARDS = JSON.parse(readFileSync(path.join(__dirname, 'cards.json'), 'utf8'));

// ── DB ─────────────────────────────────────────────────────────────────────
const db = new Database(path.join(DATA_DIR, 'community.db'));
db.exec(`
  CREATE TABLE IF NOT EXISTS packs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    author TEXT NOT NULL DEFAULT 'Anonymous',
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
  );
  CREATE TABLE IF NOT EXISTS black_cards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pack_id INTEGER NOT NULL,
    text TEXT NOT NULL,
    pick INTEGER NOT NULL DEFAULT 1
  );
  CREATE TABLE IF NOT EXISTS white_cards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pack_id INTEGER NOT NULL,
    text TEXT,
    image_url TEXT
  );
`);

// ── Image uploads ──────────────────────────────────────────────────────────
const storage = multer.diskStorage({
  destination: path.join(DATA_DIR, 'uploads'),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase().replace(/[^.a-z0-9]/g, '');
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 7)}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 4 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    cb(null, /^image\/(jpeg|png|gif|webp)$/.test(file.mimetype));
  },
});

app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(DATA_DIR, 'uploads')));
app.use(express.json({ limit: '1mb' }));
app.get('/', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'game.html')));

// ── REST: packs list ───────────────────────────────────────────────────────
app.get('/api/packs', (_req, res) => {
  res.json(ALL_CARDS.packs.map(p => ({ id: p.id, name: p.name })));
});

// ── REST: image upload ─────────────────────────────────────────────────────
app.post('/upload/image', upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Invalid or missing image' });
  res.json({ url: `/uploads/${req.file.filename}` });
});

// ── REST: community packs ──────────────────────────────────────────────────
app.get('/api/community-packs', (_req, res) => {
  const packs = db.prepare(`
    SELECT p.id, p.name, p.author, p.created_at,
      (SELECT COUNT(*) FROM black_cards WHERE pack_id = p.id) AS black_count,
      (SELECT COUNT(*) FROM white_cards WHERE pack_id = p.id) AS white_count
    FROM packs p ORDER BY p.id DESC LIMIT 50
  `).all();
  res.json(packs);
});

app.get('/api/community-packs/:id/cards', (req, res) => {
  const id = Number(req.params.id);
  const black = db.prepare('SELECT text, pick FROM black_cards WHERE pack_id = ?').all(id);
  const white = db.prepare('SELECT text, image_url FROM white_cards WHERE pack_id = ?').all(id);
  res.json({
    black: black.map(c => c.text),
    white: white.map(c => ({ text: c.text, image: c.image_url })),
  });
});

app.post('/api/community-packs', (req, res) => {
  const { name, author, black = [], white = [] } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Pack name required' });
  if (!black.length && !white.length) return res.status(400).json({ error: 'Must have at least one card' });

  const tx = db.transaction(() => {
    const { lastInsertRowid: packId } = db.prepare('INSERT INTO packs (name, author) VALUES (?, ?)').run(
      String(name).slice(0, 80),
      String(author || 'Anonymous').slice(0, 40)
    );
    const insBlack = db.prepare('INSERT INTO black_cards (pack_id, text, pick) VALUES (?, ?, ?)');
    const insWhite = db.prepare('INSERT INTO white_cards (pack_id, text, image_url) VALUES (?, ?, ?)');
    for (const t of black) {
      if (typeof t !== 'string') continue;
      const text = t.slice(0, 200);
      insBlack.run(packId, text, (text.match(/___/g) || []).length || 1);
    }
    for (const w of white) {
      const text = typeof w === 'string' ? w : w?.text;
      const image = typeof w === 'object' ? w?.image : null;
      if (!text && !image) continue;
      insWhite.run(packId, text ? String(text).slice(0, 100) : null, image ? String(image).slice(0, 300) : null);
    }
    return packId;
  });

  res.json({ id: tx() });
});

// ── Game rooms ────────────────────────────────────────────────────────────
const rooms = new Map();

function uid() { return Math.random().toString(36).slice(2, 9); }

function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do {
    code = Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  } while (rooms.has(code));
  return code;
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const WILD_CARD = { text: '', type: 'wild', pack: 'wild' };
const WILDS_PER_HAND = 2;

function buildDeck(packs, customCards) {
  let black = [], white = [];
  for (const pack of ALL_CARDS.packs) {
    if (packs.includes('all') || packs.includes(pack.id)) {
      black = black.concat(pack.black.map(c => ({ ...c, pack: pack.id })));
      white = white.concat(pack.white.map(c => ({ ...c, pack: pack.id })));
    }
  }
  if (customCards.black.length) {
    black = black.concat(customCards.black.map(c => {
      const text = typeof c === 'string' ? c : c.text;
      return { text, pick: (text.match(/___/g) || []).length || 1, pack: 'custom' };
    }));
  }
  if (customCards.white.length) {
    white = white.concat(customCards.white.map(c =>
      typeof c === 'string' ? { text: c, pack: 'custom' } : { text: c.text, image: c.image, pack: 'custom' }
    ));
  }
  return { black: shuffle(black), white: shuffle(white) };
}

function replenishWhite(deck) {
  if (deck.white.length === 0) {
    let all = [];
    for (const p of ALL_CARDS.packs) all = all.concat(p.white);
    deck.white = shuffle(all);
  }
}

function dealHand(deck, count) {
  const cards = [];
  for (let i = 0; i < count; i++) { replenishWhite(deck); cards.push(deck.white.shift()); }
  for (let i = 0; i < WILDS_PER_HAND; i++) cards.push({ ...WILD_CARD, id: uid() });
  return shuffle(cards);
}

function getRoomByPlayer(socketId) {
  for (const room of rooms.values()) {
    if (room.players.some(p => p.id === socketId)) return room;
  }
  return null;
}

function publicPlayers(room) {
  return room.players.map(p => ({ id: p.id, name: p.name, score: p.score, isRando: p.isRando }));
}

function broadcastLobby(room) {
  io.to(room.code).emit('lobby-update', {
    players: publicPlayers(room),
    hostId: room.hostId,
    options: room.options,
    customCounts: { black: room.customCards.black.length, white: room.customCards.white.length },
  });
}

function startGame(room) {
  room.deck = buildDeck(room.options.packs, room.customCards);

  if (room.options.rando && room.players.filter(p => !p.isRando).length >= 2) {
    room.players.push({ id: 'rando_' + uid(), name: 'Rando Cardrissian', score: 0, hand: [], isRando: true });
  }

  for (const p of room.players) p.hand = dealHand(room.deck, 10);

  room.round = 0;
  beginRound(room);
}

function beginRound(room) {
  if (room.deck.black.length === 0) {
    let all = [];
    for (const p of ALL_CARDS.packs) all = all.concat(p.black);
    room.deck.black = shuffle(all);
  }

  room.blackCard = room.deck.black.shift();
  room.submissions = [];
  room.shuffledSubs = null;
  room.votes = {};       // playerId → shuffledSubs index
  room.phase = 'playing';
  room.round++;

  const players = publicPlayers(room);

  for (const p of room.players) {
    if (p.isRando) continue;
    const sock = io.sockets.sockets.get(p.id);
    if (!sock) continue;
    sock.emit('round-start', {
      blackCard: room.blackCard,
      round: room.round,
      hand: p.hand,
      scores: Object.fromEntries(room.players.map(x => [x.id, x.score])),
      players,
      timerSeconds: room.options.timerSeconds,
    });
  }

  const rando = room.players.find(p => p.isRando);
  if (rando) submitRando(room, rando);

  if (room.timer) clearTimeout(room.timer);
  if (room.options.timerSeconds > 0) {
    room.timer = setTimeout(() => autoSubmitMissing(room), room.options.timerSeconds * 1000);
  }
}

function submitRando(room, rando) {
  const pick = room.blackCard.pick;
  const playable = rando.hand.filter(c => c.type !== 'wild');
  while (playable.length < pick) { replenishWhite(room.deck); const c = room.deck.white.shift(); playable.push(c); rando.hand.push(c); }
  room.submissions.push({ playerId: rando.id, cards: playable.splice(0, pick) });
  rando.hand = rando.hand.filter(c => !room.submissions.find(s => s.playerId === rando.id)?.cards.includes(c));
}

function autoSubmitMissing(room) {
  for (const p of room.players) {
    if (room.submissions.some(s => s.playerId === p.id)) continue;
    const pick = room.blackCard.pick;
    const playable = p.hand.filter(c => c.type !== 'wild');
    while (playable.length < pick) { replenishWhite(room.deck); const c = room.deck.white.shift(); playable.push(c); p.hand.push(c); }
    room.submissions.push({ playerId: p.id, cards: playable.slice(0, pick) });
    p.hand = p.hand.filter(c => !playable.slice(0, pick).includes(c));
  }
  checkAllIn(room);
}

function checkAllIn(room) {
  if (room.players.every(p => room.submissions.some(s => s.playerId === p.id))) {
    clearTimeout(room.timer);
    beginVoting(room);
  }
}

function beginVoting(room) {
  room.phase = 'voting';
  room.shuffledSubs = shuffle(room.submissions);
  room.votes = {};

  const players = publicPlayers(room);

  for (const p of room.players) {
    if (p.isRando) {
      // Rando votes randomly for someone else
      const others = room.shuffledSubs
        .map((s, i) => ({ s, i }))
        .filter(({ s }) => s.playerId !== p.id);
      if (others.length) {
        const pick = others[Math.floor(Math.random() * others.length)];
        room.votes[p.id] = pick.i;
      }
      continue;
    }
    const sock = io.sockets.sockets.get(p.id);
    if (!sock) continue;
    const mySubIdx = room.shuffledSubs.findIndex(s => s.playerId === p.id);
    sock.emit('voting-start', {
      submissions: room.shuffledSubs.map(s => ({ cards: s.cards })),
      mySubmissionIdx: mySubIdx,
      blackCard: room.blackCard,
      players,
      totalVoters: room.players.filter(pl => !pl.isRando).length,
    });
  }

  if (room.options.timerSeconds > 0) {
    room.timer = setTimeout(() => autoVoteMissing(room), room.options.timerSeconds * 1000);
  }
}

function autoVoteMissing(room) {
  for (const p of room.players) {
    if (room.votes[p.id] !== undefined) continue;
    const others = room.shuffledSubs
      .map((s, i) => ({ s, i }))
      .filter(({ s }) => s.playerId !== p.id);
    if (others.length) {
      room.votes[p.id] = others[Math.floor(Math.random() * others.length)].i;
    }
  }
  checkAllVoted(room);
}

function checkAllVoted(room) {
  const voters = room.players; // everyone votes (randos voted in beginVoting)
  if (voters.every(p => room.votes[p.id] !== undefined)) {
    clearTimeout(room.timer);
    resolveVotes(room);
  }
}

function resolveVotes(room) {
  // Tally votes per shuffledSubs index
  const tally = new Array(room.shuffledSubs.length).fill(0);
  for (const idx of Object.values(room.votes)) tally[idx]++;

  const maxVotes = Math.max(...tally);
  const tied = tally.map((v, i) => ({ v, i })).filter(x => x.v === maxVotes);
  // Random tiebreak
  const winner = tied[Math.floor(Math.random() * tied.length)];
  const winningSub = room.shuffledSubs[winner.i];
  const winnerPlayer = room.players.find(p => p.id === winningSub.playerId);
  if (!winnerPlayer) return;

  winnerPlayer.score++;
  room.phase = 'round_result';

  const players = publicPlayers(room);
  io.to(room.code).emit('round-result', {
    winnerId: winnerPlayer.id,
    winnerName: winnerPlayer.name,
    winningCards: winningSub.cards,
    winningIdx: winner.i,
    blackCard: room.blackCard,
    tally,
    tiedCount: tied.length,
    allSubmissions: room.shuffledSubs.map((s, i) => ({
      playerId: s.playerId,
      playerName: room.players.find(p => p.id === s.playerId)?.name ?? '?',
      cards: s.cards,
      votes: tally[i],
    })),
    scores: Object.fromEntries(room.players.map(p => [p.id, p.score])),
    players,
  });

  const delay = 6000;
  if (winnerPlayer.score >= room.options.scoreGoal) {
    setTimeout(() => endGame(room, winnerPlayer), delay);
  } else {
    setTimeout(() => nextRound(room), delay);
  }
}

function nextRound(room) {
  for (const p of room.players) {
    const nonWilds = p.hand.filter(c => c.type !== 'wild').length;
    for (let i = nonWilds; i < 10; i++) { replenishWhite(room.deck); p.hand.push(room.deck.white.shift()); }
    const currentWilds = p.hand.filter(c => c.type === 'wild').length;
    for (let i = currentWilds; i < WILDS_PER_HAND; i++) p.hand.push({ ...WILD_CARD, id: uid() });
    p.hand = shuffle(p.hand);
  }
  beginRound(room);
}

function endGame(room, winner) {
  room.phase = 'game_over';
  io.to(room.code).emit('game-over', {
    winnerId: winner.id,
    winnerName: winner.name,
    scores: Object.fromEntries(room.players.map(p => [p.id, p.score])),
    players: publicPlayers(room),
  });
}

// ── Socket handlers ───────────────────────────────────────────────────────
io.on('connection', socket => {
  socket.on('create-room', ({ name, options }) => {
    const opts = {
      scoreGoal: Math.min(20, Math.max(1, Number(options?.scoreGoal) || 7)),
      timerSeconds: [0, 30, 60, 90, 120].includes(Number(options?.timerSeconds)) ? Number(options.timerSeconds) : 60,
      rando: options?.rando !== false,
      packs: Array.isArray(options?.packs) && options.packs.length ? options.packs : ['all'],
    };
    const code = generateCode();
    const room = {
      code, hostId: socket.id, phase: 'lobby', round: 0,
      players: [{ id: socket.id, name: (name || 'Player 1').slice(0, 24), score: 0, hand: [] }],
      blackCard: null, submissions: [], shuffledSubs: null, votes: {},
      deck: null, timer: null, options: opts,
      customCards: { black: [], white: [] },
    };
    rooms.set(code, room);
    socket.join(code);
    socket.emit('room-created', { code });
    broadcastLobby(room);
  });

  socket.on('join-room', ({ code, name }) => {
    const room = rooms.get((code || '').toUpperCase().trim());
    if (!room) return socket.emit('join-error', 'Room not found');
    if (room.phase !== 'lobby') return socket.emit('join-error', 'Game already in progress');
    if (room.players.length >= 10) return socket.emit('join-error', 'Room is full (10 max)');
    room.players.push({ id: socket.id, name: (name || 'Player').slice(0, 24), score: 0, hand: [] });
    socket.join(room.code);
    socket.emit('room-joined', { code: room.code });
    broadcastLobby(room);
  });

  socket.on('start-game', () => {
    const room = getRoomByPlayer(socket.id);
    if (!room || room.hostId !== socket.id || room.phase !== 'lobby') return;
    if (room.players.filter(p => !p.isRando).length < 2) return socket.emit('error-msg', 'Need at least 2 players to start');
    startGame(room);
  });

  socket.on('play-cards', ({ indices, typedCards = {} }) => {
    const room = getRoomByPlayer(socket.id);
    if (!room || room.phase !== 'playing') return;
    if (room.submissions.some(s => s.playerId === socket.id)) return;
    const player = room.players.find(p => p.id === socket.id);
    if (!player) return;
    const pick = room.blackCard.pick;
    if (!Array.isArray(indices) || indices.length !== pick) return;
    const idxs = indices.map(Number).filter(i => i >= 0 && i < player.hand.length);
    if (idxs.length !== pick || new Set(idxs).size !== pick) return;

    const cards = idxs.map(i => {
      const card = player.hand[i];
      if (card.type === 'wild' && typedCards[i]) {
        return { text: String(typedCards[i]).slice(0, 150), pack: 'wild', type: 'wild-filled' };
      }
      return card;
    });

    const sorted = [...idxs].sort((a, b) => b - a);
    for (const i of sorted) player.hand.splice(i, 1);

    room.submissions.push({ playerId: socket.id, cards });
    socket.emit('cards-played');

    const subCount = room.submissions.length;
    const total = room.players.length;
    io.to(room.code).emit('submission-count', { submitted: subCount, total });
    checkAllIn(room);
  });

  socket.on('cast-vote', (idx) => {
    const room = getRoomByPlayer(socket.id);
    if (!room || room.phase !== 'voting') return;
    if (room.votes[socket.id] !== undefined) return; // already voted
    const voteIdx = Number(idx);
    if (!room.shuffledSubs[voteIdx]) return;
    // Can't vote for own submission
    if (room.shuffledSubs[voteIdx].playerId === socket.id) return;

    room.votes[socket.id] = voteIdx;
    socket.emit('vote-accepted');

    const voted = Object.keys(room.votes).length;
    const total = room.players.length;
    io.to(room.code).emit('vote-count', { voted, total });

    checkAllVoted(room);
  });

  socket.on('add-custom-cards', ({ black, white }) => {
    const room = getRoomByPlayer(socket.id);
    if (!room || room.hostId !== socket.id || room.phase !== 'lobby') return;
    if (Array.isArray(black)) room.customCards.black.push(...black.map(t => String(t).slice(0, 200)));
    if (Array.isArray(white)) {
      room.customCards.white.push(...white.map(w =>
        typeof w === 'string' ? w.slice(0, 100) : { text: String(w.text || '').slice(0, 100), image: String(w.image || '').slice(0, 300) }
      ));
    }
    socket.emit('custom-cards-added', { count: { black: room.customCards.black.length, white: room.customCards.white.length } });
    broadcastLobby(room);
  });

  socket.on('update-options', (opts) => {
    const room = getRoomByPlayer(socket.id);
    if (!room || room.hostId !== socket.id || room.phase !== 'lobby') return;
    if (opts.scoreGoal) room.options.scoreGoal = Math.min(20, Math.max(1, Number(opts.scoreGoal)));
    if (opts.timerSeconds !== undefined) room.options.timerSeconds = [0, 30, 60, 90, 120].includes(Number(opts.timerSeconds)) ? Number(opts.timerSeconds) : 60;
    if (opts.rando !== undefined) room.options.rando = Boolean(opts.rando);
    if (Array.isArray(opts.packs)) room.options.packs = opts.packs.length ? opts.packs : ['all'];
    broadcastLobby(room);
  });

  socket.on('disconnect', () => {
    const room = getRoomByPlayer(socket.id);
    if (!room) return;
    room.players = room.players.filter(p => p.id !== socket.id);
    if (room.players.filter(p => !p.isRando).length === 0) {
      if (room.timer) clearTimeout(room.timer);
      rooms.delete(room.code);
      return;
    }
    if (room.hostId === socket.id && room.players.length > 0) {
      room.hostId = room.players.find(p => !p.isRando)?.id ?? room.players[0].id;
    }
    io.to(room.code).emit('player-left', { id: socket.id, name: 'A player' });
    if (room.phase === 'lobby') broadcastLobby(room);
    // If in voting phase and disconnected player hadn't voted, auto-vote and check
    if (room.phase === 'voting' && room.votes[socket.id] === undefined) {
      const others = room.shuffledSubs
        .map((s, i) => ({ s, i }))
        .filter(({ s }) => s.playerId !== socket.id);
      if (others.length) {
        room.votes[socket.id] = others[Math.floor(Math.random() * others.length)].i;
        checkAllVoted(room);
      }
    }
  });
});

server.listen(PORT, () => console.log(`CAH on :${PORT}`));
