// ---------------------------------------------------------------------------
// SPOTIFY AUTH — Authorization Code + PKCE (no backend / no client secret).
// Works unchanged on http://127.0.0.1:5500 and any prod origin, as long as
// that exact origin+path is registered as a Redirect URI in the Spotify app.
// ---------------------------------------------------------------------------

const SPOTIFY_SCOPES = "user-read-private playlist-modify-public playlist-modify-private user-library-modify";
const REDIRECT_URI = window.location.origin + window.location.pathname;

function getClientId() {
  return localStorage.getItem("spotify_client_id") || "";
}
function setClientId(id) {
  localStorage.setItem("spotify_client_id", id);
}

function generateRandomString(length) {
  const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const values = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(values, (x) => possible[x % possible.length]).join("");
}

async function sha256(plain) {
  return crypto.subtle.digest("SHA-256", new TextEncoder().encode(plain));
}

function base64UrlEncode(buffer) {
  return btoa(String.fromCharCode(...new Uint8Array(buffer)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function redirectToSpotifyAuthorize() {
  const codeVerifier = generateRandomString(64);
  const codeChallenge = base64UrlEncode(await sha256(codeVerifier));
  const authState = generateRandomString(16);

  sessionStorage.setItem("spotify_code_verifier", codeVerifier);
  sessionStorage.setItem("spotify_auth_state", authState);

  const params = new URLSearchParams({
    response_type: "code",
    client_id: getClientId(),
    scope: SPOTIFY_SCOPES,
    code_challenge_method: "S256",
    code_challenge: codeChallenge,
    redirect_uri: REDIRECT_URI,
    state: authState,
  });

  window.location.href = `https://accounts.spotify.com/authorize?${params}`;
}

async function exchangeCodeForToken(code) {
  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: getClientId(),
      grant_type: "authorization_code",
      code,
      redirect_uri: REDIRECT_URI,
      code_verifier: sessionStorage.getItem("spotify_code_verifier") || "",
    }),
  });
  if (!res.ok) throw new Error(`Token exchange failed (${res.status})`);
  return res.json();
}

async function refreshAccessToken(refreshToken) {
  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: getClientId(),
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });
  if (!res.ok) throw new Error(`Token refresh failed (${res.status})`);
  return res.json();
}

function storeTokens(tokenResponse) {
  sessionStorage.setItem("spotify_access_token", tokenResponse.access_token);
  sessionStorage.setItem("spotify_expires_at", String(Date.now() + tokenResponse.expires_in * 1000));
  if (tokenResponse.refresh_token) {
    sessionStorage.setItem("spotify_refresh_token", tokenResponse.refresh_token);
  }
}

async function getValidAccessToken() {
  const expiresAt = Number(sessionStorage.getItem("spotify_expires_at") || 0);
  const accessToken = sessionStorage.getItem("spotify_access_token");
  if (accessToken && Date.now() < expiresAt - 10_000) return accessToken;

  const refreshToken = sessionStorage.getItem("spotify_refresh_token");
  if (!refreshToken) return null;

  const tokenResponse = await refreshAccessToken(refreshToken);
  storeTokens(tokenResponse);
  return tokenResponse.access_token;
}

async function fetchSpotifyProfile(accessToken) {
  const res = await fetch("https://api.spotify.com/v1/me", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Failed to load profile (${res.status})`);
  return res.json();
}

// ---------------------------------------------------------------------------
// IMPORT — actually creates the selected destinations on Spotify.
// Archive parsing (import.js) is still mocked; this part is real.
// ---------------------------------------------------------------------------

// For each selected destination: searches Spotify for every track, then
// either saves matches to Liked Songs or creates a playlist and adds them.
// onProgress(done, total, label) fires once per track as it's searched.
async function runImport(items, onProgress) {
  const accessToken = await getValidAccessToken();
  if (!accessToken) throw new Error("Сессия истекла, подключите Spotify заново");

  const totalTracks = items.reduce((sum, item) => sum + item.tracks.length, 0);
  let searched = 0;
  const results = [];

  for (const item of items) {
    const found = [];
    let notFound = 0;

    for (const t of item.tracks) {
      const match = await window.SpotifyApi.searchTrack(accessToken, t);
      if (match) found.push(match);
      else notFound += 1;

      searched += 1;
      onProgress(searched, totalTracks, `${t.artist} — ${t.title}`);
    }

    if (item.isLikedSongs) {
      if (found.length) await window.SpotifyApi.saveTracksToLibrary(accessToken, found.map((f) => f.uri));
      results.push({ label: item.label, added: found.length, notFound, url: null });
    } else {
      const playlist = await window.SpotifyApi.createPlaylist(accessToken, item.label);
      if (found.length) await window.SpotifyApi.addTracksToPlaylist(accessToken, playlist.id, found.map((f) => f.uri));
      results.push({ label: item.label, added: found.length, notFound, url: playlist.url });
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// APP STATE + RENDERING
// ---------------------------------------------------------------------------

const state = {
  user: null,
  archive: null,
  importConfig: null, // { likedEnabled, likedDestination: 'liked'|'playlist', likedPlaylistName, playlistSelected: bool[] }
};

const el = {
  authArea: document.getElementById("auth-area"),
  connectBtn: document.getElementById("connect-btn"),
  authError: document.getElementById("auth-error"),
  clientIdSetup: document.getElementById("client-id-setup"),
  redirectUriDisplay: document.getElementById("redirect-uri-display"),
  copyRedirectBtn: document.getElementById("copy-redirect-btn"),
  clientIdInput: document.getElementById("client-id-input"),
  saveClientIdBtn: document.getElementById("save-client-id-btn"),
  changeClientIdBtn: document.getElementById("change-client-id-btn"),
  archiveCard: document.getElementById("archive-card"),
  archiveInput: document.getElementById("archive-input"),
  dropzone: document.getElementById("dropzone"),
  parseStatus: document.getElementById("parse-status"),
  importCard: document.getElementById("import-card"),
  importSummary: document.getElementById("import-summary"),
  importBtn: document.getElementById("import-btn"),
  importValidation: document.getElementById("import-validation"),
  progressArea: document.getElementById("progress-area"),
  progressBar: document.getElementById("progress-bar"),
  progressLabel: document.getElementById("progress-label"),
  resultArea: document.getElementById("result-area"),
};

function renderAuthArea() {
  if (!state.user) {
    el.authArea.innerHTML = "";
    return;
  }
  el.authArea.innerHTML = `
    <div class="flex items-center gap-2 bg-neutral-900 border border-neutral-800 rounded-full pl-1 pr-1.5 py-1">
      <img src="${state.user.avatar}" onerror="this.style.display='none'"
        class="w-7 h-7 rounded-full bg-neutral-700" />
      <span class="text-sm font-medium">${state.user.display_name}</span>
      <button id="disconnect-btn" type="button" title="Отключить Spotify"
        class="text-xs text-neutral-500 hover:text-red-400 hover:bg-neutral-800 transition px-2 py-1 rounded-full">Отключить</button>
    </div>
  `;
}

el.authArea.addEventListener("click", (e) => {
  if (e.target.id === "disconnect-btn") disconnectSpotify();
});

// Russian plural forms: n % 10 == 1 && n % 100 != 11 -> one; 2-4 (not 12-14) -> few; else -> many
function ruPlural(n, one, few, many) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

function createDefaultImportConfig(archive) {
  return {
    likedEnabled: archive.liked.length > 0,
    likedDestination: "liked", // 'liked' | 'playlist'
    likedPlaylistName: "Liked from VK",
    playlistSelected: archive.playlists.map(() => true),
  };
}

// What would actually get sent to Spotify given the current selection: one
// entry per destination (Liked Songs and/or new playlists), each carrying
// the tracks that belong to it.
function buildImportPlan() {
  const a = state.archive;
  const cfg = state.importConfig;
  const items = [];

  if (cfg.likedEnabled) {
    items.push({
      tracks: a.liked,
      isLikedSongs: cfg.likedDestination === "liked",
      label:
        cfg.likedDestination === "liked" ? "Liked Songs" : cfg.likedPlaylistName.trim() || "Liked from VK",
    });
  }

  a.playlists.forEach((p, i) => {
    if (cfg.playlistSelected[i]) {
      items.push({ tracks: p.tracks, isLikedSongs: false, label: p.name });
    }
  });

  return items;
}

function updateImportButtonState() {
  const cfg = state.importConfig;
  if (!cfg) return;
  const anySelected = cfg.likedEnabled || cfg.playlistSelected.some(Boolean);
  el.importBtn.disabled = !anySelected;
  el.importValidation.classList.toggle("hidden", anySelected);
}

function renderImportSummary() {
  const a = state.archive;
  const cfg = state.importConfig;
  if (!a || !cfg) {
    el.importSummary.innerHTML = "";
    return;
  }

  const likedRow = a.liked.length
    ? `
    <div class="border border-neutral-800 rounded-lg p-3">
      <label class="flex items-center gap-2 cursor-pointer">
        <input type="checkbox" id="liked-enabled" class="accent-spotify w-4 h-4" ${cfg.likedEnabled ? "checked" : ""} />
        <span class="text-sm font-medium">${a.liked.length} ${ruPlural(a.liked.length, "любимый трек", "любимых трека", "любимых треков")}</span>
      </label>
      <div id="liked-destination-row" class="mt-2 pl-6 flex items-center gap-2 text-sm ${cfg.likedEnabled ? "" : "opacity-40 pointer-events-none"}">
        <span class="text-neutral-400">Добавить в:</span>
        <select id="liked-destination"
          class="bg-neutral-800 border border-neutral-700 rounded-md px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-spotify">
          <option value="liked" ${cfg.likedDestination === "liked" ? "selected" : ""}>Liked Songs</option>
          <option value="playlist" ${cfg.likedDestination === "playlist" ? "selected" : ""}>Новый плейлист</option>
        </select>
        <input id="liked-playlist-name" type="text" value="${cfg.likedPlaylistName}" placeholder="Название плейлиста"
          class="flex-1 bg-neutral-800 border border-neutral-700 rounded-md px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-spotify ${cfg.likedDestination === "playlist" ? "" : "hidden"}" />
      </div>
    </div>`
    : "";

  const playlistRows = a.playlists
    .map((p, i) => {
      const thumb = p.image
        ? `<img src="${p.image}" onerror="this.style.visibility='hidden'"
            class="w-8 h-8 rounded object-cover bg-neutral-700 flex-shrink-0" />`
        : `<div class="w-8 h-8 rounded bg-neutral-800 flex-shrink-0 flex items-center justify-center text-neutral-600">
            <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"
                d="M9 18V5l12-2v13M9 18a3 3 0 11-6 0 3 3 0 016 0zm12-2a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </div>`;
      return `
        <label class="flex items-center gap-3 text-sm border border-neutral-800 rounded-lg px-3 py-2 cursor-pointer hover:border-neutral-700 transition">
          <input type="checkbox" class="playlist-toggle accent-spotify w-4 h-4 flex-shrink-0" data-index="${i}" ${cfg.playlistSelected[i] ? "checked" : ""} />
          ${thumb}
          <span class="text-neutral-200 flex-1 truncate">${p.name}</span>
          <span class="text-neutral-500">${p.tracks.length} ${ruPlural(p.tracks.length, "трек", "трека", "треков")}</span>
        </label>`;
    })
    .join("");

  el.importSummary.innerHTML = `
    ${likedRow}
    <div>
      <div class="flex items-center justify-between mb-2">
        <p class="text-sm text-neutral-400">Плейлисты — выберите, какие импортировать:</p>
        ${
          a.playlists.length > 1
            ? `<div class="flex items-center gap-2 text-xs">
                <button type="button" id="select-all-playlists" class="text-neutral-500 hover:text-neutral-300 underline">Выбрать все</button>
                <span class="text-neutral-700">·</span>
                <button type="button" id="deselect-all-playlists" class="text-neutral-500 hover:text-neutral-300 underline">Снять все</button>
              </div>`
            : ""
        }
      </div>
      <div class="space-y-1.5">${playlistRows}</div>
    </div>
  `;

  updateImportButtonState();
}

el.importSummary.addEventListener("click", (e) => {
  const cfg = state.importConfig;
  if (!cfg) return;

  if (e.target.id === "select-all-playlists" || e.target.id === "deselect-all-playlists") {
    const selectAll = e.target.id === "select-all-playlists";
    cfg.playlistSelected = cfg.playlistSelected.map(() => selectAll);
    renderImportSummary();
  }
});

el.importSummary.addEventListener("change", (e) => {
  const cfg = state.importConfig;
  if (!cfg) return;

  if (e.target.id === "liked-enabled") {
    cfg.likedEnabled = e.target.checked;
    const row = document.getElementById("liked-destination-row");
    row.classList.toggle("opacity-40", !cfg.likedEnabled);
    row.classList.toggle("pointer-events-none", !cfg.likedEnabled);
  } else if (e.target.id === "liked-destination") {
    cfg.likedDestination = e.target.value;
    document.getElementById("liked-playlist-name").classList.toggle("hidden", cfg.likedDestination !== "playlist");
  } else if (e.target.classList.contains("playlist-toggle")) {
    cfg.playlistSelected[Number(e.target.dataset.index)] = e.target.checked;
  }

  updateImportButtonState();
});

el.importSummary.addEventListener("input", (e) => {
  if (e.target.id === "liked-playlist-name" && state.importConfig) {
    state.importConfig.likedPlaylistName = e.target.value;
  }
});

function unlock(cardEl) {
  cardEl.classList.remove("opacity-40", "pointer-events-none");
}
function lock(cardEl) {
  cardEl.classList.add("opacity-40", "pointer-events-none");
}

// Clears the local session only — does not revoke the grant on Spotify's
// side (the Web API has no revoke endpoint; that's done from the user's
// Spotify account settings).
function disconnectSpotify() {
  sessionStorage.removeItem("spotify_access_token");
  sessionStorage.removeItem("spotify_expires_at");
  sessionStorage.removeItem("spotify_refresh_token");
  sessionStorage.removeItem("spotify_code_verifier");
  sessionStorage.removeItem("spotify_auth_state");

  state.user = null;
  state.archive = null;
  state.importConfig = null;

  renderAuthArea();
  resetConnectButton();
  lock(el.archiveCard);
  lock(el.importCard);

  el.archiveInput.value = "";
  el.parseStatus.classList.add("hidden");
  el.parseStatus.textContent = "";
  el.importSummary.innerHTML = "";
  el.progressArea.classList.add("hidden");
  el.progressBar.style.width = "0%";
  el.resultArea.classList.add("hidden");
  el.resultArea.innerHTML = "";
}

// ---------------------------------------------------------------------------
// EVENT WIRING
// ---------------------------------------------------------------------------

function showAuthError(msg) {
  el.authError.textContent = msg;
  el.authError.classList.remove("hidden");
}
function clearAuthError() {
  el.authError.classList.add("hidden");
  el.authError.textContent = "";
}
function resetConnectButton() {
  el.connectBtn.disabled = false;
  el.connectBtn.textContent = "Подключить Spotify";
}

function showClientIdSetup() {
  el.clientIdInput.value = getClientId();
  el.clientIdSetup.classList.remove("hidden");
  el.changeClientIdBtn.classList.add("hidden");
}
function hideClientIdSetup() {
  el.clientIdSetup.classList.add("hidden");
  if (getClientId()) el.changeClientIdBtn.classList.remove("hidden");
}

function cleanUrl() {
  window.history.replaceState({}, document.title, window.location.origin + window.location.pathname);
}

async function loadProfileAndUnlock() {
  const accessToken = await getValidAccessToken();
  const profile = await fetchSpotifyProfile(accessToken);
  state.user = {
    display_name: profile.display_name || profile.id,
    avatar: profile.images && profile.images[0] ? profile.images[0].url : "",
  };
  renderAuthArea();
  el.connectBtn.textContent = "Подключено";
  el.connectBtn.disabled = true;
  unlock(el.archiveCard);
}

async function initAuth() {
  el.redirectUriDisplay.value = REDIRECT_URI;

  if (!getClientId()) {
    showClientIdSetup();
    return;
  }
  hideClientIdSetup();

  const url = new URL(window.location.href);
  const code = url.searchParams.get("code");
  const returnedState = url.searchParams.get("state");
  const authErrorParam = url.searchParams.get("error");

  if (authErrorParam) {
    cleanUrl();
    showAuthError(`Spotify вернул ошибку: ${authErrorParam}`);
    return;
  }

  if (code) {
    const expectedState = sessionStorage.getItem("spotify_auth_state");
    cleanUrl();
    if (!returnedState || returnedState !== expectedState) {
      showAuthError("Не удалось подтвердить запрос авторизации. Попробуйте подключиться снова.");
      return;
    }
    try {
      el.connectBtn.disabled = true;
      el.connectBtn.textContent = "Подключение…";
      const tokenResponse = await exchangeCodeForToken(code);
      console.log("Spotify granted scopes:", tokenResponse.scope);
      storeTokens(tokenResponse);
      await loadProfileAndUnlock();
    } catch (err) {
      showAuthError("Не удалось подключить Spotify: " + err.message);
      resetConnectButton();
    }
    return;
  }

  const existingToken = await getValidAccessToken().catch(() => null);
  if (existingToken) {
    await loadProfileAndUnlock().catch((err) => showAuthError("Сессия истекла: " + err.message));
  }
}

el.connectBtn.addEventListener("click", () => {
  if (!getClientId()) {
    showClientIdSetup();
    return;
  }
  clearAuthError();
  redirectToSpotifyAuthorize();
});

el.saveClientIdBtn.addEventListener("click", () => {
  const id = el.clientIdInput.value.trim();
  if (!id) return;
  setClientId(id);
  hideClientIdSetup();
  clearAuthError();
});

el.changeClientIdBtn.addEventListener("click", () => showClientIdSetup());

el.copyRedirectBtn.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(REDIRECT_URI);
    el.copyRedirectBtn.textContent = "Скопировано";
    setTimeout(() => (el.copyRedirectBtn.textContent = "Копировать"), 1500);
  } catch {
    el.redirectUriDisplay.select();
  }
});

initAuth();

async function handleArchiveFile(file) {
  if (!file) return;

  el.parseStatus.classList.remove("hidden");
  el.parseStatus.classList.remove("text-red-400");
  el.parseStatus.textContent = `Разбираем «${file.name}»…`;
  lock(el.importCard);

  let archive;
  try {
    archive = await window.VkImport.extractVkArchive(file);
  } catch (err) {
    el.parseStatus.classList.add("text-red-400");
    el.parseStatus.textContent = "Ошибка разбора архива: " + err.message;
    el.archiveInput.value = "";
    return;
  }

  state.archive = archive;
  state.importConfig = createDefaultImportConfig(archive);

  if (!archive.liked.length && !archive.playlists.length) {
    el.parseStatus.classList.add("text-red-400");
    el.parseStatus.textContent = "В архиве не найдено ни одного трека.";
    return;
  }

  el.parseStatus.textContent = `Готово: найдено ${archive.liked.length} любимых треков и ${archive.playlists.length} плейлиста(ов).`;

  renderImportSummary();
  unlock(el.importCard);
}

el.dropzone.addEventListener("click", () => el.archiveInput.click());
el.archiveInput.addEventListener("change", (e) => handleArchiveFile(e.target.files[0]));

["dragover", "dragleave", "drop"].forEach((evt) => {
  el.dropzone.addEventListener(evt, (e) => e.preventDefault());
});
el.dropzone.addEventListener("dragover", () => {
  el.dropzone.classList.add("border-spotify", "bg-neutral-800/40");
});
el.dropzone.addEventListener("dragleave", () => {
  el.dropzone.classList.remove("border-spotify", "bg-neutral-800/40");
});
el.dropzone.addEventListener("drop", (e) => {
  el.dropzone.classList.remove("border-spotify", "bg-neutral-800/40");
  handleArchiveFile(e.dataTransfer.files[0]);
});

el.importBtn.addEventListener("click", async () => {
  const items = buildImportPlan();
  if (!items.length) return;

  el.importBtn.disabled = true;
  el.progressArea.classList.remove("hidden");
  el.resultArea.classList.add("hidden");
  el.resultArea.innerHTML = "";
  el.progressBar.style.width = "0%";

  try {
    const results = await runImport(items, (done, total, label) => {
      const pct = Math.round((done / total) * 100);
      el.progressBar.style.width = `${pct}%`;
      el.progressLabel.textContent = `Ищем: ${label} (${done}/${total})`;
    });

    el.progressLabel.textContent = "Импорт завершён";

    el.resultArea.innerHTML = results
      .map(
        (r) => `
          <div class="flex items-center justify-between bg-neutral-800/60 border border-neutral-700 rounded-lg px-4 py-3">
            <span class="text-sm">
              ${r.label} — добавлено ${r.added} ${ruPlural(r.added, "трек", "трека", "треков")}${
          r.notFound ? `, не найдено ${r.notFound}` : ""
        }
            </span>
            ${r.url ? `<a href="${r.url}" target="_blank" class="text-spotify text-sm font-semibold hover:underline">Открыть →</a>` : ""}
          </div>`
      )
      .join("");
    el.resultArea.classList.remove("hidden");
  } catch (err) {
    el.progressLabel.textContent = "Ошибка импорта: " + err.message;
  }

  updateImportButtonState();
});
