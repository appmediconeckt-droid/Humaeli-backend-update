(() => {
  const toggle = document.getElementById('audio-toggle');
  const repeat = document.getElementById('audio-repeat');
  const supported = typeof speechSynthesis !== 'undefined' && typeof SpeechSynthesisUtterance !== 'undefined';
  let enabled = false;
  let announcements = [];
  let signature = '';

  function controls() {
    if (toggle) {
      toggle.textContent = supported ? enabled ? 'Mute audio' : 'Enable audio' : 'Audio unavailable';
      toggle.disabled = !supported;
      toggle.setAttribute('aria-pressed', String(enabled));
    }
    if (repeat) repeat.disabled = !enabled || announcements.length === 0;
  }

  function speak() {
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
      enabled = false;
      controls();
      if (toggle) toggle.textContent = 'Retry audio';
    };
    speechSynthesis.speak(utterance);
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
        return `${prefix}${doctor.tokens.length === 1 ? 'Next token number is' : 'Next token numbers are'} ${doctor.tokens.join(' and ')}. Please be ready near the clinic.`;
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
  toggle?.addEventListener('click', () => {
    if (!supported) return;
    enabled = !enabled;
    controls();
    if (enabled) speak();
    else speechSynthesis.cancel();
  });
  repeat?.addEventListener('click', speak);
  controls();
})();
