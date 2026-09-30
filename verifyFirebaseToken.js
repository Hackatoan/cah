// Verifies a Firebase Auth ID token WITHOUT the firebase-admin SDK.
// firebase-admin@14+ requires Node >=22; these game boxes run Node 20, and
// pulling in the full Admin SDK for one JWT check per game is unnecessary
// weight anyway. This does the same verification Firebase's own client
// libraries describe for manual ID-token checks: fetch Google's public JWKS
// for the securetoken service, verify the RS256 signature, and check the
// standard claims (issuer/audience/expiry).
const { createRemoteJWKSet, jwtVerify } = require('jose');

const PROJECT_ID = 'games-7e2c4';
const JWKS = createRemoteJWKSet(
    new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com')
);

// Returns { uid, email, name } on success, or null if the token is missing,
// expired, malformed, or not actually for this Firebase project.
async function verifyFirebaseToken(idToken) {
    if (!idToken || typeof idToken !== 'string') return null;
    try {
        const { payload } = await jwtVerify(idToken, JWKS, {
            issuer: `https://securetoken.google.com/${PROJECT_ID}`,
            audience: PROJECT_ID,
        });
        if (!payload.sub || !payload.email || !payload.email_verified) return null;
        return { uid: payload.sub, email: payload.email, name: payload.name || payload.email };
    } catch {
        return null;
    }
}

module.exports = { verifyFirebaseToken };
