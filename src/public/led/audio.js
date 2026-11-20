(() => {
  const chooseMaleAnnouncementVoice = (voices = []) => {
    const english = voices.filter(voice => /^en(?:-|_)/i.test(voice.lang || ''));
    const male = voice => /\b(ravi|prabhat|david|mark|guy|ryan|george|daniel|james|thomas|alex|arthur|male)\b/i.test(voice.name || '') && !/\bfemale\b/i.test(voice.name || '');
    return english.find(voice => male(voice) && /^en[-_]in$/i.test(voice.lang)) ||
      english.find(male) || english.find(voice => /^en[-_]in$/i.test(voice.lang)) || english[0];
  };
  const toggle = document.getElementById('audio-toggle');
  const repeat = document.getElementById('audio-repeat');
  const allow = document.getElementById('audio-allow');
  const status = document.getElementById('audio-status');
  const supported = typeof speechSynthesis !== 'undefined' && typeof SpeechSynthesisUtterance !== 'undefined';
  let enabled = false;
  let blocked = false;
  let saving = false;
  let syncError = "";
  const parts = location.pathname.split('/').filter(Boolean);
  const kind = parts[1] === 'clinic' ? 'clinic' : 'display';
  const audioUrl = `/led-control/${kind}/${encodeURIComponent(parts.at(-1))}/audio`;
  let announcements = [];
  let signature = '';

  function controls() {
    if (toggle) {
      toggle.textContent = enabled ? 'Mute linked screens' : 'Enable linked audio';
      toggle.disabled = saving;
      toggle.setAttribute('aria-pressed', String(enabled));
    }
    if (repeat) repeat.disabled = !enabled || !supported || blocked || announcements.length === 0;
    if (allow) allow.hidden = !enabled || !supported;
    if (status) {
      status.textContent = syncError || (!enabled ? 'Linked audio muted' : !supported ? 'Audio enabled for linked screens. Speech playback is unavailable in this browser.'
        : blocked ? 'Audio is enabled, but this browser blocked playback. Allow sound on this screen once, or use the Windows LED receiver launcher.'
          : announcements.length ? 'Linked audio enabled' : 'Linked audio enabled. Waiting for next tokens.');
    }
  }

  function speak() {
    // Try playback on every receiver. Only the browser may reject autoplay;
    // a local click on this particular screen is not an application prerequisite.
    if (!enabled || !supported || announcements.length === 0) return;
    speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(announcements.join(' '));
    utterance.lang = 'en-IN';
    utterance.rate = 0.9;
    utterance.volume = 1;
    const voice = chooseMaleAnnouncementVoice(speechSynthesis.getVoices());
    if (voice) utterance.voice = voice;
    utterance.onerror = event => {
      if (['canceled', 'interrupted'].includes(event.error)) return;
      blocked = true;
      controls();
    };
    utterance.onstart = () => { blocked = false; controls(); };
    speechSynthesis.speak(utterance);
  }

  function testSound() {
    if (!supported) return;
    speechSynthesis.cancel();
    const test = new SpeechSynthesisUtterance('Token announcement sound is enabled. Waiting for the next patient.');
    test.lang = 'en-IN';
    test.rate = 0.9;
    const voice = chooseMaleAnnouncementVoice(speechSynthesis.getVoices());
    if (voice) test.voice = voice;
    test.onerror = () => { blocked = true; controls(); };
    test.onstart = () => { blocked = false; controls(); };
    speechSynthesis.speak(test);
  }

  globalThis.queueDisplayAudio = {
    update(doctors) {
      const next = doctors.map(doctor => ({
        id: doctor.doctorId || doctor.doctorName || '', name: doctor.doctorName || 'Doctor',
        tokens: (doctor.nextTokens || (doctor.nextToken != null ? [doctor.nextToken] : []))
          .filter(token => token != null && String(token).trim() !== '').slice(0, 2).map(String),
      })).filter(doctor => doctor.tokens.length > 0);
      const nextSignature = JSON.stringify(next.map(doctor => [doctor.id, doctor.tokens]));
      announcements = next.map(doctor => {
        const prefix = doctors.length > 1 ? `For ${doctor.name}. ` : '';
        return `${prefix}${doctor.tokens.length === 1 ? 'Next token number' : 'Next token numbers'} ${doctor.tokens.join(' and ')} ${doctor.tokens.length === 1 ? 'is' : 'are'} available for ${doctor.tokens.length === 1 ? 'the patient' : 'patients'}. Please be ready for your turn.`;
      });
      const changed = signature !== nextSignature;
      signature = nextSignature;
      controls();
      if (changed) {
        if (announcements.length === 0 && supported) speechSynthesis.cancel();
        else speak();
      }
    },
    clear() {
      announcements = []; signature = '';
      if (supported) speechSynthesis.cancel();
      controls();
    },
  };
  const stream = new EventSource(audioUrl);
  stream.onmessage = event => {
    try {
      const state = JSON.parse(event.data);
      if (typeof state.enabled !== 'boolean' || saving) return;
      syncError = '';
      const changed = enabled !== state.enabled;
      enabled = state.enabled;
      controls();
      if (!enabled && supported) speechSynthesis.cancel();
      else if (changed) speak();
    } catch { /* Keep the last confirmed setting during reconnects. */ }
  };
  stream.onerror = () => { syncError = 'Audio connection interrupted. Retrying...'; controls(); };
  stream.onopen = () => { syncError = ''; controls(); };
  window.addEventListener('pagehide', () => stream.close());
  toggle?.addEventListener('click', async () => {
    if (saving) return;
    const previous = enabled;
    syncError = '';
    enabled = !enabled;
    saving = true;
    controls();
    if (enabled) {
      if (announcements.length) speak();
      else testSound();
    } else if (supported) speechSynthesis.cancel();
    try {
      const response = await fetch(audioUrl, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      });
      if (!response.ok) {
        const problem = await response.json().catch(() => ({}));
        const error = new Error(problem.message || 'Audio setting could not be saved');
        error.status = response.status;
        throw error;
      }
    } catch (error) {
      enabled = previous;
      if (!enabled && supported) speechSynthesis.cancel();
      else if (enabled) speak();
      syncError = error.status === 429 ? 'Too many requests. Wait a minute and retry.'
        : error.status === 404 || error.status === 410 ? 'Display link is unavailable. Open the latest LED link.'
        : error.status === 400 ? 'Audio request was rejected. Refresh the screen and retry.'
        : error.status === 503 ? 'Audio service is unavailable. Please retry shortly.'
        : error.status ? `Audio setting could not be saved (HTTP ${error.status}).`
        : 'Audio setting could not be saved. Check the connection and try again.';
    } finally { saving = false; controls(); }
  });
  allow?.addEventListener('click', () => {
    blocked = false;
    controls();
    if (announcements.length) speak();
    else testSound();
  });
  repeat?.addEventListener('click', speak);
  controls();
})();
