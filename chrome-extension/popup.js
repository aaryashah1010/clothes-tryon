const targetInput = document.getElementById("target");
const prepInput = document.getElementById("prep");
const prepTokenInput = document.getElementById("prep-token");
const status = document.getElementById("status");
const imageList = document.getElementById("images");
const fileInput = document.getElementById("file");
const selectedPhoto = document.getElementById("selected-photo");
const selectedPreview = document.getElementById("selected-preview");
const selectedName = document.getElementById("selected-name");
let pendingFile = null;
let previewUrl = "";

chrome.storage.local.get({ targetUrl: targetInput.value, prepUrl: prepInput.value, prepToken: "" }).then(({ targetUrl, prepUrl, prepToken }) => {
  targetInput.value = targetUrl;
  prepInput.value = prepUrl || (new URL(targetUrl).hostname === "127.0.0.1" ? prepInput.value : "");
  prepTokenInput.value = prepToken;
});

document.getElementById("save").addEventListener("click", async () => {
  try {
    const target = new URL(targetInput.value);
    if (!/^https?:$/.test(target.protocol)) throw new Error("Use an http or https try-on page.");
    const prep = prepInput.value.trim();
    if (prep && !/^https?:$/.test(new URL(prep).protocol)) throw new Error("Use an http or https preparation URL.");
    const granted = await chrome.permissions.request({ origins: [`${target.origin}/*`] });
    if (!granted) {
      status.textContent = "Allow access to the try-on page, then click Save again.";
      return;
    }
    await chrome.storage.local.set({ targetUrl: target.href, prepUrl: prep, prepToken: prepTokenInput.value.trim() });
    status.textContent = "Try-on and preparation settings saved.";
  } catch {
    status.textContent = "Enter a valid try-on page URL and allow Chrome's access prompt.";
  }
});

document.getElementById("upload").addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", () => {
  const file = fileInput.files?.[0];
  fileInput.value = "";
  if (!file) return;
  if (!file.type.startsWith("image/")) {
    status.textContent = "Choose an image file.";
    return;
  }
  if (file.size > 8 * 1024 * 1024) {
    status.textContent = "This image is over 8 MB. Choose a smaller photo.";
    return;
  }
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  pendingFile = file;
  previewUrl = URL.createObjectURL(file);
  selectedPreview.src = previewUrl;
  selectedName.textContent = file.name;
  selectedPhoto.hidden = false;
  status.textContent = "Photo selected. Check the preview, then click Use this photo.";
});

document.getElementById("send-selected").addEventListener("click", () => {
  if (pendingFile) void sendLocalFile(pendingFile);
});
document.getElementById("clear-selected").addEventListener("click", () => {
  pendingFile = null;
  selectedPhoto.hidden = true;
  selectedPreview.removeAttribute("src");
  selectedName.textContent = "";
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = "";
  status.textContent = "Choose another photo or select a product image below.";
});

function getTarget() {
  const target = new URL(targetInput.value);
  if (!/^https?:$/.test(target.protocol)) throw new Error("Enter a valid http or https try-on page.");
  const prep = prepInput.value.trim();
  if (prep) {
    const prepUrlParsed = new URL(prep);
    if (!/^https?:$/.test(prepUrlParsed.protocol)) throw new Error("Enter a valid http or https preparation URL.");
    target.searchParams.set("prep", prepUrlParsed.href);
  }
  if (prepTokenInput.value.trim()) {
    target.hash = new URLSearchParams({ prepToken: prepTokenInput.value.trim() }).toString();
  }
  return target;
}

function readDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Could not read the image."));
    reader.readAsDataURL(blob);
  });
}

async function sendLocalFile(file) {
  if (!file.type.startsWith("image/")) {
    status.textContent = "Choose an image file.";
    return;
  }
  if (file.size > 8 * 1024 * 1024) {
    status.textContent = "This image is over 8 MB. Choose a smaller photo.";
    return;
  }
  try {
    const target = getTarget();
    const granted = await chrome.permissions.contains({ origins: [`${target.origin}/*`] });
    if (!granted) {
      status.textContent = "Click Save and allow access to the try-on page, then choose your photo again.";
      return;
    }
    status.textContent = "Opening Fynd Studio with your photo…";
    const dataUrl = await readDataUrl(file);
    await openWithImage(target, dataUrl);
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : "Could not send this photo.";
  }
}

async function loadImages() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url || /^(chrome|edge|about):/.test(tab.url)) {
    status.textContent = "Open a product page in this tab first.";
    return;
  }
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => Array.from(document.images)
        .filter((img) => img.naturalWidth >= 180 && img.naturalHeight >= 180 && img.currentSrc.startsWith("http"))
        .map((img) => ({ src: img.currentSrc, alt: img.alt || "Product image", width: img.naturalWidth, height: img.naturalHeight }))
        .filter((image, index, all) => all.findIndex((candidate) => candidate.src === image.src) === index)
        .slice(0, 40),
    });
    const images = results[0]?.result || [];
    if (!images.length) {
      status.textContent = "No product images found. Scroll the product page, then reopen this extension.";
      return;
    }
    status.textContent = `${images.length} image${images.length === 1 ? "" : "s"} found. Select one to continue.`;
    for (const image of images) {
      const button = document.createElement("button");
      button.className = "image-choice";
      button.type = "button";
      const thumb = document.createElement("img");
      thumb.src = image.src;
      thumb.alt = "";
      const label = document.createElement("span");
      label.className = "alt";
      label.textContent = `${image.alt} (${image.width} × ${image.height})`;
      const action = document.createElement("span");
      action.textContent = "Try on";
      button.append(thumb, label, action);
      button.addEventListener("click", () => void sendImage(image.src));
      imageList.append(button);
    }
  } catch {
    status.textContent = "Chrome could not read this page. Try a regular product page.";
  }
}

async function sendImage(src) {
  let target;
  let image;
  try {
    target = getTarget();
    image = new URL(src);
    if (!/^https?:$/.test(target.protocol) || !/^https?:$/.test(image.protocol)) throw new Error();
  } catch {
    status.textContent = "Check the try-on page URL and select a web image.";
    return;
  }

  status.textContent = "Chrome will ask to allow access to the selected image and try-on page.";
  const origins = [`${image.origin}/*`, `${target.origin}/*`];
  const granted = await chrome.permissions.request({ origins });
  if (!granted) {
    status.textContent = "Access was not granted. The image was not sent.";
    return;
  }

  status.textContent = "Loading the selected image…";
  try {
    const response = await fetch(src, { credentials: "omit", redirect: "follow" });
    if (!response.ok || !response.headers.get("content-type")?.startsWith("image/")) throw new Error("This address did not return an image.");
    const blob = await response.blob();
    if (blob.size > 8 * 1024 * 1024) throw new Error("This image is over 8 MB. Choose a smaller product image.");
    const dataUrl = await readDataUrl(blob);
    await openWithImage(target, dataUrl);
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : "Could not send this image.";
  }
}

async function openWithImage(target, dataUrl) {
  status.textContent = "Opening Fynd Studio…";
  const result = await chrome.runtime.sendMessage({ type: "OPEN_WITH_IMAGE", targetUrl: target.href, dataUrl });
  if (!result?.ok) throw new Error(result?.error || "Could not open the try-on page.");
  status.textContent = "Image sent. Confirm the crop in Fynd Studio.";
  window.setTimeout(() => window.close(), 400);
}

void loadImages();
