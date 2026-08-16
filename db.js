// Shared leaderboard helper for the Hackatoa games.
// Nickname-based identity: results are keyed on (game, player nickname).
// Fails soft — if DATABASE_URL is unset or the DB is unreachable, the game
// still runs; leaderboard writes/reads just no-op or return empty.

const { Pool } = require('pg');

const GAME = process.env.GAME_ID || 'cah';
const connectionString = process.env.DATABASE_URL;

let pool = null;
if (connectionString) {
    pool = new Pool({ connectionString, max: 4 });
    pool.on('error', (err) => console.error('[db] pool error:', err.message));
} else {
    console.warn('[db] DATABASE_URL not set — leaderboard disabled');
}

// Normalize a nickname: trim, collapse whitespace, cap length. Returns '' if empty.
function cleanName(name) {
    if (typeof name !== 'string') return '';
    return name.trim().replace(/\s+/g, ' ').slice(0, 24);
}

// Record a single finished round. outcome is 'win', 'loss', or 'draw' for `player`.
async function recordResult(player, outcome) {
    if (!pool) return;
    const name = cleanName(player);
    if (!name) return;
    const wins = outcome === 'win' ? 1 : 0;
    const losses = outcome === 'loss' ? 1 : 0;
    const draws = outcome === 'draw' ? 1 : 0;
    try {
        await pool.query(
            `INSERT INTO leaderboards (game, player, wins, losses, draws, games_played, updated_at)
             VALUES ($1, $2, $3, $4, $5, 1, now())
             ON CONFLICT (game, player) DO UPDATE SET
               wins         = leaderboards.wins   + EXCLUDED.wins,
               losses       = leaderboards.losses + EXCLUDED.losses,
               draws        = leaderboards.draws  + EXCLUDED.draws,
               games_played = leaderboards.games_played + 1,
               updated_at   = now()`,
            [GAME, name, wins, losses, draws]
        );
    } catch (err) {
        console.error('[db] recordResult failed:', err.message);
    }
}

// Record a completed match between two players (winner/loser or a draw).
// winnerName === null means a draw between the two names.
async function recordMatch(nameA, nameB, winnerName) {
    const a = cleanName(nameA);
    const b = cleanName(nameB);
    if (!a || !b) return; // need both nicknames to attribute a result
    if (winnerName === null) {
        await Promise.all([recordResult(a, 'draw'), recordResult(b, 'draw')]);
    } else {
        const w = cleanName(winnerName);
        const loser = w === a ? b : a;
        await Promise.all([recordResult(w, 'win'), recordResult(loser, 'loss')]);
    }
}

// Top players for this game, best first.
async function getLeaderboard(limit = 20) {
    if (!pool) return [];
    try {
        const { rows } = await pool.query(
            `SELECT player, wins, losses, draws, games_played
               FROM leaderboards
              WHERE game = $1
              ORDER BY wins DESC, games_played ASC, updated_at ASC
              LIMIT $2`,
            [GAME, limit]
        );
        return rows;
    } catch (err) {
        console.error('[db] getLeaderboard failed:', err.message);
        return [];
    }
}

module.exports = { GAME, cleanName, recordResult, recordMatch, getLeaderboard };
