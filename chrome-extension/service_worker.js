chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "OPEN_WITH_IMAGE") return;
  void openWithImage(message.targetUrl, message.dataUrl)
    .then(() => sendResponse({ ok: true }))
    .catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : "Could not send the image." }));
  return true;
});

async function openWithImage(targetUrl, dataUrl) {
  const target = new URL(targetUrl);
  if (!/^https?:$/.test(target.protocol) || typeof dataUrl !== "string" || !dataUrl.startsWith("data:image/")) {
    throw new Error("The selected image or try-on page address is invalid.");
  }
  const tab = await chrome.tabs.create({ url: target.href, active: true });
  await waitForTab(tab.id);
  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    world: "MAIN",
    args: [dataUrl],
    func: (selectedImage) => window.dispatchEvent(new CustomEvent("fynd-extension-garment", { detail: selectedImage })),
  });
}

function waitForTab(tabId) {
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (error) => {
      if (done) return;
      done = true;
      clearTimeout(timeout);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      error ? reject(error) : resolve();
    };
    const timeout = setTimeout(() => finish(new Error("The try-on page did not finish loading.")), 20000);
    const onUpdated = (updatedTabId, changeInfo) => {
      if (updatedTabId === tabId && changeInfo.status === "complete") finish();
    };
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.get(tabId).then((tab) => {
      if (tab.status === "complete") finish();
    }).catch(finish);
  });
}
