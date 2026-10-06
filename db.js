// Thin shim over the shared leaderboard SDK (github.com/Hackatoan/game-leaderboard).
// Same exports as the old inline implementation, plus anti-cheat guards and a profanity filter.
module.exports = require('@hackatoan/leaderboard')({ gameId: process.env.GAME_ID || 'cah' });
