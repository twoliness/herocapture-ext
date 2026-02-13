/**
 * HeroCapture Side Panel — Main App
 * Vanilla JS side panel with auth, capture, and explanation display.
 */

import { sendMagicLink, checkAuthStatus, getUser, signOut, onSessionChange } from "../lib/auth.js";
import { captureHero, fetchPublicHeroCards } from "../lib/api.js";

// --- Intent labels ---
const INTENT_LABELS = {
  sales_led: "Sales-Led",
  demo_first: "Demo-First",
  waitlist: "Waitlist",
  auth_first: "Auth-First",
  auth_wall: "Auth Wall",
  promotion_led: "Promotion-Led",
  pricing_led: "Pricing-Led",
  value_prop_led: "Value Prop-Led",
  product_led: "Product-Led",
  social_proof_led: "Social Proof-Led",
  narrative_led: "Narrative-Led",
  showcase_led: "Showcase-Led",
  brand_led: "Brand-Led",
  category_led: "Category-Led",
  discovery_led: "Discovery-Led",
  trust_led: "Trust-Led",
  feature_led: "Feature-Led",
  error_page: "Error Page",
};

const INTENT_DESCRIPTIONS = {
  error_page: "The hero is an error or blocked page, not a normal marketing hero.",
  sales_led: "Primary conversion routes through sales (Talk to Sales, Contact Sales, Book a Demo).",
  demo_first: "Primary call-to-action is to see, book, or watch a demo.",
  waitlist: "Pre-launch or invite-only; collecting signups for future access.",
  auth_first: "Hero leads with login or signup as the main action, minimal marketing copy.",
  auth_wall: "Content is gated behind authentication before anything else.",
  pricing_led: "Pricing information is prominently displayed in the hero.",
  promotion_led: "Dominated by time-bound promotions, discounts, or urgency.",
  value_prop_led: "Headline clearly communicates unique value or benefit.",
  product_led: "Hero showcases product UI with a self-serve CTA.",
  social_proof_led: "Leads with trust signals like logos, testimonials, or metrics.",
  feature_led: "Leads with feature explanations or specific capability highlights.",
  narrative_led: "Storytelling or mission-led copy before product explanation; little/no CTA.",
  category_led: "Organized around categories or department browsing.",
  discovery_led: "Emphasizes new arrivals, trending items, or editorial picks.",
  brand_led: "Full-bleed brand campaign or lifestyle takeover.",
  trust_led: "Prioritizes reassurance like guarantees, security badges, or reviews.",
  showcase_led: "The product capability is the hero (interactive demo, playground, WebGL).",
};

const EXECUTION_DESCRIPTIONS = {
  "Feature list": "Persuades via feature bullets or lists.",
  "Funnel-entry driven": "Persuades via a single neutral entry action that reduces cognitive load.",
  "Interactive demo": "Persuades via an interactive playground or demo.",
  "Product UI preview": "Persuades via UI or product preview.",
  "Proof bar": "Persuades via logos, testimonials, or metrics.",
  "Brand-exploration first": "Hero persuades by prioritizing a distinctive brand visual or symbol over explanatory copy.",
  "Exploration-first CTA": "Hero persuades by inviting exploration (e.g. watch video, learn more, early access) rather than immediate conversion.",
  "Execution: Brand-led visual": "Hero persuades by prioritizing a distinctive brand visual or symbol over explanatory copy.",
  "Execution: Exploration-first CTA": "Hero persuades by inviting exploration (e.g. watch video, learn more, early access) rather than immediate conversion.",
};

const formatStackTag = (tag) => {
  if (!tag) return "";
  return String(tag)
    .replace(/[_-]+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((word) => {
      const lower = word.toLowerCase();
      if (["ui", "ux", "css", "js", "ts", "api", "aws", "gcp"].includes(lower)) {
        return lower.toUpperCase();
      }
      if (lower === "nextjs") return "Nextjs";
      if (lower === "nodejs") return "Node.js";
      return lower[0].toUpperCase() + lower.slice(1);
    })
    .join(" ");
};

// --- Tag styling ---

const TAG_GROUP_MAP = {
  auth_first: "lifecycle", demo_first: "lifecycle", pricing: "lifecycle",
  sales_led: "lifecycle", waitlist: "lifecycle",
  dashboard_preview: "interaction", feature_bullets: "interaction",
  social_proof: "interaction", value_prop_led: "interaction",
  dark_theme_hero: "layout", gallery_layout: "layout", grid_cards: "layout",
  left_copy_right_media: "layout", split_layout: "layout",
  nextjs: "stack", webflow: "stack", tailwind: "stack", bootstrap: "stack",
  cloudflare: "stack", vercel: "stack", wordpress: "stack", shopify: "stack",
  squarespace: "stack", wix: "stack", gatsby: "stack", nuxt: "stack",
  svelte: "stack", angular: "stack", vue: "stack", react: "stack",
  laravel: "stack", django: "stack", rails: "stack", framer: "stack",
  hubspot: "stack", ghost: "stack", contentful: "stack", strapi: "stack",
  sanity: "stack",
};

const TAG_GROUP_COLORS = {
  lifecycle:   { bg: "#fff1e2", text: "#8a4b16" },
  interaction: { bg: "#eef1ff", text: "#3640a1" },
  layout:      { bg: "#e9f5f2", text: "#1f6d5a" },
  stack:       { bg: "#f7eefc", text: "#6c2f8f" },
  display:     { bg: "#eef6ff", text: "#1d5c99" },
};

const DEFAULT_TAG_COLORS = { bg: "#f3f4f6", text: "#374151" };

function getTagColors(tagKey) {
  const group = TAG_GROUP_MAP[tagKey];
  return group ? TAG_GROUP_COLORS[group] : DEFAULT_TAG_COLORS;
}

function formatTagLabel(tag) {
  if (!tag) return "";
  // Intent labels
  if (INTENT_LABELS[tag]) return INTENT_LABELS[tag];
  // Stack tags
  return formatStackTag(tag);
}

function tooltipLabel(label, description, labelClassName = "") {
  const wrapper = h("span", { className: "tooltip" });
  const text = h("span", { className: `tooltip-text ${labelClassName}` }, label);
  wrapper.appendChild(text);
  if (description) {
    wrapper.appendChild(h("span", { className: "tooltip-bubble" }, description));
  }
  return wrapper;
}

// --- State ---
let state = {
  screen: "loading", // loading | auth | auth-waiting | capture | capturing | breakdown | error
  user: null,
  email: "",
  sessionId: null,
  pollTimer: null,
  activeTab: null,
  captureResult: null,
  error: null,
  captureStep: 0,
  copyState: "idle",
  copyMenuOpen: false,
  heroCheck: null,
  latestCaptures: null,
  latestCapturesLoading: false,
};


// --- DOM helpers ---

const $ = (sel) => document.querySelector(sel);
const app = () => $("#app");

function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === "className") el.className = value;
    else if (key.startsWith("on")) el.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === "style" && typeof value === "object") Object.assign(el.style, value);
    else if (typeof value === "boolean") {
      if (value) el.setAttribute(key, "");
    }
    else el.setAttribute(key, value);
  }
  for (const child of children) {
    if (typeof child === "string") el.appendChild(document.createTextNode(child));
    else if (child) el.appendChild(child);
  }
  return el;
}

// --- SVG Icons ---

function captureIcon(size = 20) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");

  const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  circle.setAttribute("cx", "12");
  circle.setAttribute("cy", "12");
  circle.setAttribute("r", "10");
  svg.appendChild(circle);

  const lines = [
    { x1: "22", y1: "12", x2: "18", y2: "12" },
    { x1: "6", y1: "12", x2: "2", y2: "12" },
    { x1: "12", y1: "6", x2: "12", y2: "2" },
    { x1: "12", y1: "22", x2: "12", y2: "18" },
  ];
  for (const l of lines) {
    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    for (const [k, v] of Object.entries(l)) line.setAttribute(k, v);
    svg.appendChild(line);
  }

  return svg;
}

function logOutIcon(size = 18) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");

  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", "M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4");
  svg.appendChild(path);

  const polyline = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
  polyline.setAttribute("points", "16 17 21 12 16 7");
  svg.appendChild(polyline);

  const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
  line.setAttribute("x1", "21");
  line.setAttribute("y1", "12");
  line.setAttribute("x2", "9");
  line.setAttribute("y2", "12");
  svg.appendChild(line);

  return svg;
}

function spinnerIcon(size = 16) {
  const el = h("div", { className: "spinner" });
  el.style.width = size + "px";
  el.style.height = size + "px";
  return el;
}

// --- Render ---

function render() {
  const container = app();
  container.innerHTML = "";

  switch (state.screen) {
    case "loading":
      container.appendChild(renderLoading());
      break;
    case "auth":
      container.appendChild(renderAuth());
      break;
    case "auth-waiting":
      container.appendChild(renderAuthWaiting());
      break;
    case "capture":
      container.appendChild(renderMainView());
      break;
    case "capturing":
      container.appendChild(renderMainView());
      break;
    case "breakdown":
      container.appendChild(renderBreakdownView());
      break;
    case "error":
      container.appendChild(renderMainView());
      break;
  }
}

function renderLoading() {
  return h("div", { className: "auth-screen" },
    h("div", { className: "spinner" })
  );
}

// --- Auth Screen ---

function renderAuth() {
  const form = h("div", { className: "auth-form" },
    h("div", { className: "input-group" },
      h("input", {
        type: "email",
        placeholder: "Enter your email",
        id: "email-input",
        value: state.email,
      })
    ),
    h("button", {
      className: "btn-primary",
      id: "send-link-btn",
      onClick: handleSendMagicLink,
    }, "Send magic link")
  );

  if (state.error) {
    form.appendChild(h("div", { className: "auth-error" }, state.error));
  }

  return h("div", { className: "auth-screen" },
    h("h1", {}, "HeroCapture"),
    h("p", {}, "Sign in to capture hero sections"),
    form
  );
}

function renderAuthWaiting() {
  const form = h("div", { className: "auth-form" },
    h("div", { className: "auth-waiting-spinner" },
      h("div", { className: "spinner" })
    ),
    h("button", {
      className: "auth-back",
      onClick: () => {
        stopPolling();
        state.screen = "auth";
        state.error = null;
        render();
      },
    }, "Use a different email")
  );

  if (state.error) {
    form.appendChild(h("div", { className: "auth-error" }, state.error));
  }

  return h("div", { className: "auth-screen" },
    h("h1", {}, "Check your email"),
    h("p", {}, `We sent a sign-in link to ${state.email}`),
    h("p", { className: "auth-hint" }, "Click the link in your email to continue"),
    form
  );
}

// --- Main View (capture + latest captures feed) ---

function renderMainView() {
  const wrapper = h("div", { className: "main-view" });

  // Scrollable content area
  const content = h("div", { className: "main-content" });

  // Header with sign out
  content.appendChild(renderTopBar());

  // Error message (inline, not a separate screen)
  if (state.screen === "error" && state.error) {
    content.appendChild(
      h("div", { className: "error-box" },
        h("div", {}, state.error || "Something went wrong."),
        h("button", { onClick: handleRetry }, "Try again")
      )
    );
  }

  // Capturing status (inline)
  if (state.screen === "capturing") {
    content.appendChild(renderCapturingInline());
  }

  // Latest captures feed
  content.appendChild(renderLatestCaptures());

  wrapper.appendChild(content);

  // Bottom sticky capture bar
  wrapper.appendChild(renderCaptureBar());

  return wrapper;
}

function renderTopBar() {
  const signOutBtn = h("button", {
    className: "topbar-signout",
    onClick: handleSignOut,
    title: "Sign out",
  });
  signOutBtn.appendChild(logOutIcon(16));

  return h("div", { className: "topbar" },
    h("div", { className: "topbar-title" }, "Latest captures"),
    signOutBtn
  );
}

function renderCaptureBar() {
  const bar = h("div", { className: "capture-bar" });

  // Tab card + capture button row
  const row = h("div", { className: "capture-bar-row" });

  if (state.activeTab) {
    let displayUrl = "";
    try {
      const u = new URL(state.activeTab.url);
      displayUrl = u.hostname.replace(/^www\./, "") + (u.pathname === "/" ? "" : u.pathname);
    } catch {}

    const tabCard = h("div", { className: "tab-card" },
      h("div", { className: "tab-card-url" }, displayUrl)
    );
    row.appendChild(tabCard);
  } else {
    row.appendChild(
      h("div", { className: "tab-card tab-card--empty" },
        h("div", { className: "tab-card-url" }, "No tab detected")
      )
    );
  }

  // Capture icon button
  const isCapturing = state.screen === "capturing";
  const captureBtn = h("button", {
    className: "btn-capture-icon" + (isCapturing ? " capturing" : ""),
    onClick: handleCapture,
    disabled: !state.activeTab || isCapturing,
    title: "Capture this page",
  });
  if (isCapturing) {
    captureBtn.appendChild(spinnerIcon(18));
  } else {
    captureBtn.appendChild(captureIcon(20));
  }
  row.appendChild(captureBtn);

  bar.appendChild(row);

  // Hero detection message
  if (state.heroCheck && !state.heroCheck.detected) {
    bar.appendChild(
      h("div", { className: "capture-bar-message not-found" },
        "No hero section detected"
      )
    );
  }

  return bar;
}

function renderCapturingInline() {
  const title = "Analyzing the hero";
  const subtitle = "You can come back later — we’ll notify you when it’s ready.";

  return h("div", { className: "capturing-inline" },
    h("div", { className: "capturing-inline-row" },
      h("span", { className: "capture-title-text" }, title),
      h("span", { className: "capture-dots", "aria-hidden": "true" },
        h("span", {}),
        h("span", {}),
        h("span", {})
      )
    ),
    subtitle ? h("div", { className: "capturing-inline-subtitle" }, subtitle) : null
  );
}

// --- Latest Captures Feed (public hero cards) ---

function renderLatestCaptures() {
  const section = h("div", { className: "latest-captures" });

  if (state.latestCapturesLoading && !state.latestCaptures) {
    section.appendChild(
      h("div", { className: "latest-captures-loading" },
        h("div", { className: "spinner" })
      )
    );
    return section;
  }

  if (!state.latestCaptures || state.latestCaptures.length === 0) {
    section.appendChild(
      h("div", { className: "latest-captures-empty" }, "No captures yet")
    );
    return section;
  }

  const grid = h("div", { className: "latest-captures-grid" });
  for (const card of state.latestCaptures) {
    grid.appendChild(renderHeroCard(card));
  }
  section.appendChild(grid);

  return section;
}

function renderHeroCard(card) {
  const item = h("div", {
    className: "hero-card",
    onClick: () => {
      // Map public hero card data to breakdown format
      state.captureResult = {
        ...card,
        domain: card.domain || extractDomain(card.url),
        fingerprint: card.fingerprint || {},
      };
      state.screen = "breakdown";
      render();
    },
  });

  // Screenshot
  if (card.screenshot_url) {
    item.appendChild(
      h("div", { className: "hero-card-img" },
        h("img", { src: card.screenshot_url, alt: card.domain || "" })
      )
    );
  } else {
    item.appendChild(
      h("div", { className: "hero-card-img hero-card-placeholder" },
        h("span", {}, card.domain || extractDomain(card.url) || "?")
      )
    );
  }

  // Domain
  const domain = card.domain || extractDomain(card.url) || "";
  item.appendChild(h("div", { className: "hero-card-domain" }, domain.toUpperCase()));

  const allTags = (card.hero_tag_assignments || []).map((t) => t.tag_key).filter(Boolean);
  const intentTags = allTags.filter((tag) => INTENT_LABELS[tag]);
  const primaryIntent = card.primary_intent || card.primaryIntent || intentTags[0] || null;
  const secondaryIntent = card.secondary_intent || card.secondaryIntent || intentTags[1] || null;

  if (primaryIntent || secondaryIntent) {
    const intents = h("div", { className: "hero-card-intents" });
    if (primaryIntent) {
      intents.appendChild(
        h("div", { className: "hero-card-intent" },
          "Primary: ",
          h("span", {}, INTENT_LABELS[primaryIntent] || primaryIntent)
        )
      );
    }
    if (secondaryIntent) {
      intents.appendChild(
        h("div", { className: "hero-card-intent" },
          "Secondary: ",
          h("span", {}, INTENT_LABELS[secondaryIntent] || secondaryIntent)
        )
      );
    }
    item.appendChild(intents);
  }

  return item;
}

function extractDomain(url) {
  if (!url) return "";
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch { return ""; }
}

async function loadLatestCaptures() {
  if (state.latestCapturesLoading) return;
  state.latestCapturesLoading = true;
  render();
  try {
    const data = await fetchPublicHeroCards();
    state.latestCaptures = data.data || [];
  } catch (err) {
    console.warn("Failed to load public hero cards:", err);
    state.latestCaptures = [];
  }
  state.latestCapturesLoading = false;
  render();
}

// --- Breakdown View ---

function renderBreakdownView() {
  const wrapper = h("div", { className: "breakdown-view" });

  // Back button
  wrapper.appendChild(
    h("button", {
      className: "btn-back-nav",
      onClick: () => { state.screen = "capture"; render(); },
    },
      h("span", { className: "back-arrow" }, "\u2190"),
      h("span", {}, "Back")
    )
  );

  // Breakdown card
  wrapper.appendChild(renderBreakdownCard());

  return wrapper;
}

// --- Breakdown Card ---

function renderBreakdownCard() {
  const card = state.captureResult;
  if (!card) return h("div", {}, "No result");

  const explanation = card.hero_explanation;
  const intentLabel = INTENT_LABELS[card.primary_intent] || card.primary_intent || "Unknown";
  const secondaryIntent =
    card.secondary_intent ||
    card.secondaryIntent ||
    explanation?.secondary_intent ||
    explanation?.secondaryIntent ||
    null;
  const detectedStack = Array.isArray(card.fingerprint?.detected_stack)
    ? card.fingerprint.detected_stack.filter(Boolean)
    : [];

  const el = h("div", { className: "explanation-card" });

  // Screenshot
  if (card.screenshot_url) {
    const screenshotEl = h("div", { className: "card-screenshot" },
      h("img", { src: card.screenshot_url, alt: card.domain }),
      h("div", { className: "citation-bar" }, "herocapture.com")
    );
    el.appendChild(screenshotEl);
  }

  const stackDisplay = detectedStack.length
    ? detectedStack.slice(0, 2).map(formatStackTag).join(", ")
    : "\u2014";

  const meta = h("div", { className: "card-meta" },
    h("div", { className: "card-meta-text" },
      "Detected tech stack: ",
      h("strong", {}, stackDisplay)
    ),
    renderCopyDropdown(card)
  );
  el.appendChild(meta);

  const body = h("div", { className: "card-body" });

  // Domain
  body.appendChild(h("div", { className: "card-domain" }, card.domain));

  // Headline
  const fp = card.fingerprint || {};
  if (fp.headline) {
    body.appendChild(h("div", { className: "card-headline" }, fp.headline));
  }
  if (fp.subheadline) {
    body.appendChild(h("div", { className: "card-subheadline" }, fp.subheadline));
  }

  // Intent
  body.appendChild(
    h("div", { className: "card-section" },
      h("div", { className: "card-section-label" }, "HERO INTENT"),
      h(
        "div",
        { className: "card-intent" },
        tooltipLabel(
          intentLabel,
          INTENT_DESCRIPTIONS[card.primary_intent] || "",
          "card-intent-label"
        )
      ),
      secondaryIntent
        ? h(
          "div",
          { className: "card-intent-secondary" },
          "Secondary: ",
          tooltipLabel(
            INTENT_LABELS[secondaryIntent] || secondaryIntent,
            INTENT_DESCRIPTIONS[secondaryIntent] || "",
            "card-intent-secondary-label"
          )
        )
        : null
    )
  );

  // Why bullets
  if (explanation?.why?.length > 0) {
    const list = h("ul", { className: "card-why-list" });
    for (const bullet of explanation.why) {
      list.appendChild(h("li", {}, bullet));
    }
    body.appendChild(
      h("div", { className: "card-section" },
        h("div", { className: "card-section-label" }, "WHY"),
        list
      )
    );
  }

  // Execution methods
  if (explanation?.execution_methods?.length > 0) {
    const tags = h("div", { className: "card-executions" });
    for (const method of explanation.execution_methods) {
      tags.appendChild(
        tooltipLabel(
          method,
          EXECUTION_DESCRIPTIONS[method] || "",
          "execution-tag"
        )
      );
    }
    body.appendChild(
      h("div", { className: "card-section" },
        h("div", { className: "card-section-label" }, "EXECUTION"),
        tags
      )
    );
  }

  // Tradeoff
  if (explanation?.tradeoff) {
    body.appendChild(
      h("div", { className: "card-section" },
        h("div", { className: "card-section-label" }, "TRADEOFF"),
        h("div", { className: "card-tradeoff" }, explanation.tradeoff)
      )
    );
  }

  el.appendChild(body);

  return el;
}

function renderCopyDropdown(card) {
  const wrapper = h("div", { className: "copy-wrapper" });
  const buttonWrap = h("div", { className: "copy-button" });

  const btnText = state.copyState === "copied" ? "Copied" : "Copy breakdown";
  const btnClass = "btn-copy" + (state.copyState === "copied" ? " copied" : "");

  const btn = h("button", { className: btnClass, onClick: toggleCopyMenu }, btnText);
  buttonWrap.appendChild(btn);

  if (state.copyMenuOpen) {
    const menu = h("div", { className: "copy-menu" },
      h("button", { onClick: () => handleCopyText(card) }, "\uD83D\uDCCB Text only"),
      card.screenshot_url
        ? h("button", { onClick: () => handleCopyWithImage(card) }, "\uD83D\uDDBC Text + image")
        : null
    );
    buttonWrap.appendChild(menu);
  }

  wrapper.appendChild(buttonWrap);
  wrapper.appendChild(
    h("div", { className: "copy-caption" }, "Works in Figma, FigJam, Docs, Notion, Miro")
  );

  return wrapper;
}

// --- Event Handlers ---

async function handleSendMagicLink() {
  const input = $("#email-input");
  const email = input?.value?.trim();
  if (!email) return;

  const btn = $("#send-link-btn");
  btn.disabled = true;
  btn.textContent = "Sending...";
  state.error = null;

  try {
    const { session_id } = await sendMagicLink(email);
    state.email = email;
    state.sessionId = session_id;
    state.screen = "auth-waiting";
    render();
    startPolling();
  } catch (err) {
    state.error = err.message;
    render();
  }
}

function startPolling() {
  stopPolling();
  state.pollTimer = setInterval(async () => {
    if (!state.sessionId) return;
    try {
      const result = await checkAuthStatus(state.sessionId);
      if (result.status === "verified") {
        stopPolling();
        state.user = result.session.user;
        state.screen = "capture";
        await loadActiveTab();
        render();
        checkHeroPresence();
        loadLatestCaptures();
      }
    } catch (err) {
      console.warn("Polling error:", err);
    }
  }, 3000);
}

function stopPolling() {
  if (state.pollTimer) {
    clearInterval(state.pollTimer);
    state.pollTimer = null;
  }
}

async function handleSignOut() {
  stopPolling();
  await signOut();
  state = {
    ...state,
    screen: "auth",
    user: null,
    email: "",
    sessionId: null,
    activeTab: null,
    captureResult: null,
    copyState: "idle",
    copyMenuOpen: false,
    latestCaptures: null,
    latestCapturesLoading: false,
  };
  render();
}

async function handleCapture() {
  if (!state.activeTab) return;

  state.screen = "capturing";
  state.captureStep = 0;
  state.error = null;
  render();

  try {
    const extractResult = await new Promise((resolve) => {
      chrome.runtime.sendMessage(
        { type: "INJECT_AND_EXTRACT", tabId: state.activeTab.id },
        resolve
      );
    });

    if (!extractResult?.success) {
      throw new Error(extractResult?.error || "Failed to extract hero section");
    }

    state.captureStep = 1;
    render();

    state.captureStep = 2;
    render();

    const result = await captureHero(state.activeTab.url, extractResult.fingerprint);
    state.captureResult = result;
    state.screen = "breakdown";
    notifyFloatingIcon("CAPTURE_DONE");
    await loadActiveTab();
    // Refresh latest captures
    loadLatestCaptures();
    render();
  } catch (err) {
    state.error = err.message;
    state.screen = "error";
    notifyFloatingIcon("CAPTURE_ERROR");
    render();
  }
}

function handleRetry() {
  state.screen = "capture";
  state.error = null;
  state.copyState = "idle";
  state.copyMenuOpen = false;
  state.heroCheck = null;
  loadActiveTab().then(() => {
    render();
    checkHeroPresence();
  });
}

function toggleCopyMenu() {
  state.copyMenuOpen = !state.copyMenuOpen;
  render();
}

// --- Copy handlers ---

function buildPlainText(card) {
  const fp = card.fingerprint || {};
  const explanation = card.hero_explanation;
  const intentLabel = INTENT_LABELS[card.primary_intent] || card.primary_intent || "";

  let text = "";
  text += `${(card.domain || "").toUpperCase()}\n`;
  if (fp.headline) text += `${fp.headline}\n`;
  if (fp.subheadline) text += `${fp.subheadline}\n`;
  text += "\n";

  if (intentLabel) text += `HERO INTENT: ${intentLabel}\n\n`;

  if (explanation?.why?.length > 0) {
    text += "WHY\n";
    for (const bullet of explanation.why) text += `\u2022 ${bullet}\n`;
    text += "\n";
  }

  if (explanation?.execution_methods?.length > 0) {
    text += `EXECUTION: ${explanation.execution_methods.join(", ")}\n\n`;
  }

  if (explanation?.tradeoff) {
    text += `TRADEOFF: ${explanation.tradeoff}\n\n`;
  }

  text += `\u2014 herocapture.com`;
  return text;
}

async function handleCopyText(card) {
  state.copyMenuOpen = false;
  try {
    const text = buildPlainText(card);
    await navigator.clipboard.writeText(text);
    state.copyState = "copied";
    render();
    setTimeout(() => { state.copyState = "idle"; render(); }, 2000);
  } catch (err) {
    console.error("Copy failed:", err);
  }
}

async function handleCopyWithImage(card) {
  state.copyMenuOpen = false;
  try {
    const blob = await renderExplanationImage(card);
    const item = new ClipboardItem({ "image/png": blob });
    await navigator.clipboard.write([item]);
    state.copyState = "copied";
    render();
    setTimeout(() => { state.copyState = "idle"; render(); }, 2000);
  } catch (err) {
    console.error("Copy with image failed:", err);
    await handleCopyText(card);
  }
}

// --- Canvas rendering for image copy ---

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function wrapText(ctx, text, maxWidth) {
  const words = text.split(" ");
  const lines = [];
  let currentLine = "";

  for (const word of words) {
    const testLine = currentLine ? `${currentLine} ${word}` : word;
    if (ctx.measureText(testLine).width > maxWidth && currentLine) {
      lines.push(currentLine);
      currentLine = word;
    } else {
      currentLine = testLine;
    }
  }
  if (currentLine) lines.push(currentLine);
  return lines;
}

async function renderExplanationImage(card) {
  const SCALE = 2;
  const W = 380;
  const PAD = 22;
  const RADIUS = 16;
  const fp = card.fingerprint || {};
  const explanation = card.hero_explanation;
  const intentLabel = INTENT_LABELS[card.primary_intent] || card.primary_intent || "";
  const fontStack =
    "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', sans-serif";
  const COLORS = {
    text: "#111827",
    muted: "#6b7280",
    border: "#e5e7eb",
    chip: "#f3f4f6",
  };

  const setFont = (ctx, weight, size, style = "normal") => {
    ctx.font = `${style} ${weight} ${size}px ${fontStack}`.trim();
  };

  const measureCanvas = document.createElement("canvas");
  measureCanvas.width = W * SCALE;
  measureCanvas.height = 100;
  const mCtx = measureCanvas.getContext("2d");
  mCtx.scale(SCALE, SCALE);

  const MAX_W = W - PAD * 2;
  const imgH = card.screenshot_url ? Math.round(MAX_W * (800 / 1440)) : 0;

  let y = PAD;

  setFont(mCtx, 600, 10);
  y += 16;

  if (imgH) y += imgH + 14;

  if (fp.headline) {
    setFont(mCtx, 600, 16);
    const lines = wrapText(mCtx, fp.headline, MAX_W);
    y += lines.length * 20 + 2;
  }

  if (fp.subheadline) {
    setFont(mCtx, 400, 12);
    const lines = wrapText(mCtx, fp.subheadline, MAX_W);
    y += lines.length * 16 + 12;
  }

  if (intentLabel) {
    y += 16;
    setFont(mCtx, 700, 14);
    y += 18 + 12;
  }

  if (explanation?.why?.length > 0) {
    y += 16;
    setFont(mCtx, 400, 12);
    for (const bullet of explanation.why) {
      const lines = wrapText(mCtx, bullet, MAX_W - 12);
      y += lines.length * 16 + 6;
    }
    y += 6;
  }

  if (explanation?.execution_methods?.length > 0) {
    y += 16;
    setFont(mCtx, 600, 11);
    const pillHeight = 20;
    let x = PAD;
    for (const method of explanation.execution_methods) {
      const pillW = Math.ceil(mCtx.measureText(method).width) + 16;
      if (x + pillW > PAD + MAX_W) {
        y += pillHeight + 6;
        x = PAD;
      }
      x += pillW + 6;
    }
    y += pillHeight + 10;
  }

  if (explanation?.tradeoff) {
    y += 16;
    setFont(mCtx, 400, 12, "italic");
    const lines = wrapText(mCtx, explanation.tradeoff, MAX_W);
    y += lines.length * 16 + 8;
  }

  y += 18 + PAD;

  const H = y;

  const canvas = document.createElement("canvas");
  canvas.width = W * SCALE;
  canvas.height = H * SCALE;
  const ctx = canvas.getContext("2d");
  ctx.scale(SCALE, SCALE);

  ctx.save();
  ctx.shadowColor = "rgba(15, 23, 42, 0.12)";
  ctx.shadowBlur = 18;
  ctx.shadowOffsetY = 8;
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.roundRect(0, 0, W, H, RADIUS);
  ctx.fill();
  ctx.restore();

  ctx.strokeStyle = COLORS.border;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(0.5, 0.5, W - 1, H - 1, RADIUS);
  ctx.stroke();

  let curY = PAD;

  setFont(ctx, 600, 10);
  ctx.fillStyle = COLORS.muted;
  ctx.fillText((card.domain || "").toUpperCase(), PAD, curY + 10);
  curY += 16;

  if (card.screenshot_url && imgH > 0) {
    try {
      const img = await loadImage(card.screenshot_url);
      const imgW = MAX_W;
      ctx.save();
      ctx.beginPath();
      ctx.roundRect(PAD, curY, imgW, imgH, 14);
      ctx.clip();
      ctx.drawImage(img, PAD, curY, imgW, imgH);
      ctx.restore();

      ctx.strokeStyle = COLORS.border;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(PAD, curY, imgW, imgH, 14);
      ctx.stroke();

      ctx.fillStyle = "rgba(0, 0, 0, 0.6)";
      ctx.fillRect(PAD, curY + imgH - 18, imgW, 18);
      setFont(ctx, 400, 9);
      ctx.fillStyle = "rgba(255, 255, 255, 0.7)";
      ctx.textAlign = "right";
      ctx.fillText("herocapture.com", PAD + imgW - 6, curY + imgH - 5);
      ctx.textAlign = "left";
      curY += imgH + 14;
    } catch {
      // Skip if image fails to load
    }
  }

  if (fp.headline) {
    setFont(ctx, 600, 16);
    ctx.fillStyle = COLORS.text;
    const lines = wrapText(ctx, fp.headline, MAX_W);
    for (const line of lines) {
      ctx.fillText(line, PAD, curY + 16);
      curY += 20;
    }
    curY += 2;
  }

  if (fp.subheadline) {
    setFont(ctx, 400, 12);
    ctx.fillStyle = COLORS.muted;
    const lines = wrapText(ctx, fp.subheadline, MAX_W);
    for (const line of lines) {
      ctx.fillText(line, PAD, curY + 12);
      curY += 16;
    }
    curY += 12;
  }

  if (intentLabel) {
    setFont(ctx, 600, 9);
    ctx.fillStyle = COLORS.muted;
    ctx.fillText("HERO INTENT", PAD, curY + 10);
    curY += 16;

    setFont(ctx, 700, 14);
    ctx.fillStyle = COLORS.text;
    ctx.fillText(intentLabel, PAD, curY + 14);
    curY += 18 + 12;
  }

  if (explanation?.why?.length > 0) {
    setFont(ctx, 600, 9);
    ctx.fillStyle = COLORS.muted;
    ctx.fillText("WHY", PAD, curY + 10);
    curY += 16;

    setFont(ctx, 400, 12);
    ctx.fillStyle = COLORS.text;
    for (const bullet of explanation.why) {
      const lines = wrapText(ctx, bullet, MAX_W - 12);
      for (let i = 0; i < lines.length; i += 1) {
        if (i === 0) {
          ctx.beginPath();
          ctx.arc(PAD + 3, curY + 8, 2, 0, Math.PI * 2);
          ctx.fillStyle = COLORS.muted;
          ctx.fill();
          ctx.fillStyle = COLORS.text;
        }
        ctx.fillText(lines[i], PAD + 12, curY + 12);
        curY += 16;
      }
      curY += 6;
    }
    curY += 6;
  }

  if (explanation?.execution_methods?.length > 0) {
    setFont(ctx, 600, 9);
    ctx.fillStyle = COLORS.muted;
    ctx.fillText("EXECUTION", PAD, curY + 10);
    curY += 16;

    setFont(ctx, 600, 11);
    const pillHeight = 20;
    let x = PAD;
    for (const method of explanation.execution_methods) {
      const textW = Math.ceil(ctx.measureText(method).width);
      const pillW = textW + 16;
      if (x + pillW > PAD + MAX_W) {
        curY += pillHeight + 6;
        x = PAD;
      }
      ctx.fillStyle = COLORS.chip;
      ctx.strokeStyle = COLORS.border;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(x, curY, pillW, pillHeight, 999);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = COLORS.text;
      ctx.fillText(method, x + 8, curY + 13);
      x += pillW + 6;
    }
    curY += pillHeight + 10;
  }

  if (explanation?.tradeoff) {
    setFont(ctx, 600, 9);
    ctx.fillStyle = COLORS.muted;
    ctx.fillText("TRADEOFF", PAD, curY + 10);
    curY += 16;

    setFont(ctx, 400, 12, "italic");
    ctx.fillStyle = COLORS.muted;
    const lines = wrapText(ctx, explanation.tradeoff, MAX_W);
    for (const line of lines) {
      ctx.fillText(line, PAD, curY + 12);
      curY += 16;
    }
    curY += 8;
  }

  setFont(ctx, 400, 9);
  ctx.fillStyle = "#9ca3af";
  ctx.textAlign = "right";
  ctx.fillText("\u2014 herocapture.com", W - PAD, curY + 12);

  return new Promise((resolve) => {
    canvas.toBlob(resolve, "image/png");
  });
}

// --- Utility ---

function truncate(str, max) {
  if (!str) return "";
  return str.length > max ? str.slice(0, max) + "..." : str;
}

function notifyFloatingIcon(type) {
  if (state.activeTab?.id) {
    chrome.tabs.sendMessage(state.activeTab.id, { type }).catch(() => {});
  }
}

async function loadActiveTab() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: "GET_ACTIVE_TAB" }, (activeTab) => {
      if (activeTab?.id && activeTab?.url) {
        state.activeTab = {
          id: activeTab.id,
          url: activeTab.url,
          title: activeTab.title || "",
          favIconUrl: activeTab.favIconUrl || "",
        };
      } else {
        state.activeTab = null;
      }
      resolve();
    });
  });
}

function checkHeroPresence() {
  if (!state.activeTab) {
    state.heroCheck = null;
    return;
  }

  const url = state.activeTab.url || "";

  if (url.startsWith("chrome://") || url.startsWith("chrome-extension://") || url.startsWith("about:")) {
    state.heroCheck = { detected: false, reason: "Cannot scan browser pages" };
    render();
    return;
  }

  state.heroCheck = isHeroPageUrl(url)
    ? { detected: true }
    : { detected: false, reason: "Not a homepage or landing page" };
  render();
}

function isHeroPageUrl(url) {
  let parsed;
  try { parsed = new URL(url); } catch { return false; }

  const path = parsed.pathname;
  const search = parsed.search;

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

// --- Listen for capture trigger from floating icon ---

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "START_CAPTURE" && message.tabId) {
    state.activeTab = { id: message.tabId, url: message.url || "", title: message.title || "" };
    if (state.screen === "capture") {
      handleCapture();
    }
  }
});

// --- Refresh active tab when user switches tabs or navigates ---

function refreshActiveTab() {
  if (state.screen !== "capture" && state.screen !== "error") return;
  loadActiveTab().then(() => {
    state.captureResult = null;
    state.heroCheck = null;
    checkHeroPresence();
  });
}

chrome.tabs.onActivated.addListener(() => {
  refreshActiveTab();
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.url && state.activeTab?.id === tabId) {
    refreshActiveTab();
  }
});

// --- Close copy menu on outside click ---

document.addEventListener("click", (e) => {
  if (state.copyMenuOpen && !e.target.closest(".copy-wrapper")) {
    state.copyMenuOpen = false;
    render();
  }
});

// --- Session change listener ---

onSessionChange(async (session) => {
  if (session?.user) {
    state.user = session.user;
    if (state.screen === "auth" || state.screen === "auth-waiting" || state.screen === "loading") {
      stopPolling();
      state.screen = "capture";
      await loadActiveTab();
      render();
      checkHeroPresence();
      loadLatestCaptures();
    }
  } else {
    state.user = null;
    state.screen = "auth";
    render();
  }
});

// --- Init ---

async function init() {
  const user = await getUser();
  if (user) {
    state.user = user;
    state.screen = "capture";
    await loadActiveTab();
    render();
    checkHeroPresence();
    loadLatestCaptures();
  } else {
    state.screen = "auth";
    render();
  }
}

init();
