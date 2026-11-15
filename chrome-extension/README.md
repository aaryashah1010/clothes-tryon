# Fynd Studio Chrome extension (local preview)

This unpacked Manifest V3 prototype lets you upload a garment photo from your computer or choose a product image visible on the current page, then open it in the existing Fynd Studio garment upload flow. The normal crop confirmation appears before preparation. It does not contain a Modal, OpenAI, or try-on access token.

## Load it in Chrome

1. Start the local Fynd Studio page from `clothes_tryon/site` with `npm run dev` or `npm run preview`.
2. Open that page once and make sure it can reach the GPU. The extension reuses the page's saved sign-in and settings.
3. In Chrome, open `chrome://extensions`, turn on **Developer mode**, choose **Load unpacked**, and select this `chrome-extension` folder.
4. Click the extension icon, save the settings, and allow access to the try-on page when Chrome asks. Then choose **Upload a photo from this computer** and select a garment photo. Check its preview and click **Use this photo**; or open a product page and choose one of its images. Chrome asks for access to a product image host when needed.

The try-on page field defaults to `http://127.0.0.1:5173/share.html` for Vite's development server. Change and save it if your local preview uses another address. The **AI garment preparation URL** defaults to `http://127.0.0.1:8787/prepare`; start `python tools/local_prep_server.py` before using it. The local server does not require a preparation token. For a deployed preparation service, replace the URL and enter its matching access token; the token is stored in this browser's extension storage and passed in the URL fragment, which the page removes as it loads. A new unique photo sends the cropped garment to the configured preparation service, which may incur API charges. Sign in to the try-on page separately; the extension never asks for or stores its try-on token. The local page reuses its saved GPU address and sign-in when the extension opens a fresh tab.

## Current limits

- This is a local prototype, not a Chrome Web Store release.
- Local photo upload accepts image files up to 8 MB.
- The preparation token is a local prototype setting. Do not publish or share this extension with a shared backend token; a public release needs user-specific server-side session tokens.
- It lists loaded images at least 180 × 180 pixels; scroll the product page before opening the popup if its main image has not loaded.
- Some stores serve images through redirects to a separate CDN. Chrome may need to ask for access to that CDN too; if the transfer fails, try a different image or save it and use the normal upload button.
- A product-page image is fetched only after you click it and approve Chrome's host access prompt. A computer photo is read by the extension only after you choose the file. The page's existing crop confirmation and preparation behavior then apply.
- Public release still needs named store adapters, a privacy policy and disclosure, and a review of the product-image rights and service capacity.
