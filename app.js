// ---------------------------------------------------------------------------
// MOCK DATA & MOCK API LAYER
// Replace these with real Spotify Web API (PKCE) calls and real VK export
// parsing once the flow below is validated.
// ---------------------------------------------------------------------------

const MOCK_USER = {
  display_name: "Timur",
  avatar: "https://i.scdn.co/image/ab6775700000ee85f8f2c4b5f3b3b3b3b3b3b3b",
};

// Stand-in for tracks parsed out of the VK "Your data" export.
const MOCK_VK_TRACKS = [
  { artist: "Каспийский Груз", title: "Убегай" },
  { artist: "Скриптонит", title: "Иные" },
  { artist: "Miyagi & Andy Panda", title: "Kosandra" },
  { artist: "Molchat Doma", title: "Sudno (Борис Рыжий)" },
  { artist: "Земфира", title: "Хочешь?" },
  { artist: "OG Buda", title: "Розовое вино" },
  { artist: "Unknown Local Rip", title: "track_final_v2 (128kbps)" },
  { artist: "Placebo", title: "Special K" },
];

function mockLogin() {
  return new Promise((resolve) => setTimeout(() => resolve(MOCK_USER), 700));
}

// Simulates searching each VK track against Spotify's search endpoint.
// Randomly "fails" one track so the no-match UI state has something to show.
function mockSearchTracks(vkTracks) {
  return new Promise((resolve) => {
    setTimeout(() => {
      const results = vkTracks.map((t, i) => {
        const notFound = t.artist.includes("Unknown");
        return {
          vk: t,
          spotify: notFound
            ? null
            : {
                id: `mock_spotify_id_${i}`,
                name: t.title,
                artist: t.artist,
                album_art:
                  "https://placehold.co/64x64/1DB954/000000?text=%E2%99%AA",
                uri: `spotify:track:mock${i}`,
              },
        };
      });
      resolve(results);
    }, 900);
  });
}

// Simulates creating a playlist and adding matched tracks, reporting progress.
function mockCreatePlaylist(name, matches, onProgress) {
  const toAdd = matches.filter((m) => m.spotify);
  let added = 0;
  return new Promise((resolve) => {
    const interval = setInterval(() => {
      added += 1;
      onProgress(added, toAdd.length);
      if (added >= toAdd.length) {
        clearInterval(interval);
        resolve({
          playlistName: name,
          added: toAdd.length,
          skipped: matches.length - toAdd.length,
          url: "https://open.spotify.com/playlist/mock_playlist_id",
        });
      }
    }, 250);
  });
}

// ---------------------------------------------------------------------------
// APP STATE + RENDERING
// ---------------------------------------------------------------------------

const state = {
  user: null,
  matches: [],
};

const el = {
  authArea: document.getElementById("auth-area"),
  connectCard: document.getElementById("connect-card"),
  connectBtn: document.getElementById("connect-btn"),
  tracksCard: document.getElementById("tracks-card"),
  trackList: document.getElementById("track-list"),
  matchSummary: document.getElementById("match-summary"),
  playlistCard: document.getElementById("playlist-card"),
  playlistName: document.getElementById("playlist-name"),
  createBtn: document.getElementById("create-playlist-btn"),
  progressArea: document.getElementById("progress-area"),
  progressBar: document.getElementById("progress-bar"),
  progressLabel: document.getElementById("progress-label"),
  resultArea: document.getElementById("result-area"),
  resultSummary: document.getElementById("result-summary"),
  resultLink: document.getElementById("result-link"),
};

function renderAuthArea() {
  if (!state.user) {
    el.authArea.innerHTML = "";
    return;
  }
  el.authArea.innerHTML = `
    <div class="flex items-center gap-2 bg-neutral-900 border border-neutral-800 rounded-full pl-1 pr-4 py-1">
      <img src="${state.user.avatar}" onerror="this.style.display='none'"
        class="w-7 h-7 rounded-full bg-neutral-700" />
      <span class="text-sm font-medium">${state.user.display_name}</span>
    </div>
  `;
}

function renderTrackList() {
  el.trackList.innerHTML = state.matches
    .map((m) => {
      const found = !!m.spotify;
      return `
        <div class="flex items-center gap-3 px-4 py-3 ${found ? "" : "opacity-60"}">
          <img src="${found ? m.spotify.album_art : "https://placehold.co/64x64/262626/525252?text=%3F"}"
            class="w-10 h-10 rounded object-cover flex-shrink-0" />
          <div class="min-w-0 flex-1">
            <p class="text-sm font-medium truncate">${m.vk.title}</p>
            <p class="text-xs text-neutral-400 truncate">${m.vk.artist}</p>
          </div>
          <span class="text-xs font-semibold px-2.5 py-1 rounded-full ${
            found
              ? "bg-spotify/15 text-spotify"
              : "bg-red-500/15 text-red-400"
          }">
            ${found ? "Matched" : "No match"}
          </span>
        </div>
      `;
    })
    .join("");

  const foundCount = state.matches.filter((m) => m.spotify).length;
  el.matchSummary.textContent = `${foundCount}/${state.matches.length} matched`;
}

function unlock(cardEl) {
  cardEl.classList.remove("opacity-40", "pointer-events-none");
}

// ---------------------------------------------------------------------------
// EVENT WIRING
// ---------------------------------------------------------------------------

el.connectBtn.addEventListener("click", async () => {
  el.connectBtn.disabled = true;
  el.connectBtn.textContent = "Connecting…";

  const user = await mockLogin();
  state.user = user;
  renderAuthArea();

  el.connectBtn.textContent = "Connected";
  unlock(el.tracksCard);

  el.trackList.innerHTML = `<div class="px-4 py-6 text-sm text-neutral-400 text-center">Matching tracks…</div>`;
  const matches = await mockSearchTracks(MOCK_VK_TRACKS);
  state.matches = matches;
  renderTrackList();
  unlock(el.playlistCard);
});

el.createBtn.addEventListener("click", async () => {
  el.createBtn.disabled = true;
  el.progressArea.classList.remove("hidden");
  el.resultArea.classList.add("hidden");

  const name = el.playlistName.value.trim() || "VK Import";
  const toAdd = state.matches.filter((m) => m.spotify).length;

  const result = await mockCreatePlaylist(name, state.matches, (done, total) => {
    const pct = total ? Math.round((done / total) * 100) : 100;
    el.progressBar.style.width = `${pct}%`;
    el.progressLabel.textContent = `Adding tracks… ${done}/${total}`;
  });

  el.progressLabel.textContent = `Done — added ${result.added} track${result.added === 1 ? "" : "s"}`;
  el.resultSummary.textContent = `${result.added} added, ${result.skipped} skipped (no match) — "${result.playlistName}"`;
  el.resultLink.href = result.url;
  el.resultArea.classList.remove("hidden");
  el.createBtn.disabled = false;
});
