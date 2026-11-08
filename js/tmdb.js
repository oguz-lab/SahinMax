// TMDb (The Movie Database) – Filminfos, Poster, Staffeln, IMDb-IDs.
// Optional OMDb – echte IMDb-Bewertungen.

const BASE = 'https://api.themoviedb.org/3';
export const IMG = (p, size = 'w500') => p ? `https://image.tmdb.org/t/p/${size}${p}` : '';

let keys = { tmdb: '', omdb: '' };
export function setKeys(k) { keys = { ...keys, ...k }; }
export const hasTmdb = () => !!keys.tmdb;

async function get(path, params = {}, lang = 'de-DE') {
  const key = (keys.tmdb || '').trim();
  if (!key) throw new Error('Kein TMDb-Schlüssel hinterlegt (siehe Einstellungen).');
  const u = new URL(BASE + path);
  u.searchParams.set('language', lang);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  const headers = { accept: 'application/json' };
  if (key.length > 40) headers.Authorization = 'Bearer ' + key; // v4-Lesetoken
  else u.searchParams.set('api_key', key);                       // v3-Schlüssel
  let r;
  try { r = await fetch(u, { headers }); } catch { throw new Error('TMDb nicht erreichbar – bist du online?'); }
  if (r.status === 401) throw new Error('TMDb-Schlüssel ist ungültig.');
  if (!r.ok) throw new Error('TMDb-Fehler (' + r.status + ')');
  return r.json();
}

const yr = d => d ? d.slice(0, 4) : '';
const round = v => v ? Math.round(v * 10) / 10 : '';

export async function searchMovies(q) {
  const r = await get('/search/movie', { query: q, include_adult: 'false' });
  return r.results.slice(0, 12).map(x => ({
    id: x.id, title: x.title,
    sub: [yr(x.release_date), x.original_title !== x.title ? x.original_title : ''].filter(Boolean).join(' · '),
    thumb: IMG(x.poster_path, 'w92')
  }));
}

export async function movieDetails(id) {
  const d = await get('/movie/' + id, { append_to_response: 'external_ids' });
  let desc = d.overview;
  if (!desc) { try { desc = (await get('/movie/' + id, {}, 'en-US')).overview; } catch { /* egal */ } }
  const imdbId = d.imdb_id || d.external_ids?.imdb_id || '';
  return {
    tmdbId: d.id, title: d.title, originalTitle: d.original_title, year: yr(d.release_date),
    poster: IMG(d.poster_path), backdrop: IMG(d.backdrop_path, 'w780'),
    desc: desc || '', genres: (d.genres || []).map(g => g.name).join(', '),
    runtime: d.runtime || '', rating: round(d.vote_average), imdbId,
    imdbRating: await imdbRating(imdbId),
    collection: d.belongs_to_collection ? { id: d.belongs_to_collection.id, name: d.belongs_to_collection.name } : null
  };
}

export async function imdbRating(imdbId) {
  if (!keys.omdb || !imdbId) return '';
  try {
    const r = await fetch(`https://www.omdbapi.com/?i=${encodeURIComponent(imdbId)}&apikey=${encodeURIComponent(keys.omdb.trim())}`);
    const j = await r.json();
    return j.imdbRating && j.imdbRating !== 'N/A' ? j.imdbRating : '';
  } catch { return ''; }
}

const cleanCollName = n => String(n || '').replace(/\s*[-–]\s*Filmreihe$/i, '').replace(/\s+(Collection|Filmreihe|Reihe)$/i, '').trim();

export async function searchCollections(q) {
  const r = await get('/search/collection', { query: q });
  return r.results.slice(0, 12).map(x => ({ id: x.id, title: cleanCollName(x.name), sub: 'Filmreihe', thumb: IMG(x.poster_path, 'w92') }));
}

export async function collectionDetails(id) {
  const d = await get('/collection/' + id);
  return {
    tmdbCollectionId: d.id, name: cleanCollName(d.name), desc: d.overview || '',
    image: IMG(d.backdrop_path, 'w780') || IMG(d.poster_path),
    parts: (d.parts || []).filter(p => p.release_date)
      .sort((a, b) => a.release_date.localeCompare(b.release_date))
      .map(p => ({ tmdbId: p.id, title: p.title, year: yr(p.release_date) }))
  };
}

export async function searchTv(q) {
  const r = await get('/search/tv', { query: q });
  return r.results.slice(0, 12).map(x => ({
    id: x.id, title: x.name,
    sub: [yr(x.first_air_date), x.original_name !== x.name ? x.original_name : ''].filter(Boolean).join(' · '),
    thumb: IMG(x.poster_path, 'w92')
  }));
}

export async function tvDetails(id) {
  const d = await get('/tv/' + id, { append_to_response: 'external_ids' });
  let desc = d.overview;
  if (!desc) { try { desc = (await get('/tv/' + id, {}, 'en-US')).overview; } catch { /* egal */ } }
  const y1 = yr(d.first_air_date), y2 = yr(d.last_air_date);
  const running = d.status === 'Returning Series' || d.in_production;
  const year = !y1 ? '' : running ? `${y1}–` : (y2 && y2 !== y1 ? `${y1}–${y2}` : y1);
  const imdbId = d.external_ids?.imdb_id || '';
  return {
    tmdbId: d.id, name: d.name, originalName: d.original_name, year,
    poster: IMG(d.poster_path), backdrop: IMG(d.backdrop_path, 'w780'),
    desc: desc || '', genres: (d.genres || []).map(g => g.name).join(', '),
    rating: round(d.vote_average), imdbId, imdbRating: await imdbRating(imdbId),
    seasons: (d.seasons || []).filter(s => s.season_number > 0).map(s => ({
      number: s.season_number,
      name: /^(Staffel|Season)\s*\d+$/i.test(s.name || '') ? '' : (s.name || ''),
      year: yr(s.air_date) ? Number(yr(s.air_date)) : null,
      poster: IMG(s.poster_path, 'w342'),
      episodes: s.episode_count || null
    }))
  };
}
