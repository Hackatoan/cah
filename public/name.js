// Shared nickname helper for the Hackatoa games.
// The nickname is stored once in localStorage and used to key the cross-game
// leaderboards. Unauthenticated by design — anyone can claim any name.
(function () {
    const KEY = 'playerName';

    function clean(n) {
        return (n || '').toString().trim().replace(/\s+/g, ' ').slice(0, 24);
    }

    function get() {
        return clean(localStorage.getItem(KEY) || '');
    }

    function set(n) {
        const c = clean(n);
        if (c) localStorage.setItem(KEY, c);
        return c;
    }

    // Return the stored name, prompting once if none is set.
    // Returns '' if the user dismisses the prompt.
    function ensure() {
        let n = get();
        if (!n) {
            n = clean(window.prompt('Choose a nickname for the leaderboard:', ''));
            if (n) set(n);
        }
        return n;
    }

    window.PlayerName = { get, set, ensure, clean, KEY };
})();
