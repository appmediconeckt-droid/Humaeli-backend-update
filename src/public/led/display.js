(() => {
  const el = id => document.getElementById(id);
  const displayId = location.pathname.split('/').filter(Boolean).pop();
  const queueUrl = location.pathname.startsWith('/display/clinic/')
    ? `/api/qr/walkin/${encodeURIComponent(displayId)}/queue`
    : `/api/displays/${encodeURIComponent(displayId)}/queue`;
  let lastSuccess = 0;
  const textNode = (tag, className, text) => {
    const node = document.createElement(tag); node.className = className; node.textContent = text; return node;
  };
  function render(data) {
    el('facility').textContent = data.facility?.name || 'Humaeli';
    el('title').textContent = 'Clinic Queue';
    let doctors;
    if (data.displayType === 'doctor') doctors = [{ doctorId: data.doctor?.id || displayId, doctorName: data.doctor?.name, roomId: data.roomId,
      current: data.current, nextTokens: data.nextTokens, waitingCount: data.waitingCount,
      totalPatients: data.totalPatients, completedCount: data.completedCount,
      doctorStatus: data.doctorStatus, estimatedWaitMinutes: data.estimatedWaitMinutes,
      estimatedWaitLabel: data.estimatedWaitLabel, breakInfo: data.breakInfo }];
    else doctors = data.doctors || (data.departments || []).flatMap(d => d.doctors.map(doctor => ({ ...doctor, departmentName: d.departmentName })));
    el('doctors').classList.toggle('single', doctors.length === 1);
    el('doctors').replaceChildren(...doctors.map(doctor => {
      const card = textNode('section', 'doctor', '');
      card.append(textNode('h2', '', doctor.doctorName || 'Doctor'));
      const details = [doctor.departmentName || data.department?.name, doctor.roomId ? `Room ${doctor.roomId}` : ''].filter(Boolean).join(' · ');
      const current = textNode('div', 'current', '');
      current.append(textNode('span', 'token-value', doctor.current?.token ?? '—'));
      card.append(textNode('p', 'details', details), textNode('p', 'label', 'Now serving'),
        current, textNode('p', 'label next-label', 'Next tokens'),
        textNode('div', 'next', (doctor.nextTokens || (doctor.nextToken ? [doctor.nextToken] : [])).join('  ·  ') || '—'));
      const counts = textNode('div', 'counts', '');
      for (const [label, value, icon] of [['Waiting', doctor.waitingCount, '♟'], ['Completed', doctor.completedCount, '✓'], ['Total today', doctor.totalPatients, '▥'], ['Estimated wait for next token', doctor.estimatedWaitLabel || (doctor.estimatedWaitMinutes == null ? 'Timing unavailable' : `${doctor.estimatedWaitMinutes} min`), '◷']]) {
        const count = textNode('div', 'count', '');
        const copy = textNode('div', 'count-copy', label);
        copy.append(textNode('strong', label === 'Estimated wait for next token' && (doctor.estimatedWaitLabel || doctor.estimatedWaitMinutes == null) ? 'wait-status' : '', String(value ?? '—')));
        count.append(textNode('span', 'count-icon', icon), copy); counts.append(count);
      }
      const aside = textNode('aside', 'doctor-info', '');
      const status = textNode('section', 'status-panel', '');
      status.append(textNode('h3', '', '♟  Doctor status'));
      const state = doctor.doctorStatus;
      const paused = ['break', 'paused', 'delayed'].includes(state);
      const statusBody = textNode('div', `status-body${paused ? ' paused' : ''}`, '');
      const statusCopy = textNode('div', '', '');
      statusCopy.append(textNode('strong', '', ({ break: 'On break', paused: 'Paused', delayed: 'Delayed', consulting: 'Available', waiting: 'Waiting' })[state] || (doctor.current ? 'Available' : 'Waiting')),
        textNode('p', '', paused ? 'Please wait for updates' : doctor.current ? 'Seeing patients' : 'Waiting for next consultation'));
      statusBody.append(textNode('span', 'status-dot', ''), statusCopy); status.append(statusBody);
      const info = doctor.breakInfo || {};
      const delay = textNode('section', 'delay-panel', '');
      delay.append(textNode('h3', '', '◷  Break / delay info'));
      const delayBody = textNode('div', 'delay-body', '');
      delayBody.append(textNode('h4', '', `◷  ${info.headline || (paused ? 'Consultation temporarily delayed' : 'No delay reported')}`));
      for (const [label, value] of [[info.waitingForDoctor ? 'Scheduled start' : 'Expected start', info.waitingForDoctor ? info.scheduledStart : info.expectedStart], ['Break time', info.breakTime], [info.resumeMinutes == null && info.delayMinutes > 0 ? 'Running late' : 'Resume in', info.resumeMinutes != null ? `${info.resumeMinutes} min` : info.delayMinutes > 0 ? `${info.delayMinutes} min` : null], ['Delay reason', info.reason]]) {
        const row = textNode('div', 'info-row', '');
        row.append(textNode('span', '', label + ':'), textNode('strong', '', value == null ? '—' : String(value))); delayBody.append(row);
      }
      delay.append(delayBody); aside.append(status, delay);
      card.append(counts, aside); return card;
    }));
    el('message').hidden = doctors.length > 0;
    el('message').textContent = 'No doctors configured for this display.';
    lastSuccess = Date.now(); document.body.classList.remove('stale');
    el('connection').textContent = 'Live · refreshes every 3 seconds';
    el('updated').textContent = `Updated ${new Date().toLocaleTimeString()}`;
    globalThis.queueDisplayAudio?.update(doctors);
  }
  async function refresh() {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch(queueUrl, { cache: 'no-store', signal: controller.signal });
      const data = await response.json();
      if (!response.ok || !data.success) {
        if ([403, 404, 422].includes(response.status)) { el('doctors').replaceChildren(); lastSuccess = 0; }
        throw new Error(data.code === 'DATABASE_UNAVAILABLE' ? 'Database reconnecting — retrying automatically' : data.message || 'Unable to load queue');
      }
      render(data);
    } catch (error) {
      globalThis.queueDisplayAudio?.clear();
      document.body.classList.add('stale');
      el('connection').textContent = 'Connection interrupted';
      el('message').hidden = false;
      el('message').textContent = error.name === 'AbortError' ? 'Connection timed out — retrying automatically' : error.message;
    } finally { clearTimeout(timeout); setTimeout(refresh, 3000); }
  }
  el('fullscreen').addEventListener('click', async () => {
    try { await document.documentElement.requestFullscreen(); }
    catch { el('fullscreen').textContent = 'Use your browser full-screen option'; }
  });
  function clock() {
    el('clock').textContent = new Date().toLocaleTimeString();
    if (lastSuccess && Date.now() - lastSuccess > 15000) {
      document.body.classList.add('stale');
      globalThis.queueDisplayAudio?.clear();
    }
    if (lastSuccess && Date.now() - lastSuccess > 60000) el('doctors').replaceChildren();
  }
  clock(); setInterval(clock, 1000); refresh();
})();
