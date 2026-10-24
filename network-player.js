/* Runs in NBA's MAIN world. Uses its authenticated MKPlayer pipeline directly. */
(() => {
  if (window.__nbaNetworkCarouselBridge) return;
  const state = { require: null, context: null, players: new Map(), token: null, refreshAt: 0, refreshTimer: null, tokenJob: null };
  const deadline = (promise, ms = 10000) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('NBA playback request timed out after 10 seconds')), ms);
    Promise.resolve(promise).then(value => { clearTimeout(timer); resolve(value); }, error => { clearTimeout(timer); reject(error); });
  });
  const json = async (url, options = {}) => {
    const response = await fetch(url, { ...options, signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error('NBA playback returned HTTP ' + response.status);
    return response.json();
  };
  function requireNba() {
    if (state.require) return state.require;
    if (!window.webpackChunk_N_E) throw new Error('NBA player code is not loaded yet');
    window.webpackChunk_N_E.push([['nba-carousel-' + Date.now()], {}, require => { state.require = require; }]);
    return state.require;
  }
  function context() {
    const videos = [...document.querySelectorAll('video')].filter(v => !v.closest('#nba-live-carousel'));
    const result = { ...state.context };
    for (const video of videos) {
      const key = Object.keys(video).find(k => k.startsWith('__reactFiber'));
      for (let fiber = key && video[key], n = 0; fiber && n < 110; fiber = fiber.return, n++) {
        const props = fiber.memoizedProps;
        if (props?.configuration?.authToken) result.config = props.configuration;
        const value = props?.value;
        if (value?.mediaKindProfile) result.mediaKindProfile = value.mediaKindProfile;
        if (value?.nbaProfile) result.nbaProfile = value.nbaProfile;
        if (value?.webAds) result.webAds = value.webAds;
        if (value?.tve) result.tve = value.tve;
      }
    }
    if (!result.config?.authToken) throw new Error('Waiting for your NBA login and player configuration');
    state.context = result;
    return result;
  }
  function sdk(entry) { return entry.engine.bridge.adapter.player; }
  function refreshSignature(entry, tokens) {
    const player = sdk(entry);
    Object.assign(entry.source.cdnOptions.cdnTokens, tokens);
    if (player.sourceConfig?.cdnOptions?.cdnTokens) Object.assign(player.sourceConfig.cdnOptions.cdnTokens, tokens);
    const headers = player.headers || {};
    if (player.secureUrlManager?.getSignature && entry.source.registered) {
      const last = player.secureUrlManager.lastRequestInfo;
      const source = last?.url || player.sourceConfig?.hls || player.sourceConfig?.dash;
      if (source) return deadline(player.secureUrlManager.getSignature(source, last?.method, last?.excludeParams)).then(signature => {
        headers['X-MK-Signature'] = signature;
        player.headers = headers;
        // MKPlayer's own request hooks consult these headers on later requests.
        if (player.player) player.player.headers = headers;
      });
    }
    return Promise.resolve();
  }
  async function cdnToken(force = false) {
    if (!force && state.token && Date.now() < state.refreshAt) return state.token;
    if (state.tokenJob) return state.tokenJob;
    state.tokenJob = (async () => {
      const require = requireNba();
      const token = await deadline(require(37148).aD());
      if (!token?.tokenString) throw new Error('NBA did not return a CDN playback token');
      state.token = { hdnts: token.tokenString };
      const expiry = Number(token.expirationUnixTimeSeconds) * 1000;
      state.refreshAt = Number.isFinite(expiry) && expiry > Date.now() ? expiry - 120000 : Date.now() + 300000;
      const delay = Math.max(10000, Math.min(2147483647, state.refreshAt - Date.now()));
      clearTimeout(state.refreshTimer);
      state.refreshTimer = setTimeout(() => {
        cdnToken(true).then(tokens => Promise.allSettled([...state.players.values()].map(entry => refreshSignature(entry, tokens))))
          .catch(() => { state.refreshAt = 0; });
      }, delay);
      return state.token;
    })();
    try { return await state.tokenJob; } finally { state.tokenJob = null; }
  }
  async function sourceFor(game, ctx) {
    const require = requireNba(), helper = require(43658), constants = require(18744);
    const locationDetail = require(50086).Z(ctx.mediaKindProfile);
    const url = constants.hF + '/S1/subscriber/v2/events/' + encodeURIComponent(game.gameId) + '/play-options?IsexternalId=true&includeCRORestrictionFlags=true&locationDetail=' + encodeURIComponent(locationDetail || '');
    const options = await json(url, { headers: { 'Content-Type': 'application/json', Authorization: 'OAUTH2 access_token="' + ctx.config.authToken + '"' } });
    const order = await deadline(require(37148).o7(game.gameId, ''));
    const productions = require(36706).m7(options);
    const categories = require(26001).KV({ defaultStreamOrder: order, allStreams: productions, isUserInMarket: false });
    const selected = require(26001).hT(categories);
    const stream = selected?.defaultGameStream;
    if (!stream?.PlayActions?.length || stream.IsContentRestrictedForGeolocation || stream.Blackout?.State === 'Blackout') {
      throw new Error('NBA has no playable entitled stream for ' + game.awayName + ' @ ' + game.homeName);
    }
    const media = helper.nf(stream);
    const tokens = JSON.parse(helper.kX({ defaultGameStream: stream, defaultStreamOrderStream: selected.defaultStreamOrderStream, mediaKindProfile: ctx.mediaKindProfile, tve: ctx.tve, webAds: ctx.webAds, nbaProfile: ctx.nbaProfile, isMobile: false, isUserInMarket: false, videoAdsEnabled: true, gameTitle: game.awayName + ' @ ' + game.homeName }));
    Object.assign(tokens, await cdnToken(), { inMultiview: true });
    return helper.Zo({ mediaId: media.mediaId, appId: media.appId, authToken: ctx.config.authToken, cdnToken: tokens, playbackMode: media.playbackMode, enableLowLatency: ctx.config.enableLowLatency, startOffset: 0, startOffsetTimelineReference: 'END' });
  }
  async function loadOne(game, generation) {
    const ctx = context(), helper = requireNba()(43658);
    const slide = document.querySelector('.nba-live-slide[data-game-id="' + game.gameId + '"]');
    if (!slide) throw new Error('Carousel slide was closed');
    const host = slide.querySelector('.nba-network-host');
    const source = await sourceFor(game, ctx);
    if (generation !== state.generation) return;
    const engine = helper.Js({ plugins: [] });
    const entry = { game, engine, source, status: 'loading', error: null, recovering: false, loading: true, retries: 0 };
    state.players.set(game.gameId, entry);
    try {
      await deadline(engine.init(host, { ...helper.um(ctx.config.widevineEncryption, ctx.config.enableSecureUrl), nbaUi: false }));
      await deadline(engine.load(source));
      const readyUntil = Date.now() + 10000;
      while (Date.now() < readyUntil && generation === state.generation) {
        if ((host.querySelector('video')?.readyState || 0) >= 2 || engine.getState().error) break;
        await new Promise(resolve => setTimeout(resolve, 150));
      }
    } finally { entry.loading = false; }
    if (generation !== state.generation) { engine.destroy(); return; }
    entry.status = engine.getState().status;
    const video = host.querySelector('video');
    if (video) video.muted = true;
    return entry;
  }
  async function recover(entry) {
    if (entry.recovering || entry.loading || state.starting || state.recovering) return;
    entry.recovering = true;
    state.recovering = true;
    entry.retries++;
    try {
      const ctx = context();
      await cdnToken(true);
      const source = await sourceFor(entry.game, ctx);
      const slide = document.querySelector('.nba-live-slide[data-game-id="' + entry.game.gameId + '"]');
      if (!slide) return;
      const oldHost = slide.querySelector('.nba-network-host');
      const host = document.createElement('div'); host.className = 'nba-network-host';
      oldHost.replaceWith(host);
      try { entry.engine.destroy(); } catch {}
      const helper = requireNba()(43658);
      const engine = helper.Js({ plugins: [] });
      entry.engine = engine;
      entry.source = source;
      await deadline(engine.init(host, { ...helper.um(ctx.config.widevineEncryption, ctx.config.enableSecureUrl), nbaUi: false }));
      await deadline(engine.load(source));
      const readyUntil = Date.now() + 10000;
      while (Date.now() < readyUntil && !engine.getState().error && (host.querySelector('video')?.readyState || 0) < 2) {
        await new Promise(resolve => setTimeout(resolve, 150));
      }
      entry.error = null;
      delete slide.dataset.error;
    } catch (error) { entry.error = error.message; }
    finally { entry.recovering = false; state.recovering = false; }
  }
  function destroy() {
    state.generation = (state.generation || 0) + 1;
    state.starting = false;
    state.recovering = false;
    clearTimeout(state.refreshTimer);
    for (const entry of state.players.values()) {
      try { entry.engine.destroy(); } catch {}
    }
    state.players.clear();
    for (const item of state.originals || []) {
      if (item.playing) item.video.play().catch(() => {});
      item.video.muted = item.muted;
    }
    state.originals = [];
  }
  async function handle(data) {
    if (data.action === 'prepare') {
      context(); requireNba();
      return { ready: true };
    }
    if (data.action === 'start') {
      destroy();
      const generation = state.generation;
      state.originals = [...document.querySelectorAll('video')].filter(v => !v.closest('#nba-live-carousel')).map(video => ({ video, muted: video.muted, playing: !video.paused }));
      state.originals.forEach(item => { item.video.pause(); item.video.muted = true; });
      // MKPlayer shares some registration state. Avoid a burst of concurrent
      // registrations and license requests when many games are selected.
      (async () => {
        state.starting = true;
        for (const game of data.games) {
          if (generation !== state.generation) break;
          try { await loadOne(game, generation); }
          catch (error) {
            const entry = state.players.get(game.gameId);
            if (entry) entry.error = error.message;
            const slide = document.querySelector('.nba-live-slide[data-game-id="' + game.gameId + '"]');
            if (slide) slide.dataset.error = error.message;
          }
        }
        if (generation === state.generation) state.starting = false;
      })();
      return { started: data.games.length };
    }
    if (data.action === 'destroy') { destroy(); return {}; }
    if (data.action === 'refresh') {
      const tokens = await cdnToken(true);
      await Promise.allSettled([...state.players.values()].map(entry => refreshSignature(entry, tokens)));
      return { refreshed: state.players.size };
    }
    const entry = state.players.get(data.gameId);
    if (!entry) throw new Error('Stream is still loading');
    const player = sdk(entry);
    if (data.action === 'quality') {
      if (data.quality) player.player.player.setVideoQuality(data.quality);
      return { qualities: player.player.player.getAvailableVideoQualities(), current: player.player.player.getVideoQuality()?.id || 'auto' };
    }
    if (data.action === 'audio') {
      entry.engine.setVolume(100);
      if (data.muted) entry.engine.mute(); else entry.engine.unmute();
      return {};
    }
    if (data.action === 'status') {
      const playback = entry.engine.getState();
      if (!entry.lastAuthCheck || Date.now() - entry.lastAuthCheck > 15000) {
        entry.lastAuthCheck = Date.now();
        try {
          const token = context().config.authToken;
          if (token && token !== entry.source.registered.environmentConfig.authToken) {
            entry.source.registered.environmentConfig.authToken = token;
            player.updateAuthToken(token);
          }
        } catch {}
      }
      const error = entry.error || playback.error?.message || '';
      if (error && !entry.loading && !entry.recovering && entry.retries < 2 && /401|token|expired|authorization|license: 400|license: 5\d\d|removeChild|timed out|segment not available/i.test(error)) {
        recover(entry);
      }
      return { status: playback.status, quality: player.player?.player?.getVideoQuality?.()?.id || null, error: entry.error || playback.error?.message || null };
    }
    throw new Error('Unknown playback command');
  }
  window.__nbaNetworkCarouselBridge = { destroy };
  window.addEventListener('message', event => {
    const data = event.data;
    if (event.source !== window || data?.source !== 'nba-carousel-network') return;
    handle(data).then(result => window.postMessage({ source: 'nba-carousel-network-reply', requestId: data.requestId, ok: true, ...result }, location.origin))
      .catch(error => window.postMessage({ source: 'nba-carousel-network-reply', requestId: data.requestId, ok: false, error: error.message }, location.origin));
  });
})();
