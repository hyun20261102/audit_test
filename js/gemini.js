// Gemini API 클라이언트 (브라우저에서 직접 호출, 스트리밍)
const Gemini = {
  BASE: 'https://generativelanguage.googleapis.com/v1beta',

  IDLE_TIMEOUT: 180000, // 이 시간 동안 아무 데이터도 오지 않으면 중단

  _body(system, prompt) {
    return JSON.stringify({
      systemInstruction: system ? { parts: [{ text: system }] } : undefined,
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.3, maxOutputTokens: 16384 },
    });
  },

  // 사용자 중지 신호 + 무응답 타이머를 묶은 AbortController
  _watchdog(signal, ms) {
    const ctrl = new AbortController();
    let timedOut = false, t;
    const kick = () => { clearTimeout(t); t = setTimeout(() => { timedOut = true; ctrl.abort(); }, ms); };
    if (signal) signal.addEventListener('abort', () => ctrl.abort());
    kick();
    return { signal: ctrl.signal, kick, stop: () => clearTimeout(t), timedOut: () => timedOut };
  },

  // 503(서버 혼잡)·429(한도)·500은 잠시 후 재시도 (2초, 5초, 10초)
  async _fetchRetry(url, opts, onRetry) {
    const waits = [2000, 5000, 10000];
    for (let i = 0; ; i++) {
      const res = await fetch(url, opts);
      if (res.ok || ![429, 500, 503].includes(res.status) || i >= waits.length) return res;
      if (onRetry) onRetry(i + 1, waits[i], res.status);
      await new Promise((resolve, reject) => {
        const t = setTimeout(resolve, waits[i]);
        if (opts.signal) opts.signal.addEventListener('abort', () => { clearTimeout(t); reject(new DOMException('aborted', 'AbortError')); });
      });
    }
  },

  _timeoutError(ms) {
    return new Error(`Gemini 응답 없음 (${Math.round(ms / 1000)}초 경과). 회사 방화벽/프록시가 Google API를 막고 있거나 모델이 응답하지 않습니다. 다른 모델로 바꿔 보세요.`);
  },

  // onText(누적 텍스트) 콜백으로 스트리밍 결과 전달, 최종 텍스트 반환
  async generate({ key, model, system, prompt, onText, onRetry, signal }) {
    if (!key) throw new Error('Gemini API 키가 없습니다. 설정 탭에서 입력하세요.');
    const wd = this._watchdog(signal, this.IDLE_TIMEOUT);
    try {
      const res = await this._fetchRetry(`${this.BASE}/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: this._body(system, prompt),
        signal: wd.signal,
      }, (n, ms, st) => { wd.kick(); if (onRetry) onRetry(n, ms, st); });
      if (!res.ok) throw new Error(await this._errorText(res));

      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '', text = '', finish = '';
      const handle = line => {
        if (!line.startsWith('data:')) return;
        let j;
        try { j = JSON.parse(line.slice(5)); } catch (e) { return; }
        if (j.error) throw new Error('Gemini 오류: ' + j.error.message);
        const c = j.candidates && j.candidates[0];
        if (!c) {
          if (j.promptFeedback && j.promptFeedback.blockReason) throw new Error('요청이 차단되었습니다: ' + j.promptFeedback.blockReason);
          return;
        }
        const parts = (c.content && c.content.parts) || [];
        text += parts.filter(p => !p.thought && p.text).map(p => p.text).join('');
        if (c.finishReason) finish = c.finishReason;
        if (onText) onText(text);
      };
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        wd.kick();
        buf += dec.decode(value, { stream: true });
        const lines = buf.split(/\r?\n/);
        buf = lines.pop();
        lines.forEach(handle);
      }
      handle(buf.trim());
      if (!text && finish !== 'STOP') throw new Error(`Gemini가 빈 응답을 보냈습니다 (종료 사유: ${finish || '없음'}).`);
      if (finish === 'MAX_TOKENS') text += '\n\n> ⚠️ 응답 길이 제한으로 내용이 잘렸습니다.';
      if (finish === 'SAFETY') text += '\n\n> ⚠️ 안전 필터로 응답이 중단되었습니다.';
      return text;
    } catch (err) {
      if (err.name === 'AbortError' && wd.timedOut()) throw this._timeoutError(this.IDLE_TIMEOUT);
      throw err;
    } finally {
      wd.stop();
    }
  },

  // 스트리밍 없이 한 번에 받기 (연결 테스트용)
  async generateOnce({ key, model, prompt, timeoutMs = 45000, onRetry }) {
    const wd = this._watchdog(null, timeoutMs);
    try {
      const res = await this._fetchRetry(`${this.BASE}/models/${encodeURIComponent(model)}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: this._body('', prompt),
        signal: wd.signal,
      }, (n, ms, st) => { wd.kick(); if (onRetry) onRetry(n, ms, st); });
      if (!res.ok) throw new Error(await this._errorText(res));
      const j = await res.json();
      const c = j.candidates && j.candidates[0];
      return ((c && c.content && c.content.parts) || []).filter(p => !p.thought && p.text).map(p => p.text).join('');
    } catch (err) {
      if (err.name === 'AbortError' && wd.timedOut()) throw this._timeoutError(timeoutMs);
      throw err;
    } finally {
      wd.stop();
    }
  },

  async _errorText(res) {
    let msg = `HTTP ${res.status}`;
    try {
      const j = await res.json();
      const e = Array.isArray(j) ? j[0].error : j.error;
      if (e) msg += ` · ${e.status || ''} ${e.message || ''}`;
    } catch (e) {}
    if (res.status === 400 && /API key/i.test(msg)) msg += ' (API 키를 확인하세요)';
    if (res.status === 404) msg += ' (설정 탭에서 "저장 및 연결 테스트"를 다시 누르면 사용 가능한 모델로 바뀝니다)';
    if (res.status === 429) msg += ' (호출 한도 초과 — 잠시 후 다시 시도)';
    if (res.status === 503 || res.status === 500) msg += ' (Google 서버 혼잡 — 3회 재시도 후에도 실패. 잠시 후 다시 시도하거나 설정 탭에서 다른 모델(예: flash-lite, pro)을 선택하세요)';
    return 'Gemini 오류: ' + msg;
  },

  // 이 키로 쓸 수 있는 텍스트 생성 모델 목록 (모델 이름이 자주 바뀌므로 API에서 직접 조회)
  async listModels(key) {
    const res = await fetch(`${this.BASE}/models?pageSize=1000`, { headers: { 'x-goog-api-key': key } });
    if (!res.ok) throw new Error(await this._errorText(res));
    const j = await res.json();
    return (j.models || [])
      .filter(m => (m.supportedGenerationMethods || []).includes('generateContent'))
      .map(m => m.name.replace(/^models\//, ''))
      .filter(n => /^gemini/.test(n) && !/embedding|tts|image|audio|live|robotics|computer-use|banana|transcribe|omni|customtools/.test(n));
  },

  // 추천 모델: 최신 버전의 flash(정식) > flash-lite > pro > 첫 번째
  pickModel(names) {
    const ver = n => parseFloat((n.match(/gemini-(\d+(?:\.\d+)?)/) || [])[1] || 0);
    const stable = names.filter(n => !/preview|exp|latest/.test(n)).sort((a, b) => ver(b) - ver(a));
    return stable.find(n => /-flash$/.test(n)) || stable.find(n => /-flash-lite$/.test(n))
      || stable.find(n => /-pro$/.test(n)) || stable[0] || names[0] || '';
  },

  async test(key, model, onRetry) {
    return this.generateOnce({ key, model, onRetry, prompt: '연결 테스트입니다. "OK"라고만 답하세요.' });
  },
};
