(() => {
  if (window.__nbaCarouselContentLoaded) return;
  window.__nbaCarouselContentLoaded = true;
  const REQUEST_KEY = 'nbaCarouselRequest';
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  let carousel = null, busy = false, sequence = 0;
  function bridge(action, extra = {}) {
    const requestId = ++sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { window.removeEventListener('message', receive); reject(new Error('Playback command timed out after 10 seconds')); }, 10000);
      function receive(event) {
        if (event.source !== window || event.data?.source !== 'nba-carousel-network-reply' || event.data.requestId !== requestId) return;
        clearTimeout(timer); window.removeEventListener('message', receive);
        if (event.data.ok) resolve(event.data); else reject(new Error(event.data.error));
      }
      window.addEventListener('message', receive);
      window.postMessage({ source: 'nba-carousel-network', requestId, action, ...extra }, location.origin);
    });
  }
  function readCards(liveOnly = true) {
    const seen = new Set(), games = [];
    document.querySelectorAll('[class*="scoreStripGameCard"]').forEach(card => {
      const metadata = card.querySelector('[data-content-id][data-content]');
      const gameId = metadata?.getAttribute('data-content-id');
      const codes = metadata?.getAttribute('data-content')?.match(/([A-Z]{2,3})\s*@\s*([A-Z]{2,3})/);
      if (!gameId || seen.has(gameId) || !codes) return;
      const lines = card.innerText.split('\n').map(s => s.trim()).filter(Boolean).filter(s => !/^(Add to Multiview|League Pass|Amazon Prime|View Game)$/i.test(s));
      const index = lines.findIndex(s => /^(Q[1-4]|OT\d*|HALF|END OF|FINAL)/i.test(s));
      if (index < 0 || (liveOnly && /^FINAL/i.test(lines[index]))) return;
      const [awayName, awayScore, homeName, homeScore] = lines.slice(index + 1, index + 5);
      if (!awayName || !homeName) return;
      seen.add(gameId);
      games.push({ gameId, awayTri: codes[1], homeTri: codes[2], awayName, homeName, awayScore, homeScore, status: lines[index], slug: (codes[1] + '-vs-' + codes[2] + '-' + gameId).toLowerCase() });
    });
    return games;
  }
  async function scores() {
    try {
      const response = await fetch('https://cdn.nba.com/static/json/liveData/scoreboard/todaysScoreboard_00.json', { signal: AbortSignal.timeout(10000) });
      if (!response.ok) throw new Error('Scoreboard unavailable');
      const data = await response.json();
      return data.scoreboard.games.map(game => ({
        gameId: game.gameId, awayTri: game.awayTeam.teamTricode, homeTri: game.homeTeam.teamTricode,
        awayName: game.awayTeam.teamName, homeName: game.homeTeam.teamName,
        awayScore: game.awayTeam.score, homeScore: game.homeTeam.score, status: game.gameStatusText,
        live: game.gameStatus === 2,
        slug: (game.awayTeam.teamTricode + '-vs-' + game.homeTeam.teamTricode + '-' + game.gameId).toLowerCase()
      }));
    } catch {
      return readCards(false).map(game => ({ ...game, live: !/^FINAL/i.test(game.status) }));
    }
  }
  function toast(text, error = false) {
    let element = document.getElementById('nba-carousel-toast');
    if (!text) return element?.remove();
    if (!element) { element = document.createElement('div'); element.id = 'nba-carousel-toast'; document.body.appendChild(element); }
    element.textContent = text;
    element.classList.toggle('error', error);
  }
  function build(games) {
    const overlay = document.createElement('div');
    overlay.id = 'nba-live-carousel';
    overlay.innerHTML = '<div class="nba-live-track"></div><div class="nba-live-hud"><div class="nba-live-label"></div><select class="nba-live-quality" aria-label="Active stream quality" disabled><option>Loading…</option></select><div class="nba-live-count"></div><button class="nba-live-close" type="button" aria-label="Close carousel">×</button></div><div class="nba-live-scores" aria-label="Selected games and live scores"></div>';
    const track = overlay.querySelector('.nba-live-track'), scoreBar = overlay.querySelector('.nba-live-scores'), select = overlay.querySelector('select');
    const items = games.map(game => {
      const slide = document.createElement('div');
      slide.className = 'nba-live-slide'; slide.dataset.gameId = game.gameId;
      slide.innerHTML = '<div class="nba-network-host"></div><div class="nba-network-status" role="status">Loading live stream…</div>';
      track.appendChild(slide);
      const chip = document.createElement('button'); chip.type = 'button'; chip.className = 'nba-live-score';
      const line = document.createElement('span'); line.className = 'nba-live-score-line';
      const clock = document.createElement('span'); clock.className = 'nba-live-score-status';
      chip.append(line, clock); scoreBar.appendChild(chip);
      return { game, slide, chip, line, clock, info: null, preferred: null, applying: false, applied: null, audio: null };
    });
    let current = 0, sound = true, destroyed = false, polling = false, scorePolling = false;
    const bodyOverflow = document.body.style.overflow, htmlOverflow = document.documentElement.style.overflow;
    document.body.appendChild(overlay);
    document.body.style.overflow = 'hidden'; document.documentElement.style.overflow = 'hidden';
    function renderScores() {
      items.forEach((item, index) => {
        const game = item.game;
        item.line.textContent = game.awayTri + ' ' + game.awayScore + ' — ' + game.homeScore + ' ' + game.homeTri;
        item.clock.textContent = game.status || 'Live';
        item.chip.classList.toggle('active', index === current);
        item.chip.setAttribute('aria-current', String(index === current));
        item.chip.setAttribute('aria-label', game.awayName + ' at ' + game.homeName + ', ' + game.awayScore + ' to ' + game.homeScore + ', ' + game.status);
      });
    }
    function wanted(item) {
      const index = items.indexOf(item), qualities = item.info?.qualities || [];
      return index === current ? item.preferred || qualities[0]?.id : qualities[qualities.length - 1]?.id;
    }
    function fillQuality() {
      const item = items[current];
      if (!item.info) { select.disabled = true; select.innerHTML = '<option>Loading…</option>'; return; }
      select.replaceChildren();
      const choices = [{ id: 'auto', label: 'Auto' }, ...item.info.qualities.map(q => ({ id: q.id, label: q.height + 'p · ' + Math.round(q.bitrate / 1000) + ' kbps' }))];
      for (const choice of choices) {
        const option = document.createElement('option'); option.value = choice.id; option.textContent = choice.label; select.appendChild(option);
      }
      select.value = wanted(item) || 'auto'; select.disabled = false;
    }
    async function apply(item) {
      if (destroyed || item.applying || !item.info) return;
      item.applying = true;
      try {
        // Re-evaluate after each response so a quick key repeat cannot leave an
        // off-screen stream at HQ or a newly selected stream at low quality.
        while (!destroyed && item.applied !== wanted(item)) {
          const quality = wanted(item);
          if (!quality) break;
          await bridge('quality', { gameId: item.game.gameId, quality });
          item.applied = quality;
        }
      } catch { item.applied = null; }
      finally { item.applying = false; }
    }
    function update() {
      track.style.transform = 'translate3d(-' + current * 100 + 'vw,0,0)';
      overlay.dataset.current = String(current); overlay.dataset.count = String(items.length);
      overlay.querySelector('.nba-live-label').textContent = items[current].game.awayName.toUpperCase() + ' @ ' + items[current].game.homeName.toUpperCase() + ' · ← → · M sound';
      overlay.querySelector('.nba-live-count').textContent = (current + 1) + ' / ' + items.length;
      renderScores(); fillQuality();
      items.forEach((item, index) => {
        apply(item);
        const muted = index !== current || !sound;
        if (item.audio !== muted) bridge('audio', { gameId: item.game.gameId, muted }).then(() => { item.audio = muted; }).catch(() => {});
      });
    }
    function go(index) {
      current = Math.max(0, Math.min(items.length - 1, index)); update();
      items[current].chip.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
    }
    items.forEach((item, index) => item.chip.addEventListener('click', () => go(index)));
    select.addEventListener('change', () => { items[current].preferred = select.value; apply(items[current]); select.blur(); });
    function keydown(event) {
      if (event.target?.matches('input,textarea,[contenteditable="true"]')) return;
      const key = event.key.toLowerCase();
      if (!['arrowright', 'arrowleft', 'escape', 'm'].includes(key)) return;
      event.preventDefault(); event.stopImmediatePropagation();
      if (key === 'arrowright') go(current + 1);
      if (key === 'arrowleft') go(current - 1);
      if (key === 'm') { sound = !sound; update(); }
      if (key === 'escape') destroy();
    }
    async function poll() {
      if (polling || destroyed) return;
      polling = true;
      await Promise.all(items.map(async item => {
        try {
          const playback = await bridge('status', { gameId: item.game.gameId });
          if (destroyed) return;
          const video = item.slide.querySelector('video');
          const status = item.slide.querySelector('.nba-network-status');
          status.textContent = playback.error || item.slide.dataset.error || 'Loading live stream…';
          status.hidden = !!video && video.readyState >= 2 && !playback.error;
          if (!video || video.readyState < 2 || playback.error) return;
          if (playback.quality) item.applied = playback.quality;
          if (!item.info || !item.info.qualities.length) {
            const info = await bridge('quality', { gameId: item.game.gameId });
            item.info = { qualities: info.qualities.slice().sort((a, b) => b.bitrate - a.bitrate) };
          }
          await apply(item);
          const muted = items.indexOf(item) !== current || !sound;
          if (item.audio !== muted) { await bridge('audio', { gameId: item.game.gameId, muted }); item.audio = muted; }
        } catch {
          if (item.slide.dataset.error) item.slide.querySelector('.nba-network-status').textContent = item.slide.dataset.error;
        }
      }));
      if (!destroyed) fillQuality();
      polling = false;
    }
    async function updateScores() {
      if (scorePolling || destroyed) return;
      scorePolling = true;
      const fresh = new Map((await scores()).map(game => [game.gameId, game]));
      if (!destroyed) {
        items.forEach(item => { if (fresh.has(item.game.gameId)) item.game = fresh.get(item.game.gameId); }); renderScores();
      }
      scorePolling = false;
    }
    function destroy() {
      if (destroyed) return;
      destroyed = true; clearInterval(statusTimer); clearInterval(scoreTimer);
      window.removeEventListener('keydown', keydown, true);
      overlay.remove();
      bridge('destroy').catch(() => {});
      document.body.style.overflow = bodyOverflow; document.documentElement.style.overflow = htmlOverflow;
      if (carousel === api) carousel = null;
    }
    const statusTimer = setInterval(poll, 1000), scoreTimer = setInterval(updateScores, 4000);
    const api = { destroy };
    overlay.querySelector('.nba-live-close').addEventListener('click', destroy);
    window.addEventListener('keydown', keydown, true);
    update(); updateScores();
    bridge('start', { games }).then(poll).catch(error => toast(error.message, true));
    return api;
  }
  async function processRequest() {
    if (busy) return;
    let request;
    try { request = JSON.parse(sessionStorage.getItem(REQUEST_KEY)); } catch { return; }
    if (!request) return;
    if (!Array.isArray(request.games) || request.games.length < 2 || Date.now() - request.created > 300000) { sessionStorage.removeItem(REQUEST_KEY); return; }
    const first = request.games[0];
    if (!location.pathname.includes(first.gameId) || new URLSearchParams(location.search).get('watchLive') !== 'true') {
      location.assign('https://www.nba.com/game/' + first.slug + '?watchLive=true'); return;
    }
    busy = true;
    try {
      if (carousel) { carousel.destroy(); await sleep(100); }
      toast('Preparing authenticated NBA streams…');
      const installed = await chrome.runtime.sendMessage({ type: 'INSTALL_NETWORK_BRIDGE' });
      if (!installed?.ok) throw new Error(installed?.error || 'Could not install playback bridge');
      let ready = false, lastError;
      const until = Date.now() + 30000;
      while (Date.now() < until) {
        try { await bridge('prepare'); ready = true; break; } catch (error) { lastError = error; }
        await sleep(400);
      }
      if (!ready) throw lastError || new Error('NBA player did not finish loading');
      carousel = build(request.games);
      sessionStorage.removeItem(REQUEST_KEY); toast(null);
    } catch (error) { sessionStorage.removeItem(REQUEST_KEY); toast(error.message, true); }
    finally { busy = false; }
  }
  chrome.runtime.onMessage.addListener((message, sender, reply) => {
    if (message.type === 'NBA_PING') { reply({ ok: true, active: !!carousel }); return false; }
    if (message.type === 'NBA_GET_GAMES') {
      scores().then(games => reply({ ok: true, games: games.filter(game => game.live) })).catch(error => reply({ ok: false, error: error.message })); return true;
    }
    if (message.type === 'NBA_START') {
      if (!Array.isArray(message.games) || message.games.length < 2 || !message.games.every(g => /^\d+$/.test(g.gameId) && /^[a-z0-9-]+$/.test(g.slug))) { reply({ ok: false, error: 'Choose at least two live games' }); return false; }
      sessionStorage.setItem(REQUEST_KEY, JSON.stringify({ games: message.games, created: Date.now() }));
      reply({ ok: true }); setTimeout(processRequest, 50); return false;
    }
    if (message.type === 'NBA_CLOSE') { carousel?.destroy(); sessionStorage.removeItem(REQUEST_KEY); reply({ ok: true }); return false; }
    return false;
  });
  setTimeout(processRequest, 300);
})();
