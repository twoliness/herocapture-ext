/**
 * HeroCapture Floating Icon
 * Injects a floating action button on pages where a hero section is detected.
 * Shows capture status with text affordances below the icon.
 */

(() => {
  // Prevent double injection
  if (document.getElementById("herocapture-fab")) return;

  // --- URL detection (mirrors isHeroPageUrl in app.js) ---

  function isHeroPageUrl(url) {
    let parsed;
    try { parsed = new URL(url); } catch { return false; }

    const path = parsed.pathname;
    const search = parsed.search;

    if (url.startsWith("chrome://") || url.startsWith("chrome-extension://") || url.startsWith("about:")) {
      return false;
    }

    if (path === "/" || path === "") {
      if (!search) return true;
      const params = parsed.searchParams;
      const functionalParams = /^(q|query|search|filter|sort|page|p|category|tag|type|tab|view|id|s)$/i;
      for (const key of params.keys()) {
        if (functionalParams.test(key)) return false;
      }
      return true;
    }

    const landingPatterns = /^\/(home|welcome|index\.html?|landing|lp|get-started|start|pricing|enterprise|about|product|platform|features|solutions|tour|overview|demo|register|signup|sign-up|login|sign-in|waitlist|invite|beta|launch|coming-soon|early-access|intro)\/?$/i;
    if (landingPatterns.test(path)) return true;

    if (/^\/[a-z]{2}(-[a-z]{2})?\/?$/i.test(path)) return true;

    const localePrefix = /^\/[a-z]{2}(-[a-z]{2})?/i;
    if (localePrefix.test(path)) {
      const stripped = path.replace(localePrefix, "");
      if (landingPatterns.test(stripped)) return true;
    }

    return false;
  }

  function getDomain() {
    try {
      return new URL(window.location.href).hostname.replace(/^www\./, "");
    } catch { return ""; }
  }

  let heroDetected = isHeroPageUrl(window.location.href);
  let fabState = heroDetected ? "ready" : "disabled"; // disabled | ready | capturing | done

  // --- Create DOM ---

  const container = document.createElement("div");
  container.id = "herocapture-fab";

  const iconBtn = document.createElement("div");
  iconBtn.className = "hc-fab-icon";
  iconBtn.innerHTML = `
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="12" cy="12" r="10"/>
      <line x1="22" y1="12" x2="18" y2="12"/>
      <line x1="6" y1="12" x2="2" y2="12"/>
      <line x1="12" y1="6" x2="12" y2="2"/>
      <line x1="12" y1="22" x2="12" y2="18"/>
    </svg>
  `;

  const label = document.createElement("div");
  label.className = "hc-fab-label";

  container.appendChild(iconBtn);
  container.appendChild(label);

  // --- Styles ---

  const style = document.createElement("style");
  style.textContent = `
    #herocapture-fab {
      position: fixed;
      bottom: 24px;
      right: 24px;
      z-index: 2147483647;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 6px;
      pointer-events: none;
      font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", sans-serif;
    }

    .hc-fab-icon {
      width: 44px;
      height: 44px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      pointer-events: auto;
      transition: transform 0.2s ease, box-shadow 0.2s ease, opacity 0.2s ease, background 0.2s ease;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.18);
      user-select: none;
      -webkit-user-select: none;
    }

    .hc-fab-icon svg {
      width: 22px;
      height: 22px;
      flex-shrink: 0;
    }

    .hc-fab-label {
      font-size: 11px;
      line-height: 1.3;
      text-align: center;
      max-width: 120px;
      pointer-events: auto;
      transition: opacity 0.2s ease;
      white-space: nowrap;
    }

    /* --- States --- */

    /* Disabled */
    #herocapture-fab[data-state="disabled"] .hc-fab-icon {
      background: #e5e7eb;
      color: #9ca3af;
      opacity: 0.5;
      cursor: default;
    }
    #herocapture-fab[data-state="disabled"] .hc-fab-label {
      display: none;
    }

    /* Ready (hero detected) */
    #herocapture-fab[data-state="ready"] .hc-fab-icon {
      background: #0f172a;
      color: #ffffff;
      opacity: 0.9;
    }
    #herocapture-fab[data-state="ready"] .hc-fab-icon:hover {
      transform: scale(1.1);
      box-shadow: 0 6px 24px rgba(0, 0, 0, 0.28);
      opacity: 1;
    }
    #herocapture-fab[data-state="ready"] .hc-fab-label {
      display: none;
    }

    /* Capturing */
    #herocapture-fab[data-state="capturing"] .hc-fab-icon {
      background: #0f172a;
      color: #ffffff;
      pointer-events: none;
      animation: hc-pulse 1.2s ease-in-out infinite;
    }
    #herocapture-fab[data-state="capturing"] .hc-fab-label {
      color: #0f172a;
      background: #ffffff;
      padding: 4px 10px;
      border-radius: 8px;
      box-shadow: 0 2px 10px rgba(0, 0, 0, 0.12);
      font-weight: 500;
    }

    /* Done */
    #herocapture-fab[data-state="done"] .hc-fab-icon {
      background: #16a34a;
      color: #ffffff;
      cursor: pointer;
    }
    #herocapture-fab[data-state="done"] .hc-fab-icon:hover {
      transform: scale(1.1);
      box-shadow: 0 6px 24px rgba(22, 163, 74, 0.35);
    }
    #herocapture-fab[data-state="done"] .hc-fab-label {
      color: #16a34a;
      background: #ffffff;
      padding: 4px 10px;
      border-radius: 8px;
      box-shadow: 0 2px 10px rgba(0, 0, 0, 0.12);
      font-weight: 600;
      cursor: pointer;
      pointer-events: auto;
    }

    @keyframes hc-pulse {
      0%, 100% { transform: scale(1); opacity: 0.9; }
      50% { transform: scale(1.08); opacity: 1; }
    }
  `;

  document.documentElement.appendChild(style);

  // --- State management ---

  function setFabState(newState, domain) {
    fabState = newState;
    container.setAttribute("data-state", newState);

    if (newState === "capturing") {
      label.textContent = `Capturing...\n${domain || getDomain()}`;
      label.style.whiteSpace = "pre-line";
    } else if (newState === "done") {
      label.textContent = `Results ready for ${domain || getDomain()}`;
      label.style.whiteSpace = "nowrap";
    } else {
      label.textContent = "";
    }
  }

  setFabState(heroDetected ? "ready" : "disabled");
  document.documentElement.appendChild(container);

  // --- Click handler ---

  iconBtn.addEventListener("click", () => {
    if (fabState === "disabled" || fabState === "capturing") return;

    if (fabState === "done") {
      // Open side panel to view results
      chrome.runtime.sendMessage({
        type: "FAB_VIEW_RESULTS",
        url: window.location.href,
        title: document.title,
      });
      return;
    }

    // Start capture
    setFabState("capturing");
    chrome.runtime.sendMessage({
      type: "FAB_CAPTURE",
      url: window.location.href,
      title: document.title,
    });
  });

  label.addEventListener("click", () => {
    if (fabState === "done") {
      chrome.runtime.sendMessage({
        type: "FAB_VIEW_RESULTS",
        url: window.location.href,
        title: document.title,
      });
    }
  });

  // --- Listen for capture status from side panel ---

  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === "CAPTURE_DONE") {
      setFabState("done");
      // Auto-revert to ready after 10 seconds
      setTimeout(() => {
        if (fabState === "done") setFabState("ready");
      }, 10000);
    }
    if (message.type === "CAPTURE_ERROR") {
      setFabState("ready");
    }
  });

  // --- Re-evaluate on SPA navigation ---

  let lastUrl = window.location.href;
  const observer = new MutationObserver(() => {
    if (window.location.href !== lastUrl) {
      lastUrl = window.location.href;
      heroDetected = isHeroPageUrl(lastUrl);
      setFabState(heroDetected ? "ready" : "disabled");
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
})();
