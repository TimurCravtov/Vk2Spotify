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
// MOCK DATA & MOCK API LAYER (archive parsing + import — still mocked)
// ---------------------------------------------------------------------------

// Stand-in for what parsing the VK archive would produce: liked audio +
// audio playlists, each with a track count.
const MOCK_ARCHIVE_RESULT = {
  likedCount: 128,
  playlists: [
    { name: "Chill", count: 24 },
    { name: "Rap", count: 57 },
    { name: "Road trip", count: 12 },
  ],
};

// Simulates reading + parsing the uploaded VK archive file.
function mockParseArchive(file) {
  return new Promise((resolve) => setTimeout(() => resolve(MOCK_ARCHIVE_RESULT), 1100));
}

// Simulates creating the Liked Songs additions + each playlist on Spotify,
// reporting progress per "stage" (liked songs bucket, then each playlist).
function mockImport(archive, onProgress) {
  const stages = [
    { type: "liked", label: `Liked Songs (${archive.likedCount})` },
    ...archive.playlists.map((p) => ({ type: "playlist", label: `${p.name} (${p.count})`, playlist: p })),
  ];

  let done = 0;
  const results = { likedAdded: 0, playlists: [] };

  return new Promise((resolve) => {
    const interval = setInterval(() => {
      const stage = stages[done];
      if (stage.type === "liked") {
        results.likedAdded = archive.likedCount;
      } else {
        results.playlists.push({
          name: stage.playlist.name,
          added: stage.playlist.count,
          url: "https://open.spotify.com/playlist/mock_" + stage.playlist.name.toLowerCase().replace(/\s+/g, "_"),
        });
      }

      done += 1;
      onProgress(done, stages.length, stage.label);

      if (done >= stages.length) {
        clearInterval(interval);
        resolve(results);
      }
    }, 600);
  });
}

// ---------------------------------------------------------------------------
// APP STATE + RENDERING
// ---------------------------------------------------------------------------

const state = {
  user: null,
  archive: null,
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
    <div class="flex items-center gap-2 bg-neutral-900 border border-neutral-800 rounded-full pl-1 pr-4 py-1">
      <img src="${state.user.avatar}" onerror="this.style.display='none'"
        class="w-7 h-7 rounded-full bg-neutral-700" />
      <span class="text-sm font-medium">${state.user.display_name}</span>
    </div>
  `;
}

// Russian plural forms: n % 10 == 1 && n % 100 != 11 -> one; 2-4 (not 12-14) -> few; else -> many
function ruPlural(n, one, few, many) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

function renderImportSummary() {
  const a = state.archive;
  if (!a) {
    el.importSummary.innerHTML = "";
    return;
  }

  const playlistRows = a.playlists
    .map(
      (p) => `
        <div class="flex items-center justify-between text-sm bg-neutral-800/50 rounded-lg px-3 py-2">
          <span class="text-neutral-200">${p.name}</span>
          <span class="text-neutral-500">${p.count} ${ruPlural(p.count, "трек", "трека", "треков")}</span>
        </div>`
    )
    .join("");

  el.importSummary.innerHTML = `
    <div class="text-sm">
      <span class="text-neutral-400">Будет добавлено:</span>
      <span class="font-semibold text-neutral-100">${a.likedCount} ${ruPlural(a.likedCount, "любимый трек", "любимых трека", "любимых треков")}</span>
      <span class="text-neutral-500">в Liked Songs</span>
    </div>
    <div class="text-sm mb-2">
      <span class="font-semibold text-neutral-100">${a.playlists.length} ${ruPlural(a.playlists.length, "плейлист", "плейлиста", "плейлистов")}:</span>
    </div>
    <div class="space-y-1.5">${playlistRows}</div>
  `;
}

function unlock(cardEl) {
  cardEl.classList.remove("opacity-40", "pointer-events-none");
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
      storeTokens(await exchangeCodeForToken(code));
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
  el.parseStatus.textContent = `Разбираем «${file.name}»…`;

  const archive = await mockParseArchive(file);
  state.archive = archive;

  el.parseStatus.textContent = `Готово: найдено ${archive.likedCount} любимых треков и ${archive.playlists.length} плейлиста(ов).`;

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
  el.importBtn.disabled = true;
  el.progressArea.classList.remove("hidden");
  el.resultArea.classList.add("hidden");
  el.resultArea.innerHTML = "";

  const result = await mockImport(state.archive, (done, total, label) => {
    const pct = Math.round((done / total) * 100);
    el.progressBar.style.width = `${pct}%`;
    el.progressLabel.textContent = `Импортируем: ${label} (${done}/${total})`;
  });

  el.progressLabel.textContent = "Импорт завершён";

  const playlistResultRows = result.playlists
    .map(
      (p) => `
        <div class="flex items-center justify-between bg-neutral-800/60 border border-neutral-700 rounded-lg px-4 py-3">
          <span class="text-sm">${p.name} — добавлено ${p.added} ${ruPlural(p.added, "трек", "трека", "треков")}</span>
          <a href="${p.url}" target="_blank" class="text-spotify text-sm font-semibold hover:underline">Открыть →</a>
        </div>`
    )
    .join("");

  el.resultArea.innerHTML = `
    <div class="bg-neutral-800/60 border border-neutral-700 rounded-lg px-4 py-3 text-sm">
      Добавлено ${result.likedAdded} ${ruPlural(result.likedAdded, "трек", "трека", "треков")} в Liked Songs
    </div>
    ${playlistResultRows}
  `;
  el.resultArea.classList.remove("hidden");
  el.importBtn.disabled = false;
});
