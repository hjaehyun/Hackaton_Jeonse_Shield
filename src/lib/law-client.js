// Fetches precedents for one topic from 법제처 국가법령정보.
//
// The OC is the account identifier, not a secret — the public case viewer
// needs none and the API answers to OC=test. It still lives in env rather than
// in source so a deployment can use its own.

import {
  TOPICS, SEARCH_URL, BODY_URL, selectPrecedents, normalizePrecedent,
} from './law.js';
import { cached } from './cache.js';

// Search wide enough that filtering to 대법원 still leaves candidates, then
// ask bodies for at most this many. Each body is one subrequest and the
// ceiling is 50, so this stays far inside it.
const SEARCH_SIZE = '20';
// The relevance filter discards decisions, so ask for more bodies than we
// intend to show. Each is one subrequest against a ceiling of 50.
const MAX_BODIES = 8;
const PRECEDENTS_SHOWN = 3;

// Precedents do not change. A week is short enough that a new decision shows
// up during the event and long enough to make repeat views free.
const CACHE_TTL_SECONDS = 604800;
const TIMEOUT_MS = 8000;

const NETWORK_ERROR_NAMES = new Set(['TypeError', 'AbortError', 'TimeoutError', 'NetworkError']);

export class LawUnavailableError extends Error {
  constructor(code = 'UPSTREAM_UNAVAILABLE') {
    // No cause and no detail: the request URL carries the OC.
    super('law lookup failed');
    this.name = 'LawUnavailableError';
    this.code = code;
  }
}

async function getJson(url, fetchImpl) {
  let response;
  let text;
  try {
    response = await fetchImpl(url.toString(), {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      redirect: 'manual',
    });
    text = await response.text();
  } catch (error) {
    // Only transport failures are translated. A bug in this file propagates so
    // it can be seen rather than reported as the ministry being down.
    if (!NETWORK_ERROR_NAMES.has(error?.name)) throw error;
    throw new LawUnavailableError();
  }

  if (!response.ok) throw new LawUnavailableError(`http_${response.status}`);
  // A search that matched nothing makes the body endpoint answer with an HTML
  // error page. Parsing that as an empty result would hide the failure.
  if (!text.trimStart().startsWith('{')) throw new LawUnavailableError('non_json');

  try {
    return JSON.parse(text);
  } catch {
    throw new LawUnavailableError('non_json');
  }
}

async function callUpstream(env, topicKey, fetchImpl) {
  const topic = TOPICS[topicKey];
  const oc = env?.LAW_OC ?? 'test';

  const search = new URL(SEARCH_URL);
  search.searchParams.set('OC', oc);
  search.searchParams.set('target', 'prec');
  search.searchParams.set('type', 'JSON');
  search.searchParams.set('display', SEARCH_SIZE);
  search.searchParams.set('query', topic.query);

  const found = await getJson(search, fetchImpl);
  const candidates = selectPrecedents(found?.PrecSearch?.prec, MAX_BODIES);

  const bodies = await Promise.all(candidates.map((listed) => {
    const url = new URL(BODY_URL);
    url.searchParams.set('OC', oc);
    url.searchParams.set('target', 'prec');
    url.searchParams.set('ID', String(listed['판례일련번호']));
    url.searchParams.set('type', 'JSON');
    return getJson(url, fetchImpl);
  }));

  const precedents = candidates
    .map((listed, index) => normalizePrecedent(listed, bodies[index]?.PrecService))
    .filter(Boolean)
    .slice(0, PRECEDENTS_SHOWN);

  return {
    topic: topicKey,
    label: topic.label,
    guidance: topic.guidance,
    precedents,
  };
}

/**
 * One topic's plain-language line plus up to three Supreme Court summaries.
 * An empty `precedents` list is a valid answer: the guidance stands on its own.
 */
export function fetchTopic(env, ctx, topicKey, fetchImpl = fetch) {
  if (!Object.hasOwn(TOPICS, topicKey)) {
    return Promise.reject(new LawUnavailableError('UNKNOWN_TOPIC'));
  }
  return cached(
    env,
    ctx,
    `law:v3:${topicKey}`,
    CACHE_TTL_SECONDS,
    () => callUpstream(env, topicKey, fetchImpl),
  );
}
