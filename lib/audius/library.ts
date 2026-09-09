// Followed Audius artists — the Music tab's "subscribe". localStorage, same
// rationale as the other media sections (tiny volumes, zero round-trips).

const FOLLOWS_KEY = "mosaic.audius.follows";

// A trimmed artist record — enough to render the "Following" rail without a
// re-fetch. The full artist is re-fetched when its page is opened.
export type FollowedArtist = {
  id: string;
  name: string;
  handle: string;
  picture: string | null;
  addedAt: number;
};

export function loadFollows(): FollowedArtist[] {
  try {
    const raw = localStorage.getItem(FOLLOWS_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr)
      ? arr.filter((a) => a && typeof a.id === "string" && typeof a.name === "string")
      : [];
  } catch {
    return [];
  }
}

function save(follows: FollowedArtist[]) {
  try {
    localStorage.setItem(FOLLOWS_KEY, JSON.stringify(follows));
  } catch {
    /* ignore */
  }
}

export function isFollowing(id: string): boolean {
  return loadFollows().some((a) => a.id === id);
}

export function addFollow(artist: Omit<FollowedArtist, "addedAt">) {
  const follows = loadFollows().filter((a) => a.id !== artist.id);
  save([
    {
      id: artist.id,
      name: artist.name,
      handle: artist.handle,
      picture: artist.picture,
      addedAt: Date.now(),
    },
    ...follows,
  ]);
}

export function removeFollow(id: string) {
  save(loadFollows().filter((a) => a.id !== id));
}
