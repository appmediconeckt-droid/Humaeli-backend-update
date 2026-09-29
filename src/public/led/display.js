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
    el('title').textContent = data.displayName || 'Patient queue';
    let doctors;
    if (data.displayType === 'doctor') doctors = [{ doctorName: data.doctor?.name, roomId: data.roomId,
      current: data.current, nextTokens: data.nextTokens, waitingCount: data.waitingCount,
      totalPatients: data.totalPatients, completedCount: data.completedCount }];
    else doctors = data.doctors || (data.departments || []).flatMap(d => d.doctors.map(doctor => ({ ...doctor, departmentName: d.departmentName })));
    el('doctors').classList.toggle('single', doctors.length === 1);
    el('doctors').replaceChildren(...doctors.map(doctor => {
      const card = textNode('section', 'doctor', '');
      card.append(textNode('h2', '', doctor.doctorName || 'Doctor'));
      const details = [doctor.departmentName || data.department?.name, doctor.roomId ? `Room ${doctor.roomId}` : ''].filter(Boolean).join(' · ');
      card.append(textNode('p', 'details', details), textNode('p', 'label', 'Now serving'),
        textNode('div', 'current', doctor.current?.token || '—'), textNode('p', 'label', 'Next tokens'),
        textNode('div', 'next', (doctor.nextTokens || (doctor.nextToken ? [doctor.nextToken] : [])).join('  ·  ') || '—'));
      const counts = textNode('div', 'counts', '');
      for (const [label, value] of [['Waiting', doctor.waitingCount], ['Completed', doctor.completedCount], ['Total today', doctor.totalPatients]]) {
        if (value === undefined) continue;
        const count = textNode('div', 'count', label); count.append(textNode('strong', '', String(value))); counts.append(count);
      }
      card.append(counts); return card;
    }));
    el('message').hidden = doctors.length > 0;
    el('message').textContent = 'No doctors configured for this display.';
    lastSuccess = Date.now(); document.body.classList.remove('stale');
    el('connection').textContent = 'Live · refreshes every 3 seconds';
    el('updated').textContent = `Updated ${new Date().toLocaleTimeString()}`;
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
    if (lastSuccess && Date.now() - lastSuccess > 15000) document.body.classList.add('stale');
    if (lastSuccess && Date.now() - lastSuccess > 60000) el('doctors').replaceChildren();
  }
  clock(); setInterval(clock, 1000); refresh();
})();
