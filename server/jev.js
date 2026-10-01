export class AgentError extends Error {
  constructor(message, code = 'AGENT_ERROR') { super(message); this.code = code; }
}

export const choice = (instructions, criteria) => ({ type: 'choice', instructions, criteria });

export function validateAnswers(body, questions, threshold) {
  if (!body?.answers) throw new AgentError('JEV 응답 형식이 올바르지 않습니다.', 'INVALID_RESPONSE');
  const result = {};
  for (const [id, question] of Object.entries(questions)) {
    const answer = body.answers[id];
    if (answer?.type !== 'choice' || !Object.hasOwn(question.criteria, answer.choice)
      || !Number.isFinite(answer.confidence) || answer.confidence < 0 || answer.confidence > 1) {
      throw new AgentError('JEV가 허용되지 않은 선택을 반환했습니다.', 'INVALID_RESPONSE');
    }
    if (answer.confidence < threshold) throw new AgentError('요청이 명확하지 않습니다. 메뉴, 온도, 수량을 구체적으로 말씀해 주세요.', 'UNCERTAIN');
    result[id] = answer.choice;
  }
  return result;
}

export class JevClient {
  constructor({ apiKey = process.env.TYPESAFE_API_KEY, model = process.env.JEV_MODEL || 'jev-latest',
    threshold = Number(process.env.JEV_MIN_CONFIDENCE || 0.5), fetchImpl = fetch } = {}) {
    this.apiKey = apiKey; this.model = model; this.threshold = threshold; this.fetch = fetchImpl;
    if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) throw new Error('Invalid JEV_MIN_CONFIDENCE');
  }
  get configured() { return Boolean(this.apiKey?.trim()); }
  async decide(state, questions, signal, { threshold = this.threshold } = {}) {
    if (!this.configured) throw new AgentError('.env에 TYPESAFE_API_KEY를 설정한 뒤 서버를 다시 시작해 주세요.', 'NOT_CONFIGURED');
    signal?.throwIfAborted();
    const timeout = AbortSignal.timeout(20000);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    let response;
    try {
      response = await this.fetch('https://api.typesafe.ai/v1/systemone', {
        method: 'POST', headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ state: JSON.stringify(state), model: this.model, questions }), signal: combined,
      });
    } catch (error) {
      if (signal?.aborted) throw signal.reason;
      throw new AgentError('JEV 연결 시간이 초과되었거나 네트워크에 연결할 수 없습니다.', 'NETWORK');
    }
    if (!response.ok) {
      const messages = { 401: 'JEV API 키를 확인해 주세요.', 402: 'JEV API 잔액을 확인해 주세요.', 429: 'JEV 요청 한도를 초과했습니다. 잠시 후 다시 시도해 주세요.' };
      throw new AgentError(messages[response.status] || `JEV 호출 실패 (HTTP ${response.status})`, 'PROVIDER');
    }
    let body;
    try { body = await response.json(); } catch { throw new AgentError('JEV 응답을 읽을 수 없습니다.', 'INVALID_RESPONSE'); }
    const answers = validateAnswers(body, questions, threshold);
    return { answers, confidences: Object.fromEntries(Object.entries(body.answers).map(([id, answer]) => [id, answer.confidence])), model: body.model || this.model };
  }
}
