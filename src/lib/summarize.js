// Turns a court's 판시사항 into a sentence a non-lawyer can read.
//
// The model only ever sees 판시사항, never the case file, and is told to say
// nothing the court did not. Its output is shown labelled as an AI summary with
// the court's own wording one tap below it, so a reader who doubts the summary
// can check it against the source on the same screen.
//
// Everything here fails soft. No key, an unreachable model, or an answer that
// does not look like a summary all return null, and the page falls back to
// showing 판시사항 first — which is what it did before summaries existed.

const ENDPOINT = 'https://api.upstage.ai/v1/chat/completions';
const MODEL = 'solar-pro4';
const TIMEOUT_MS = 12000;

// Bumped whenever the prompt changes, so cached summaries from an older
// instruction are not served alongside a new one.
export const SUMMARY_VERSION = 'p2';

const MIN_LENGTH = 40;

// Plain language is wordier than a court's, so a summary may legitimately run
// longer than its source — a terse 158-character 판시사항 with two numbered
// holdings needs more room, not less. What is being guarded against is the
// model rambling or echoing the source with commentary, which an absolute cap
// catches without discarding summaries that are doing their job.
const MAX_LENGTH = 500;

const NETWORK_ERROR_NAMES = new Set(['TypeError', 'AbortError', 'TimeoutError', 'NetworkError']);

export function buildPrompt(source) {
  return [
    {
      role: 'system',
      content: [
        '당신은 대법원 판례의 판시사항을 일반인이 이해할 수 있게 바꿔 쓰는 역할입니다.',
        '',
        '규칙:',
        '- 주어진 판시사항에 없는 내용을 덧붙이지 마세요. 추측하지 마세요.',
        '- 법률 조언이나 자문을 하지 마세요. 사실 관계만 풀어 쓰세요.',
        '- 두 문장 이내, 한국어 평서문으로 답하세요.',
        '- 조문 번호는 생략해도 됩니다. 결론이 무엇인지가 중요합니다.',
        '- 설명이나 머리말 없이 바꿔 쓴 문장만 출력하세요.',
      ].join('\n'),
    },
    { role: 'user', content: `다음 판시사항을 쉽게 바꿔 써 주세요.\n\n${source}` },
  ];
}

/**
 * Returns the summary if it looks like one, otherwise null.
 * Output short enough to be an acknowledgement ('네, 알겠습니다') has lost the
 * holding; output past the cap has stopped summarising and started rambling.
 *
 * `source` is unused by the current rules but kept in the signature: the
 * decision of what counts as a summary belongs with the text it summarises.
 */
export function acceptSummary(text, source) {
  if (typeof text !== 'string') return null;
  const trimmed = text.trim().replace(/^["'“”]+|["'“”]+$/g, '').trim();
  if (trimmed.length < MIN_LENGTH) return null;
  if (trimmed.length > MAX_LENGTH) return null;
  return trimmed;
}

/**
 * @returns {Promise<{text: string, model: string, version: string}|null>}
 */
export async function summarize(env, source, fetchImpl = fetch) {
  const key = env?.UPSTAGE_API_KEY;
  if (!key) return null;

  let payload;
  try {
    const response = await fetchImpl(ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        messages: buildPrompt(source),
        temperature: 0,
        max_tokens: 300,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) return null;
    payload = await response.json();
  } catch (error) {
    // Only transport failures are soft. A bug in this file propagates.
    if (!NETWORK_ERROR_NAMES.has(error?.name)) throw error;
    return null;
  }

  const text = acceptSummary(payload?.choices?.[0]?.message?.content, source);
  if (!text) return null;

  return { text, model: MODEL, version: SUMMARY_VERSION };
}
