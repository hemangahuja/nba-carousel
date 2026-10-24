/* NBA Carousel - popup. Lists live games from the active NBA tab and starts the carousel. */

const MIN_GAMES = 2;
const selected = new Set();
let games = [];
let tabId = null;

const $ = id => document.getElementById(id);

function setStatus(text, kind) {
  const el = $('status');
  el.textContent = text;
  el.className = 'status' + (kind ? ' ' + kind : '');
}

function sendToTab(message, timeout) {
  return Promise.race([
    chrome.tabs.sendMessage(tabId, message),
    new Promise((_, reject) => setTimeout(() => reject(new Error('The NBA page did not respond.')), timeout))
  ]);
}

async function ensureContentScript() {
  try {
    await sendToTab({ type: 'NBA_PING' }, 1500);
    return;
  } catch (error) {
    // Page was open before the extension loaded; inject the content script now.
  }
  await chrome.scripting.insertCSS({ target: { tabId }, files: ['content.css'] }).catch(() => {});
  await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
  await sendToTab({ type: 'NBA_PING' }, 3000);
}

function updateButton() {
  const enable = $('enable');
  enable.disabled = selected.size < MIN_GAMES;
  enable.textContent = selected.size ? 'Enable Carousel (' + selected.size + ')' : 'Enable Carousel';
}

function toggleGame(game, input) {
  if (input.checked) selected.add(game.gameId);
  else selected.delete(game.gameId);
  if (selected.size < MIN_GAMES) setStatus('Pick at least ' + MIN_GAMES + ' games.');
  else setStatus(selected.size + ' selected.', 'ok');
  updateButton();
}

function render() {
  const list = $('games');
  list.innerHTML = '';
  if (!games.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = 'No live games right now.';
    list.appendChild(empty);
    setStatus('Nothing live yet. Reopen this when games start.');
    updateButton();
    return;
  }

  games.forEach(game => {
    const row = document.createElement('label');
    row.className = 'game';

    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = selected.has(game.gameId);
    input.addEventListener('change', () => toggleGame(game, input));

    const text = document.createElement('div');
    const name = document.createElement('div');
    name.className = 'name';
    name.textContent = game.awayName + ' @ ' + game.homeName;
    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.textContent = game.awayScore + '–' + game.homeScore + ' · ' + game.status;
    text.append(name, meta);

    row.append(input, text);
    list.appendChild(row);
  });

  setStatus(games.length + ' live · pick at least ' + MIN_GAMES + '.');
  updateButton();
}

async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !/^https:\/\/([a-z0-9-]+\.)?nba\.com\//i.test(tab.url || '')) {
    setStatus('Open any nba.com page, then click the extension again.', 'error');
    $('games').innerHTML = '';
    return;
  }
  tabId = tab.id;
  await ensureContentScript();
  const reply = await sendToTab({ type: 'NBA_GET_GAMES' }, 9000);
  games = reply.games || [];
  render();
}

$('enable').addEventListener('click', async () => {
  const chosen = games.filter(game => selected.has(game.gameId));
  $('enable').disabled = true;
  setStatus('Starting…');
  try {
    const reply = await sendToTab({ type: 'NBA_START', games: chosen }, 8000);
    if (!reply || !reply.ok) throw new Error(reply && reply.error ? reply.error : 'Could not start.');
    setStatus('Building carousel…', 'ok');
    setTimeout(() => window.close(), 400);
  } catch (error) {
    setStatus(error.message, 'error');
    updateButton();
  }
});

$('close').addEventListener('click', async () => {
  if (tabId == null) return window.close();
  try {
    await sendToTab({ type: 'NBA_CLOSE' }, 3000);
    setStatus('Carousel closed.', 'ok');
  } catch (error) {
    setStatus('Nothing to close on this page.');
  }
});

init().catch(error => setStatus(error.message, 'error'));
