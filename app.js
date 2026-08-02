// ---------------------------------------------------------------------------
// MOCK DATA & MOCK API LAYER
// Replace these with real Spotify Web API (PKCE) calls and real parsing of
// the VK "Ваши данные" archive once the flow below is validated.
// ---------------------------------------------------------------------------

const MOCK_USER = {
  display_name: "Тимур",
  avatar: "https://i.scdn.co/image/ab6775700000ee85f8f2c4b5f3b3b3b3b3b3b3b",
};

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

function mockLogin() {
  return new Promise((resolve) => setTimeout(() => resolve(MOCK_USER), 700));
}

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

el.connectBtn.addEventListener("click", async () => {
  el.connectBtn.disabled = true;
  el.connectBtn.textContent = "Подключение…";

  const user = await mockLogin();
  state.user = user;
  renderAuthArea();

  el.connectBtn.textContent = "Подключено";
  unlock(el.archiveCard);
});

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
