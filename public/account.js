// Shared account-linking widget for the Hackatoa games.
// Google sign-in (Firebase Auth, project games-7e2c4) lets a player's
// leaderboard stats follow them across devices/browsers instead of resetting
// with every new nickname. Purely additive: nickname-only play keeps working
// exactly as before if nobody signs in. Requires the compat SDK loaded first:
//   <script src="https://www.gstatic.com/firebasejs/9.6.10/firebase-app-compat.js"></script>
//   <script src="https://www.gstatic.com/firebasejs/9.6.10/firebase-auth-compat.js"></script>
//   <script src="account.js"></script>
(function () {
    const firebaseConfig = {
        apiKey: 'AIzaSyA_VXg8asalt0D9PItb7JjfDZZ16CZdBlw',
        authDomain: 'games-7e2c4.firebaseapp.com',
        projectId: 'games-7e2c4',
        storageBucket: 'games-7e2c4.firebasestorage.app',
        messagingSenderId: '672139906513',
        appId: '1:672139906513:web:b237739890977bdb1724f0',
    };
    firebase.initializeApp(firebaseConfig);
    const auth = firebase.auth();
    const provider = new firebase.auth.GoogleAuthProvider();

    let currentUser = null;
    let ready = false;
    const listeners = new Set();
    auth.onAuthStateChanged((u) => {
        currentUser = u;
        ready = true;
        listeners.forEach((fn) => fn(u));
    });

    function signIn() { return auth.signInWithPopup(provider); }
    function signOutUser() { return auth.signOut(); }
    function getUser() { return currentUser; }
    function onAuthChange(fn) {
        listeners.add(fn);
        if (ready) fn(currentUser);
        return () => listeners.delete(fn);
    }
    async function getIdToken() { return currentUser ? currentUser.getIdToken() : null; }

    async function claimNickname(nickname) {
        const idToken = await getIdToken();
        if (!idToken) return { ok: false, reason: 'not signed in' };
        try {
            const r = await fetch('/api/claim', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ idToken, nickname }),
            });
            return await r.json();
        } catch {
            return { ok: false, reason: 'network error' };
        }
    }

    // Mounts into an existing element in the page's own layout (a footer
    // links row, a header corner, etc.) instead of a floating overlay, and
    // uses plain <button>/text with no inline colors so it inherits
    // whatever button/link/text styling that page already has -- it should
    // read as part of the site, not a widget bolted on top. Each game adds
    // a small CSS block (spacing/sizing only) for its container; see
    // public/style.css's ".hk-account-row" for the pattern.
    //
    // containerOrSelector: an element or CSS selector to mount into.
    function mountWidget(containerOrSelector) {
        const el = typeof containerOrSelector === 'string'
            ? document.querySelector(containerOrSelector)
            : containerOrSelector;
        if (!el) return;
        const CLAIMED_KEY = 'hk_claim_offered';

        function render() {
            if (!ready) { el.innerHTML = ''; return; }
            if (currentUser) {
                el.innerHTML =
                    '<span>👤 ' + (currentUser.displayName || currentUser.email) + '</span>' +
                    ' <button type="button" id="hk-signout">Sign out</button>';
                el.querySelector('#hk-signout').onclick = () => signOutUser();
            } else {
                el.innerHTML = '<button type="button" id="hk-signin">Sign in to link stats</button>';
                el.querySelector('#hk-signin').onclick = () => signIn().catch((e) => console.warn('[account] sign-in failed:', e.message));
            }
        }

        onAuthChange(async (user) => {
            render();
            if (!user) return;
            const nickname = window.PlayerName ? window.PlayerName.get() : '';
            const offeredFor = localStorage.getItem(CLAIMED_KEY);
            if (!nickname || nickname === offeredFor) return;
            const result = await claimNickname(nickname);
            localStorage.setItem(CLAIMED_KEY, nickname);
            if (result.ok) {
                console.log(`[account] Linked your previous "${nickname}" stats to this account.`);
            }
            render();
        });
    }

    window.PlayerAccount = { signIn, signOut: signOutUser, getUser, onAuthChange, getIdToken, claimNickname, mountWidget };
})();
