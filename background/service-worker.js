/**
 * HeroCapture Service Worker
 * Handles message routing, side panel management, and auth token management.
 */

// --- Side panel setup ---

chrome.runtime.onInstalled.addListener(() => {
  // Enable side panel to open on action click
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});

// --- Message routing ---

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "FAB_CAPTURE") {
    // Floating icon clicked — open side panel and trigger capture
    handleFabCapture(sender.tab, message);
    return false;
  }

  if (message.type === "FAB_VIEW_RESULTS") {
    // User clicked "Results ready" — just open side panel
    if (sender.tab?.id) {
      chrome.sidePanel.open({ tabId: sender.tab.id }).catch(() => {});
    }
    return false;
  }

  if (message.type === "INJECT_AND_EXTRACT") {
    // Inject content script into the target tab and extract fingerprint
    handleInjectAndExtract(message.tabId)
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true; // async response
  }

  if (message.type === "GET_ACTIVE_TAB") {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      sendResponse(tabs[0] || null);
    });
    return true;
  }

  if (message.type === "GET_ALL_TABS") {
    chrome.tabs.query({ currentWindow: true }, (tabs) => {
      const filtered = tabs
        .filter((t) => t.url && !t.url.startsWith("chrome://") && !t.url.startsWith("chrome-extension://"))
        .map((t) => ({ id: t.id, url: t.url, title: t.title, favIconUrl: t.favIconUrl }));
      sendResponse(filtered);
    });
    return true;
  }
});

// --- Floating icon capture handler ---

async function handleFabCapture(tab, message) {
  if (!tab?.id) return;

  try {
    // Open side panel for this tab
    await chrome.sidePanel.open({ tabId: tab.id });

    // Small delay to let side panel initialize
    setTimeout(() => {
      chrome.runtime.sendMessage({
        type: "START_CAPTURE",
        tabId: tab.id,
        url: message.url || tab.url,
        title: message.title || tab.title,
      });
    }, 500);
  } catch (err) {
    console.error("Failed to open side panel:", err);
    // Notify the floating icon that capture failed
    chrome.tabs.sendMessage(tab.id, { type: "CAPTURE_ERROR" }).catch(() => {});
  }
}

// --- Content script injection + fingerprint extraction ---

async function handleInjectAndExtract(tabId) {
  try {
    // Inject the content script
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content/content-script.js"],
    });

    // Wait a beat for the script to register listeners
    await new Promise((r) => setTimeout(r, 100));

    // Send message to content script to extract fingerprint
    return new Promise((resolve) => {
      chrome.tabs.sendMessage(tabId, { type: "EXTRACT_FINGERPRINT" }, (response) => {
        if (chrome.runtime.lastError) {
          resolve({
            success: false,
            error: chrome.runtime.lastError.message || "Failed to communicate with page",
          });
        } else {
          resolve(response || { success: false, error: "No response from content script" });
        }
      });
    });
  } catch (error) {
    return { success: false, error: error.message };
  }
}
