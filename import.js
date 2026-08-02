// ---------------------------------------------------------------------------
// VK ARCHIVE EXTRACTION
// Reads a VK "Ваши данные" export and returns liked audio + audio playlists.
// Still mocked: real parsing of the archive's HTML/JSON depends on VK's
// export format, which we haven't inspected yet. For now this returns a
// fixed set of real, popular tracks (not VK's actual messy filenames) so the
// Spotify search/matching side can be built and tested independently.
// ---------------------------------------------------------------------------

const POPULAR_TRACKS = [
  { artist: "Dua Lipa", title: "Levitating" },
  { artist: "The Weeknd", title: "Blinding Lights" },
  { artist: "Harry Styles", title: "As It Was" },
  { artist: "Billie Eilish", title: "bad guy" },
  { artist: "Imagine Dragons", title: "Believer" },
  { artist: "Coldplay", title: "Viva la Vida" },
  { artist: "Ed Sheeran", title: "Shape of You" },
  { artist: "Miley Cyrus", title: "Flowers" },
  { artist: "Queen", title: "Bohemian Rhapsody" },
  { artist: "Daft Punk", title: "Get Lucky" },
  { artist: "Adele", title: "Rolling in the Deep" },
  { artist: "Eminem", title: "Lose Yourself" },
  { artist: "Kendrick Lamar", title: "HUMBLE." },
  { artist: "Tame Impala", title: "The Less I Know the Better" },
];

function pickTracks(count, offset) {
  const tracks = [];
  for (let i = 0; i < count; i++) {
    tracks.push(POPULAR_TRACKS[(offset + i) % POPULAR_TRACKS.length]);
  }
  return tracks;
}

const MOCK_LIKED = pickTracks(10, 0);

const MOCK_PLAYLISTS = [
  { name: "Chill", image: "https://picsum.photos/seed/vk-chill/200/200", tracks: pickTracks(6, 2) },
  { name: "Rap", image: "https://picsum.photos/seed/vk-rap/200/200", tracks: pickTracks(5, 6) },
  { name: "Road trip", image: "https://picsum.photos/seed/vk-roadtrip/200/200", tracks: pickTracks(4, 10) },
];

// Simulates unzipping/parsing the archive file. Ignores its actual contents
// for now and resolves with the mock data above after a short delay.
function extractVkArchive(file) {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve({
        liked: MOCK_LIKED,
        playlists: MOCK_PLAYLISTS,
      });
    }, 1100);
  });
}

window.VkImport = { extractVkArchive };
