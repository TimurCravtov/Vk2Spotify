// ---------------------------------------------------------------------------
// SPOTIFY WEB API — track search, playlist creation, adding tracks.
// Plain fetch() calls with a Bearer token; no backend involved. Auth (PKCE,
// token storage) lives in app.js — this file only takes an access token in.
// ---------------------------------------------------------------------------

const SPOTIFY_API = "https://api.spotify.com/v1";

async function spotifyFetch(accessToken, path, options = {}) {
  const res = await fetch(`${SPOTIFY_API}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    // Spotify puts the real reason for 401/403 in WWW-Authenticate, not the
    // JSON body. CORS may hide it from JS (it's still visible in DevTools).
    const authHeader = res.headers.get("www-authenticate");
    throw new Error(
      `Spotify API ${res.status} on ${path}: ${body.slice(0, 200)}` +
        (authHeader ? ` | www-authenticate: ${authHeader}` : "")
    );
  }
  if (res.status === 204) return null;
  // Some endpoints (e.g. PUT /me/library) return 200 with an empty body
  // instead of 204, which res.json() can't parse ("unexpected end of data").
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

// Finds the best-guess Spotify track for an {artist, title} pair. Tries a
// field-filtered search first (precise), then falls back to a plain query
// (looser) since VK's real track names will often be messier than this).
async function searchTrack(accessToken, { artist, title }) {
  const filtered = await spotifyFetch(
    accessToken,
    `/search?type=track&limit=1&q=${encodeURIComponent(`track:${title} artist:${artist}`)}`
  );
  let track = filtered.tracks && filtered.tracks.items[0];

  if (!track) {
    const loose = await spotifyFetch(
      accessToken,
      `/search?type=track&limit=1&q=${encodeURIComponent(`${artist} ${title}`)}`
    );
    track = loose.tracks && loose.tracks.items[0];
  }

  return track ? { id: track.id, uri: track.uri } : null;
}

// POST /users/{id}/playlists was retired in Spotify's Feb 2026 Web API
// migration (deadline March 9, 2026) — every caller gets 403 now. Current
// endpoint creates a playlist for the logged-in user directly, no user ID.
async function createPlaylist(accessToken, name) {
  const playlist = await spotifyFetch(accessToken, `/me/playlists`, {
    method: "POST",
    body: JSON.stringify({ name, public: false, description: "Импортировано из VK через Vk2Spotify" }),
  });
  // The `public: false` above is unreliable on its own — Spotify sometimes
  // creates the playlist public regardless. A follow-up "change details"
  // call reliably enforces it.
  await spotifyFetch(accessToken, `/playlists/${playlist.id}`, {
    method: "PUT",
    body: JSON.stringify({ public: false }),
  });
  return { id: playlist.id, url: playlist.external_urls.spotify };
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// POST /playlists/{id}/tracks was retired in the same migration in favor of
// /items. Body key documentation wasn't published for the new path, so this
// keeps the previous `uris` shape — if Spotify renamed that too, the error
// thrown by spotifyFetch now surfaces the response body to confirm it.
async function addTracksToPlaylist(accessToken, playlistId, uris) {
  for (const batch of chunk(uris, 100)) {
    await spotifyFetch(accessToken, `/playlists/${playlistId}/items`, {
      method: "POST",
      body: JSON.stringify({ uris: batch }),
    });
  }
}

// PUT /me/tracks (and the other per-type save endpoints) were consolidated
// into PUT /me/library, which takes Spotify URIs instead of bare IDs — as a
// comma-separated `uris` query parameter (max 40), not a JSON body field.
async function saveTracksToLibrary(accessToken, trackUris) {
  for (const batch of chunk(trackUris, 40)) {
    const query = batch.map(encodeURIComponent).join(",");
    await spotifyFetch(accessToken, `/me/library?uris=${query}`, { method: "PUT" });
  }
}

window.SpotifyApi = { searchTrack, createPlaylist, addTracksToPlaylist, saveTracksToLibrary };
