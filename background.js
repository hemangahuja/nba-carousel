// Install the authenticated playback bridge in the requesting NBA tab only.
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type !== 'INSTALL_NETWORK_BRIDGE' || !sender.tab) return false;
  chrome.scripting.executeScript({
    target: { tabId: sender.tab.id },
    world: 'MAIN',
    files: ['network-player.js']
  }).then(() => sendResponse({ ok: true }))
    .catch(error => sendResponse({ ok: false, error: error.message }));
  return true;
});
