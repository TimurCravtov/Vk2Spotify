// ---------------------------------------------------------------------------
// VK ARCHIVE EXTRACTION
// Reads a VK "Ваши данные" (data export) zip archive and returns liked audio
// + audio playlists, ready to hand to the Spotify import step.
//
// Archive layout (as of the 2026 export format):
//   audio/audio-albums.html            <- list of albums, each an <a> to:
//   audio/audio-albums/<id>/audios0.html, audios1.html, ...  <- paginated
//                                          track listings for that album
// Album id "-1" is VK's fixed id for "Мои аудиозаписи" (My audio) — the
// account's saved/liked tracks, not a real playlist. Every other id is a
// user-created playlist, named by the link text in audio-albums.html.
// Pages are windows-1251 encoded HTML fragments; track titles are rendered
// as "Artist &mdash; Title".
// ---------------------------------------------------------------------------

const LIKED_ALBUM_ID = "-1";
const MAX_PAGES_PER_ALBUM = 2000; // safety net against a malformed/huge archive

// The <meta charset> declaration is itself plain ASCII even inside a
// windows-1251 document, so it's safe to peek at with a windows-1251 decode
// first, then re-decode the full buffer with whatever charset it names.
function decodeVkHtml(bytes) {
  const head = new TextDecoder("windows-1251").decode(bytes.subarray(0, 512));
  const match = head.match(/charset=["']?([\w-]+)/i);
  const charset = match ? match[1].toLowerCase() : "windows-1251";
  try {
    return new TextDecoder(charset).decode(bytes);
  } catch {
    return new TextDecoder("windows-1251").decode(bytes);
  }
}

async function readVkPage(zip, path) {
  const entry = zip.file(path);
  if (!entry) return null;
  const bytes = await entry.async("uint8array");
  const html = decodeVkHtml(bytes);
  return new DOMParser().parseFromString(html, "text/html");
}

// "Artist — Title" -> { artist, title }. Splits on the first em dash only,
// so a title that itself contains " — " (remixes, features) stays intact.
function parseTrackTitle(rawText) {
  const text = rawText.replace(/\s+/g, " ").trim();
  const sepIndex = text.indexOf(" — ");
  if (sepIndex === -1) return { artist: "", title: text };
  return {
    artist: text.slice(0, sepIndex).trim(),
    title: text.slice(sepIndex + 3).trim(),
  };
}

function parseTracksFromPage(doc) {
  return Array.from(doc.querySelectorAll(".audio__title")).map((el) => parseTrackTitle(el.textContent));
}

// Reads audios0.html, audios1.html, ... for one album until a page is
// missing from the zip. Empty pages (VK renders a "Данных нет" stub) just
// contribute zero tracks and don't stop the loop by themselves.
async function readAlbumTracks(zip, basePath, albumId) {
  const tracks = [];
  for (let page = 0; page < MAX_PAGES_PER_ALBUM; page++) {
    const doc = await readVkPage(zip, `${basePath}${albumId}/audios${page}.html`);
    if (!doc) break;
    tracks.push(...parseTracksFromPage(doc));
  }
  return tracks;
}

// Finds "<somePrefix>/audio/audio-albums.html" anywhere in the zip so this
// still works if the export is wrapped in an extra top-level folder.
function findAlbumsIndexPath(zip) {
  return Object.keys(zip.files).find((path) => /(^|\/)audio\/audio-albums\.html$/i.test(path));
}

async function extractVkArchive(file) {
  let zip;
  try {
    zip = await JSZip.loadAsync(file);
  } catch (err) {
    throw new Error("Не удалось открыть файл как zip-архив: " + err.message);
  }

  const albumsIndexPath = findAlbumsIndexPath(zip);
  if (!albumsIndexPath) {
    throw new Error(
      "В архиве не найдены данные о музыке. Убедитесь, что при заказе архива ВКонтакте вы выбрали раздел «Музыка»."
    );
  }
  // e.g. albumsIndexPath = "audio/audio-albums.html" -> basePath = "audio-albums/"
  const audioDir = albumsIndexPath.slice(0, -"audio-albums.html".length);
  const basePath = `${audioDir}audio-albums/`;

  const albumsDoc = await readVkPage(zip, albumsIndexPath);
  const albumLinks = Array.from(albumsDoc.querySelectorAll(".albums--link a[href]"));

  const albums = [];
  for (const link of albumLinks) {
    const href = link.getAttribute("href") || "";
    const match = href.match(/audio-albums\/([^/]+)\/audios\d+\.html$/);
    if (!match) continue;

    const id = match[1];
    const name = link.textContent.trim() || "Без названия";
    const tracks = await readAlbumTracks(zip, basePath, id);
    albums.push({ id, name, tracks });
  }

  const likedAlbum = albums.find((a) => a.id === LIKED_ALBUM_ID);
  const liked = likedAlbum ? likedAlbum.tracks : [];
  const playlists = albums
    .filter((a) => a.id !== LIKED_ALBUM_ID && a.tracks.length > 0)
    .map((a) => ({ name: a.name, image: "", tracks: a.tracks }));

  return { liked, playlists };
}

window.VkImport = { extractVkArchive };
