(() => {
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
    const voices = speechSynthesis.getVoices();
    const voice = voices.find(item => item.lang.toLowerCase() === 'en-in') ||
      voices.find(item => item.lang.toLowerCase().startsWith('en'));
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
      if (!response.ok) throw new Error('Audio setting could not be saved');
    } catch {
      enabled = previous;
      if (!enabled && supported) speechSynthesis.cancel();
      else if (enabled) speak();
      syncError = 'Audio setting could not be saved. Check the connection and try again.';
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
