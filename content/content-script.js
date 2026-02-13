/**
 * HeroCapture Content Script
 * Extracts DOM fingerprint data from the current page's hero section.
 * This code runs in the context of the active tab.
 */

function extractFingerprint() {
        const viewportHeight = window.innerHeight || 900;
        const viewportWidth = window.innerWidth || 1440;

        const isVisible = (el) => {
          const style = getComputedStyle(el);
          if (style.display === "none" || style.visibility === "hidden") return false;
          if (Number(style.opacity || 1) === 0) return false;
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        };

        const isFixedOrSticky = (el) => {
          const style = getComputedStyle(el);
          return style.position === "fixed" || style.position === "sticky";
        };

        // Hero boundary: find the above-the-fold section.
        // Walk visible top-level sections (or deeper if body has ≤3 children)
        // and cap at ~1.15× viewport height to avoid spanning the entire page.
        const heroMaxBottom = viewportHeight * 1.15;

        let heroSections = Array.from(document.body?.children || []);
        // If body has very few direct children (SPA wrappers), look one level deeper
        if (heroSections.length <= 3) {
          const deeper = [];
          for (const wrapper of heroSections) {
            const r = wrapper.getBoundingClientRect();
            // If the wrapper is taller than the viewport, dig into its children
            if (r.height > viewportHeight * 1.5 && wrapper.children.length > 1) {
              deeper.push(...Array.from(wrapper.children));
            } else {
              deeper.push(wrapper);
            }
          }
          if (deeper.length > heroSections.length) heroSections = deeper;
        }

        const sections = heroSections.map((el) => {
          const r = el.getBoundingClientRect();
          return {
            el,
            top: r.top,
            height: r.height,
            bottom: r.bottom,
          };
        });

        let heroBottom = viewportHeight;
        for (const s of sections) {
          if (s.bottom <= 0) continue;
          if (s.top >= heroMaxBottom) break;
          heroBottom = Math.min(heroMaxBottom, Math.max(heroBottom, s.bottom));
        }

        const inHero = (el) => {
          const r = el.getBoundingClientRect();
          return r.bottom > 0 && r.top < heroBottom;
        };

        const inNavOrHeader = (el) => {
          // Semantic nav / footer — NOT <header> or <aside> because some sites
          // wrap the entire hero inside these (e.g. Webflow uses <aside> for
          // sticky hero sections, many sites wrap hero in <header>). We handle
          // them separately with size checks below.
          if (el.closest(
            "nav, footer, [role='navigation'], [role='menubar'], [role='menu'], [role='toolbar'], [aria-label*='nav' i], [aria-label*='menu' i], [data-testid*='nav' i], [data-testid*='header' i]"
          )) return true;
          // For <header>: only flag if the header is short (nav-height, not hero-height)
          const header = el.closest("header");
          if (header) {
            const hRect = header.getBoundingClientRect();
            if (hRect.height < 150) return true;
          }
          // For <aside>: only flag if it's narrow (sidebar-width) or short.
          // Full-width/tall <aside> elements are often used as hero wrappers
          // (e.g. Webflow's <aside class="home-hero-sticky">).
          const aside = el.closest("aside");
          if (aside) {
            const aRect = aside.getBoundingClientRect();
            if (aRect.width < viewportWidth * 0.5 || aRect.height < 150) return true;
          }
          // Class/id-based nav detection (Webflow, Framer, custom sites)
          const navClassRegex = /\b(nav|navbar|navigation|menu|topbar|top-bar|site-header|masthead|toolbar)\b/i;
          let node = el;
          while (node && node !== document.body) {
            const cls = (node.className || "").toString();
            const id = (node.id || "").toString();
            if (navClassRegex.test(cls) || navClassRegex.test(id)) {
              // Verify it looks like a nav bar: at the top and short
              const r = node.getBoundingClientRect();
              if (r.top < 120 && r.height < 150) return true;
            }
            node = node.parentElement;
          }
          return false;
        };

        // Framer sites use data-framer-name; extend inNavOrHeader to detect
        // Framer footer/nav sections that lack semantic HTML tags.
        const inFramerNavOrFooter = (el) => {
          let node = el;
          while (node && node !== document.body) {
            const framerName = (node.getAttribute("data-framer-name") || "").toLowerCase();
            if (/\b(footer|nav|navbar|navigation|menu|header)\b/.test(framerName)) {
              // For "header" Framer names, only flag as nav if it's short (nav-like)
              if (/\bheader\b/.test(framerName)) {
                const r = node.getBoundingClientRect();
                if (r.height >= 150) { node = node.parentElement; continue; }
              }
              return true;
            }
            node = node.parentElement;
          }
          return false;
        };

        // Content-based footer heuristic: detect elements whose text is
        // predominantly footer/legal content (copyright, "all rights reserved",
        // long lists of nav words). These leak through on Framer/SPA sites
        // where the footer is a plain <div> with no semantic role.
        const looksLikeFooterContent = (el) => {
          const text = (el.innerText || "").trim();
          if (!text) return false;
          // Copyright notices are a dead giveaway
          if (/©|\bcopyright\b|\ball rights reserved\b/i.test(text)) return true;
          return false;
        };

        const heroTextNodes = Array.from(
          document.querySelectorAll("h1, h2, h3, p, span, div")
        ).filter((el) =>
          inHero(el) &&
          !inNavOrHeader(el) &&
          !inFramerNavOrFooter(el) &&
          !looksLikeFooterContent(el) &&
          isVisible(el) &&
          !isFixedOrSticky(el)
        );

        const cleanText = (text) =>
          text.replace(/\s+/g, " ").replace(/[^\S\r\n]+/g, " ").trim();

        // Nav-word heuristic: text containing many navigation keywords is likely nav, not hero copy
        const NAV_WORDS = /\b(log\s?in|sign\s?in|sign\s?up|pricing|blog|resources|community|support|contact|about|products?|solutions?|enterprise|platform|documentation|docs|careers|partners?)\b/gi;
        const looksLikeNavText = (text) => {
          if (!text) return false;
          const matches = text.match(NAV_WORDS) || [];
          const words = text.split(/\s+/).filter(Boolean);
          // If ≥ 3 nav words and they make up ≥ 25% of the text, it's nav-like
          return matches.length >= 3 && matches.length / words.length >= 0.25;
        };

        // Extract only direct text from an element, stripping nested link/button/nav text
        const getDirectHeadlineText = (el) => {
          if (!el) return "";
          const clone = el.cloneNode(true);
          // Remove skip-to-content links (accessibility anchors)
          clone.querySelectorAll("a[href^='#']").forEach((a) => {
            const t = (a.innerText || "").toLowerCase();
            if (/skip\s*(to)?\s*(main|content|navigation)/i.test(t)) a.remove();
          });
          // Remove any nested nav-like elements (links in bulk, buttons, etc.)
          const links = clone.querySelectorAll("a, button, [role='button'], nav, header");
          // Only strip links if there are many (nav bars) — a single link wrapping headline text is fine
          if (links.length >= 3) {
            links.forEach((n) => n.remove());
          }
          const text = cleanText(clone.innerText || "");
          // If after stripping we still have meaningful text, use it
          if (text && text.split(/\s+/).filter(Boolean).length >= 2) return text;
          // Otherwise fall back to original (the H1 might be a single link wrapping the headline)
          return cleanText(el.innerText || "");
        };

        // Headline sanity: cap overly long text (SPA wrappers, Webflow artifacts)
        const MAX_HEADLINE_WORDS = 30;
        const truncateHeadline = (text) => {
          if (!text) return text;
          const words = text.split(/\s+/).filter(Boolean);
          if (words.length <= MAX_HEADLINE_WORDS) return text;
          const sentenceMatch = text.match(/^[^.!?]+[.!?]/);
          if (sentenceMatch && sentenceMatch[0].split(/\s+/).length <= MAX_HEADLINE_WORDS) {
            return sentenceMatch[0].trim();
          }
          return words.slice(0, 15).join(" ");
        };

        const h1 = heroTextNodes.find((el) => el.tagName === "H1");
        let headline = h1 ? getDirectHeadlineText(h1) : null;
        let headlineEl = h1 || null;
        const wordCount = (text) =>
          (text || "").split(/\s+/).filter(Boolean).length;

        // Framer / animated-word sites often split the headline across
        // multiple elements (one per word or line) inside a container.
        // If the H1 text is suspiciously short, try to grab the full
        // headline from the nearest RichTextContainer or heading wrapper.
        if (h1 && headline && headline.split(/\s+/).filter(Boolean).length <= 2) {
          // Strategy 1: Framer RichTextContainer
          const rtc = h1.closest('[data-framer-component-type="RichTextContainer"]');
          if (rtc) {
            const full = cleanText(rtc.innerText || "");
            if (full.length > headline.length && full.split(/\s+/).filter(Boolean).length <= MAX_HEADLINE_WORDS) {
              headline = full;
            }
          }
          // Strategy 2: Walk up to the nearest wrapper that has more
          // heading-level text (covers Webflow/generic animated headings)
          if (headline.split(/\s+/).filter(Boolean).length <= 2) {
            let wrapper = h1.parentElement;
            while (wrapper && wrapper !== document.body) {
              const wText = cleanText(wrapper.innerText || "");
              const wWords = wText.split(/\s+/).filter(Boolean).length;
              // Stop expanding if we've hit nav-like text or too much content
              if (looksLikeNavText(wText) || wWords > MAX_HEADLINE_WORDS) break;
              if (wWords > headline.split(/\s+/).filter(Boolean).length && wWords <= MAX_HEADLINE_WORDS) {
                headline = wText;
              }
              // Don't go higher than a section-level container
              const tag = wrapper.tagName;
              if (tag === "SECTION" || tag === "HEADER" || tag === "MAIN" || tag === "ARTICLE") break;
              wrapper = wrapper.parentElement;
            }
          }
        }

        // Discard if the h1 captured the entire page (Webflow/SPA issue)
        if (headline && headline.split(/\s+/).filter(Boolean).length > MAX_HEADLINE_WORDS) {
          headline = null;
          headlineEl = null;
        }
        // Discard if the headline is just nav text
        if (headline && looksLikeNavText(headline)) {
          headline = null;
          headlineEl = null;
        }

        const candidates = heroTextNodes
          .map((el) => ({
            el,
            text: cleanText(el.innerText || ""),
            directText: getDirectHeadlineText(el),
            size: parseFloat(getComputedStyle(el).fontSize || "0") || 0,
            top: el.getBoundingClientRect().top,
          }))
          // Exclude pure numbers/metrics (e.g. "412", "$2.2B") and very short strings
          .filter((c) => c.text.length > 3 && /[a-zA-Z]{2,}/.test(c.text))
          // Exclude nav-like text
          .filter((c) => !looksLikeNavText(c.text))
          // Cap overly long candidates
          .filter((c) => c.text.split(/\s+/).filter(Boolean).length <= MAX_HEADLINE_WORDS)
          .sort((a, b) => b.size - a.size);
        const best = candidates[0];
        let largestText = null;
        if (best) {
          const direct = best.directText;
          largestText = (direct && !looksLikeNavText(direct) && direct.split(/\s+/).length >= 2)
            ? direct
            : best.text;
        }
        if (largestText) largestText = truncateHeadline(largestText);

        const h1Rect = h1 ? h1.getBoundingClientRect() : null;
        const h1FontSize = h1 ? parseFloat(getComputedStyle(h1).fontSize || "0") || 0 : 0;
        const h1IsLink = h1 ? !!h1.closest("a") || !!h1.querySelector("a") : false;
        const h1LooksSticky = h1 ? isFixedOrSticky(h1) || isFixedOrSticky(h1.parentElement) : false;
        const h1LikelyNav =
          !!h1 &&
          (inNavOrHeader(h1) ||
            inFramerNavOrFooter(h1) ||
            h1LooksSticky ||
            (h1Rect && h1Rect.top < 90 && h1Rect.height < 90 && h1Rect.width < viewportWidth * 0.5));
        const headlineLooksLikeLogo = Boolean(
          h1 &&
          headline &&
          wordCount(headline) <= 3 &&
          h1Rect &&
          h1Rect.top < 120 &&
          h1Rect.height < 90 &&
          h1FontSize <= 28 &&
          (h1IsLink || h1Rect.width < viewportWidth * 0.35)
        );
        const candidateBeatsH1 = Boolean(
          best &&
          largestText &&
          (!h1Rect || best.top >= h1Rect.bottom + 20) &&
          (h1FontSize === 0 || best.size >= h1FontSize + 4)
        );
        const candidateClearlyBetter = Boolean(
          best &&
          largestText &&
          h1Rect &&
          best.top >= h1Rect.bottom + 24 &&
          best.size >= h1FontSize + 8
        );

        if ((headlineLooksLikeLogo && candidateBeatsH1) || (h1LikelyNav && candidateBeatsH1) || candidateClearlyBetter) {
          headline = largestText;
          headlineEl = best.el;
        }

        if (!headline && largestText) {
          headline = largestText;
          headlineEl = best ? best.el : null;
        }

        const headlineRect = headlineEl ? headlineEl.getBoundingClientRect() : null;
        const contentTop = headlineRect ? headlineRect.top - 20 : 0;

        let subheadline = null;

        // Build hero text from leaf-level elements only (avoid double-counting from wrapper divs)
        const heroTextLeaves = heroTextNodes.filter((el) => {
          const r = el.getBoundingClientRect();
          if (r.top < contentTop) return false;
          // Skip container divs that have child heading/paragraph elements already in the list
          if (el.tagName === "DIV" || el.tagName === "SPAN") {
            if (el.querySelector("h1, h2, h3, p")) return false;
          }
          return true;
        });
        const heroText = cleanText(
          heroTextLeaves
            .map((el) => el.innerText || "")
            .join(" ")
        )
          // Strip any leading "skip to" accessibility text
          .replace(/^skip\s*(to)?\s*(main\s*)?(content|navigation)\s*/i, "");

        const ctaCandidates = Array.from(
          document.querySelectorAll("button, a, [role='button'], input[type='submit']")
        )
          .filter((el) => inHero(el) && !inNavOrHeader(el) && !inFramerNavOrFooter(el) && isVisible(el))
          .map((el) => {
            const r = el.getBoundingClientRect();
            return {
              text: cleanText(el.innerText || el.value || ""),
              top: r.top,
              left: r.left,
              area: r.width * r.height,
              isButton: el.tagName === "BUTTON" || el.tagName === "INPUT" || (el.getAttribute("role") === "button"),
            };
          })
          .filter((c) => c.text);

        const legalLinkRegex = /(user agreement|privacy policy|cookie policy|terms|legal)/i;
        // Exclude common footer, social media, and single-word nav links
        const footerNavRegex = /^(instagram|twitter|facebook|linkedin|youtube|tiktok|discord|reddit|github|medium|x|blog|about|careers|contact|support|help|terms|privacy|cookie|home|back to top|manifesto|research|the boring|the good|the cool|play by the rules|rules)$/i;
        // Utility/secondary auth links that should never be primary CTA
        const utilityLinkRegex = /^(forgot(ten)?\s*(your\s*)?(password|email|username)|reset\s*(your\s*)?(password|email)|can'?t\s*(log|sign)\s*in|need\s*help|trouble\s*(logging|signing)\s*in)/i;
        const filteredCtas = ctaCandidates.filter(
          (c) => {
            if (legalLinkRegex.test(c.text)) return false;
            if (footerNavRegex.test(c.text.trim())) return false;
            if (utilityLinkRegex.test(c.text.trim())) return false;
            // Single-word items under 12 chars that aren't common CTA words
            const words = c.text.trim().split(/\s+/).filter(Boolean);
            if (words.length === 1 && c.text.trim().length < 12 && !/^(start|try|buy|join|get|apply|subscribe|download|install|register|explore|discover|watch|book|schedule|request|submit|enter|launch|upgrade|claim|demo|contact)/i.test(c.text.trim())) return false;
            return true;
          }
        );

        const heroCtaCandidates = filteredCtas.filter((c) => {
          if (c.top < 120) return false;
          if (!headlineRect) return true;
          // Exclude CTAs in the bottom 20% of viewport that are far from headline
          if (c.top > viewportHeight * 0.8 && c.top > (headlineRect.bottom || 0) + 420) return false;
          return c.top >= headlineRect.top - 40 && c.top <= headlineRect.bottom + 420;
        });

        // Sort CTAs: prefer buttons near/below the headline, deprioritize OAuth buttons
        const oauthCtaRegex = /(sign\s*(in|up)\s*with|continue\s*with|log\s*in\s*with)\s*(google|apple|github|microsoft)/i;
        // Primary action words that indicate a real CTA (not a utility link)
        const primaryCtaRegex = /^(log\s*in|sign\s*(in|up)|create|register|get\s*started|start|try|buy|join|subscribe|download|explore|book|launch|submit|talk\s*to|contact|request|schedule|demo|watch|deploy|install|begin)/i;
        const ctaPriority = (text) => {
          const t = text.trim().toLowerCase();
          if (!t) return 0;
          // Self-serve / product-first actions
          if (/^(deploy|start|try|get\s*started|sign\s*up|create|register|join|launch|download|install|begin|buy|subscribe)/i.test(t)) {
            return 3;
          }
          // Sales-led actions
          if (/^(book|schedule|request|contact|talk\s*to|demo|get\s*demo|book\s*demo|request\s*demo)/i.test(t)) {
            return 2;
          }
          // Informational/secondary actions
          if (/^(learn\s*more|explore|watch|see\s*more|view\s*details)/i.test(t)) {
            return 1;
          }
          return primaryCtaRegex.test(t) ? 1 : 0;
        };
        heroCtaCandidates.sort((a, b) => {
          // Deprioritize OAuth-style CTAs (they're auth shortcuts, not primary actions)
          const aIsOAuth = oauthCtaRegex.test(a.text);
          const bIsOAuth = oauthCtaRegex.test(b.text);
          if (aIsOAuth !== bIsOAuth) return aIsOAuth ? 1 : -1;
          // Prefer actual buttons over links (buttons are more likely primary CTAs)
          if (a.isButton !== b.isButton) return a.isButton ? -1 : 1;
          // Prefer higher-priority CTA verbs (self-serve > sales-led > info)
          const aPriority = ctaPriority(a.text);
          const bPriority = ctaPriority(b.text);
          if (aPriority !== bPriority) return bPriority - aPriority;
          // Prefer CTAs closest to headline bottom (where main CTAs typically sit)
          if (headlineRect) {
            const idealTop = headlineRect.bottom + 20;
            const aDist = Math.abs(a.top - idealTop);
            const bDist = Math.abs(b.top - idealTop);
            if (Math.abs(aDist - bDist) > 30) return aDist - bDist;
          }
          // Tie-break: larger area first, then left-to-right
          if (a.area !== b.area) return b.area - a.area;
          return a.left - b.left;
        });

        const ctas = heroCtaCandidates.map((c) => c.text);
        const ctaDetails = heroCtaCandidates.map((c) => ({
          text: c.text,
          type: c.isButton ? "button" : "link",
          position: { top: Math.round(c.top), left: Math.round(c.left) },
        }));
        const primaryCta = heroCtaCandidates[0]?.text || null;

        const normalizeText = (text) => cleanText(text || "").toLowerCase();
        const ctaTextSet = new Set(ctas.map((text) => normalizeText(text)));
        const isLikelyCtaText = (text) => {
          const norm = normalizeText(text);
          if (!norm) return false;
          if (ctaTextSet.has(norm)) return true;
          for (const cta of ctaTextSet) {
            if (cta && norm.includes(cta)) return true;
          }
          const shortWords = norm.split(/\s+/).filter(Boolean).length <= 4;
          if (
            shortWords &&
            /^(sign\s*up|sign\s*in|log\s*in|contact\s*sales|talk\s*to\s*sales|get\s*started|start|try|request|book|schedule|join|buy|explore|learn\s*more)$/i.test(norm)
          ) return true;
          return false;
        };

        const siblingSubheadline = (() => {
          if (!headlineEl) return null;

          // Helper: test if an element is a valid subheadline candidate
          const isSubCandidate = (el) => {
            if (!el || !inHero(el) || inNavOrHeader(el) || inFramerNavOrFooter(el)) return false;
            const text = cleanText(el.innerText || "");
            if (!text || text.length < 10) return false;
            if (text.split(/\s+/).filter(Boolean).length < 3) return false;
            if (el.closest("button, a, [role='button']")) return false;
            if (isLikelyCtaText(text)) return false;
            return true;
          };

          // Strategy 1: direct nextElementSibling of headlineEl
          let next = headlineEl.nextElementSibling;
          while (next && (!inHero(next) || inNavOrHeader(next) || inFramerNavOrFooter(next))) {
            next = next.nextElementSibling;
          }
          if (next) {
            // If the sibling itself is a clean text element, use it
            if (isSubCandidate(next) && !next.querySelector("button, a, [role='button']")) {
              return { el: next, text: cleanText(next.innerText || "") };
            }
            // If the sibling is a container with buttons, look for a <p> or <h2>/<h3> inside it
            const nested = next.querySelector("p, h2, h3");
            if (nested && isSubCandidate(nested) && !nested.querySelector("button, a, [role='button']")) {
              return { el: nested, text: cleanText(nested.innerText || "") };
            }
          }

          // Strategy 2: walk up to headlineEl's parent and check ITS next sibling
          const parent = headlineEl.parentElement;
          if (parent && parent !== document.body) {
            let parentNext = parent.nextElementSibling;
            while (parentNext && (!inHero(parentNext) || inNavOrHeader(parentNext) || inFramerNavOrFooter(parentNext))) {
              parentNext = parentNext.nextElementSibling;
            }
            if (parentNext) {
              // Direct match
              if (isSubCandidate(parentNext) && !parentNext.querySelector("button, a, [role='button']")) {
                return { el: parentNext, text: cleanText(parentNext.innerText || "") };
              }
              // Nested <p> inside
              const nested = parentNext.querySelector("p, h2, h3");
              if (nested && isSubCandidate(nested) && !nested.querySelector("button, a, [role='button']")) {
                return { el: nested, text: cleanText(nested.innerText || "") };
              }
            }
          }

          // Strategy 3: split/grid layouts — walk up to grandparent (or further)
          // and search all <p> elements within it that are near the headline
          const ancestors = [];
          let walk = headlineEl.parentElement;
          while (walk && walk !== document.body && ancestors.length < 3) {
            ancestors.push(walk);
            walk = walk.parentElement;
          }
          for (const ancestor of ancestors) {
            const paragraphs = Array.from(ancestor.querySelectorAll("p"))
              .filter((p) => p !== headlineEl && isSubCandidate(p) && !p.querySelector("button, a, [role='button']"))
              .filter((p) => {
                // Must not be inside nav/header
                if (inNavOrHeader(p) || inFramerNavOrFooter(p)) return false;
                // Must be near the headline vertically (within same visual band)
                const pRect = p.getBoundingClientRect();
                if (!headlineRect) return true;
                const verticallyNear = pRect.top <= headlineRect.bottom + 200 && pRect.bottom >= headlineRect.top - 50;
                return verticallyNear;
              })
              .map((p) => ({
                el: p,
                text: cleanText(p.innerText || ""),
                size: parseFloat(getComputedStyle(p).fontSize || "0") || 0,
                top: p.getBoundingClientRect().top,
              }))
              .filter((c) => c.text.length >= 20 && c.text.split(/\s+/).filter(Boolean).length >= 5)
              .sort((a, b) => {
                // Prefer text closest to headline (vertical distance)
                const aDist = Math.abs(a.top - (headlineRect ? headlineRect.top : 0));
                const bDist = Math.abs(b.top - (headlineRect ? headlineRect.top : 0));
                return aDist - bDist;
              });
            if (paragraphs.length > 0) {
              return { el: paragraphs[0].el, text: paragraphs[0].text };
            }
          }

          return null;
        })();

        if (siblingSubheadline) {
          subheadline = siblingSubheadline.text;
        }

        if (!subheadline) {
          const headlineSize = headlineEl
            ? parseFloat(getComputedStyle(headlineEl).fontSize || "0") || 0
            : 0;
          const headlineTop = headlineRect ? headlineRect.top : 0;
          const headlineBottom = headlineRect ? headlineRect.bottom : 0;

          const candidates = heroTextNodes
            .filter((el) => el !== headlineEl)
            .filter((el) => inHero(el) && isVisible(el) && !inNavOrHeader(el) && !inFramerNavOrFooter(el) && !looksLikeFooterContent(el) && !isFixedOrSticky(el))
            .filter((el) => !el.closest("button, a, [role='button']"))
            .filter((el) => !el.querySelector("button, a, [role='button']"))
            .map((el) => {
              const rect = el.getBoundingClientRect();
              return {
                el,
                text: cleanText(el.innerText || ""),
                size: parseFloat(getComputedStyle(el).fontSize || "0") || 0,
                top: rect.top,
              };
            })
            .filter((c) => c.text && c.text.length >= 12 && c.text.split(/\s+/).filter(Boolean).length >= 4)
            .filter((c) => !looksLikeNavText(c.text))
            .filter((c) => !isLikelyCtaText(c.text))
            .filter((c) => {
              if (!headlineRect) return true;
              // Allow elements that are:
              // - Below the headline (vertical layout): top >= headlineTop - 50, top <= headlineBottom + 320
              // - Side-by-side (split layout): vertically overlapping the headline band
              const verticallyNear =
                (c.top >= headlineTop - 50 && c.top <= headlineBottom + 320);
              const sizeOk = headlineSize ? c.size <= headlineSize - 4 : true;
              const notTooSmall = c.size >= Math.max(12, headlineSize * 0.32);
              return verticallyNear && sizeOk && notTooSmall;
            })
            .sort((a, b) => {
              if (headlineRect) {
                // Prefer elements closest to the headline (vertical distance to headline center)
                const headlineCenter = (headlineTop + headlineBottom) / 2;
                const aDist = Math.abs(a.top - headlineCenter);
                const bDist = Math.abs(b.top - headlineCenter);
                if (Math.abs(aDist - bDist) > 20) return aDist - bDist;
              }
              if (a.size !== b.size) return b.size - a.size;
              return a.text.length - b.text.length;
            });

          if (candidates[0]) {
            subheadline = candidates[0].text;
          }
        }

        const forms = Array.from(document.querySelectorAll("form")).filter((f) =>
          inHero(f) && !inNavOrHeader(f) && !inFramerNavOrFooter(f)
        );
        const formFields = forms.reduce(
          (sum, f) => sum + f.querySelectorAll("input").length,
          0
        );
        const hasEmailOnly = forms.some((f) => {
          const inputs = f.querySelectorAll("input");
          return (
            inputs.length === 1 && f.querySelector('input[type="email"]')
          );
        });

        // Auth/login form detection: look for password fields in hero forms
        // Also check for password inputs outside of forms (React apps often
        // render inputs without wrapping <form> elements)
        const hasPasswordField = forms.some((f) =>
          !!f.querySelector('input[type="password"]')
        ) || !!Array.from(document.querySelectorAll('input[type="password"]')).find((el) =>
          inHero(el) && isVisible(el)
        );

        // OAuth detection: look for Google/Apple/GitHub/Microsoft sign-in buttons
        // using multiple strategies to handle custom-rendered OAuth buttons
        const oauthProviders = /\b(google|apple|github|microsoft)\b/i;
        const oauthSelectors = [
          'button img[src*="google" i]', 'button img[src*="apple" i]',
          'button svg[aria-label*="google" i]', 'button svg[aria-label*="apple" i]',
          'a img[src*="google" i]', 'a img[src*="apple" i]',
          '[data-provider*="google" i]', '[data-provider*="apple" i]',
          '[aria-label*="Continue with Google" i]', '[aria-label*="Sign in with Google" i]',
          '[aria-label*="Continue with Apple" i]', '[aria-label*="Sign in with Apple" i]',
        ].join(", ");
        const hasOAuthElement = !!document.querySelector(oauthSelectors);

        // Also check all buttons/links in the hero for OAuth provider text
        const heroCtas = Array.from(document.querySelectorAll("button, a, [role='button']"))
          .filter((el) => inHero(el) && isVisible(el));
        const hasOAuthText = heroCtas.some((el) => {
          const text = (el.innerText || "").trim();
          return oauthProviders.test(text) && /(sign|log|continue|connect)\s*(in|up|with)/i.test(text);
        });

        const hasOAuth = hasOAuthElement || hasOAuthText;

        const grids = Array.from(document.querySelectorAll("*"))
          .filter((el) => inHero(el) && isVisible(el))
          .filter((el) => getComputedStyle(el).display === "grid");
        let maxChildren = 0;
        grids.forEach((g) => {
          maxChildren = Math.max(maxChildren, g.children.length);
        });

        const hasFilters = !!document.querySelector(
          'input[type="search"], select, [role="listbox"], [role="combobox"], input[type="checkbox"]'
        );

        const layout = (() => {
          const hero = document.body?.firstElementChild;
          if (!hero) return "single-column";
          const rects = Array.from(hero.children)
            .filter((el) => inHero(el) && isVisible(el))
            .map((el) => el.getBoundingClientRect());
          const left = rects.filter((r) => r.left < viewportWidth * 0.4);
          const right = rects.filter((r) => r.left > viewportWidth * 0.6);
          if (left.length && right.length) return "split";
          return "single-column";
        })();

        const alignment = (() => {
          if (!h1) return null;
          const style = getComputedStyle(h1);
          return style.textAlign || null;
        })();

        const detectedStack = [];

        // --- Frameworks / SSGs ---
        const hasNext =
          !!window.__NEXT_DATA__ ||
          !!document.getElementById("__next") ||
          !!document.querySelector("script#__NEXT_DATA__") ||
          !!document.querySelector('script[src*="/_next/"], link[href*="/_next/"]') ||
          !!document.querySelector('meta[name="next-head-count"]');
        if (hasNext && !detectedStack.includes("nextjs")) detectedStack.push("nextjs");
        if (window.Webflow) detectedStack.push("webflow");
        if (document.querySelector('meta[name="generator"][content*="Framer"]'))
          detectedStack.push("framer");
        if (window.___gatsby || document.getElementById("___gatsby"))
          detectedStack.push("gatsby");
        if (window.__NUXT__ || document.getElementById("__nuxt"))
          detectedStack.push("nuxt");
        if (window.__remixContext) detectedStack.push("remix");
        if (document.querySelector('meta[name="generator"][content*="Astro"]'))
          detectedStack.push("astro");
        if (document.querySelector('meta[name="generator"][content*="Hugo"]'))
          detectedStack.push("hugo");
        // SvelteKit: marker in DOM ids or inline scripts
        if (
          document.querySelector('[id*="__sveltekit"]') ||
          Array.from(document.querySelectorAll("script"))
            .slice(0, 30)
            .some((s) => (s.textContent || "").includes("__sveltekit"))
        )
          detectedStack.push("sveltekit");
        // WordPress: generator meta or wp-content/wp-includes resources
        if (
          document.querySelector('meta[name="generator"][content*="WordPress"]') ||
          !!document.querySelector(
            'link[href*="wp-content"], script[src*="wp-content"], link[href*="wp-includes"], script[src*="wp-includes"]'
          )
        )
          detectedStack.push("wordpress");
        // Shopify
        if (
          window.Shopify ||
          !!document.querySelector(
            'script[src*="cdn.shopify.com"], link[href*="cdn.shopify.com"]'
          )
        )
          detectedStack.push("shopify");
        // Wix
        if (
          window.wixBiSession ||
          !!document.querySelector(
            'link[href*="static.wixstatic.com"], script[src*="static.wixstatic.com"]'
          )
        )
          detectedStack.push("wix");
        // Squarespace
        if (
          (window.Static &&
            document.querySelector('script[src*="squarespace"]')) ||
          !!document.querySelector(
            'link[href*="squarespace.com"], script[src*="squarespace.com"]'
          )
        )
          detectedStack.push("squarespace");
        // VitePress: check for VitePress-specific DOM markers
        if (
          document.getElementById("VPContent") ||
          document.querySelector(".vp-doc, .VPDoc, .VPHome") ||
          !!document.querySelector('script[src*="vitepress"]')
        )
          detectedStack.push("vitepress");
        // Vue (generic — skip if already tagged as Nuxt or VitePress)
        if (
          !detectedStack.includes("nuxt") &&
          !detectedStack.includes("vitepress") &&
          (document.querySelector("[data-v-]") ||
           document.getElementById("app")?.hasAttribute("data-server-rendered"))
        )
          detectedStack.push("vue");
        // React (generic — skip if already tagged as Next/Gatsby/Remix)
        // Note: window globals are not accessible from content script isolated
        // world, so we rely on DOM markers only.
        if (
          !detectedStack.includes("nextjs") &&
          !detectedStack.includes("gatsby") &&
          !detectedStack.includes("remix")
        ) {
          const hasReact =
            !!document.querySelector("[data-reactroot], [data-reactid]") ||
            !!document.getElementById("react-root");
          if (hasReact) detectedStack.push("react");
        }
        // Angular
        if (
          document.querySelector("[ng-version], [_nghost], [_ngcontent]") ||
          !!document.querySelector('script[src*="angular"]')
        )
          detectedStack.push("angular");

        // --- CSS / UI Libraries ---
        // Use getAttribute('class') instead of el.className to handle SVG
        // elements whose .className is an SVGAnimatedString object.
        const classEls = Array.from(document.querySelectorAll("[class]")).slice(0, 500);
        const getClass = (el) => el.getAttribute("class") || "";
        const tailwindClasses = classEls.some((el) =>
          /(^|\s)(bg-|text-|px-|py-|rounded-)/.test(getClass(el))
        );
        if (tailwindClasses) detectedStack.push("tailwind");
        // Bootstrap: require 3+ distinct hits to avoid false positives
        const bootstrapHits = classEls.filter((el) =>
          /(^|\s)(btn btn-|container-fluid|col-(xs|sm|md|lg|xl)-|navbar-|form-control|card-body)/.test(
            getClass(el)
          )
        ).length;
        if (bootstrapHits >= 3) detectedStack.push("bootstrap");
        // Material UI
        if (classEls.some((el) => /(^|\s)Mui[A-Z]/.test(getClass(el))))
          detectedStack.push("material-ui");
        // Chakra UI
        if (classEls.some((el) => /(^|\s)chakra-/.test(getClass(el))))
          detectedStack.push("chakra-ui");
        // Radix / Shadcn
        if (
          document.querySelector(
            "[data-radix-popper-content-wrapper], [data-radix-collection-item], [data-state]"
          )
        )
          detectedStack.push("radix");
        // Ant Design
        if (classEls.some((el) => /(^|\s)ant-/.test(getClass(el))))
          detectedStack.push("ant-design");
        // Emotion CSS-in-JS (class names like css-1a2b3c4)
        if (
          document.querySelector('style[data-emotion]') ||
          classEls.filter((el) => /\bcss-[a-z0-9]{4,}\b/.test(getClass(el))).length >= 3
        )
          detectedStack.push("emotion");
        // Styled Components
        if (
          document.querySelector('style[data-styled], style[data-styled-components]') ||
          classEls.filter((el) => /\bsc-[a-zA-Z0-9]{6,}\b/.test(getClass(el))).length >= 3
        )
          detectedStack.push("styled-components");
        // CSS Modules (hashed class names like styles_header__a1B2c)
        if (
          classEls.filter((el) => /\b\w+_\w+__[a-zA-Z0-9]{4,}\b/.test(getClass(el))).length >= 3
        )
          detectedStack.push("css-modules");

        // --- Hosting / CDN ---
        if (
          document.querySelector(
            'meta[name*="vercel" i], script[src*="vercel-insights"], script[src*="vercel-analytics"]'
          )
        )
          detectedStack.push("vercel");
        if (
          !!document.querySelector(
            'script[src*=".netlify"], link[href*=".netlify"]'
          ) ||
          !!document.querySelector(
            'meta[name="generator"][content*="Netlify"]'
          )
        )
          detectedStack.push("netlify");
        if (
          document.querySelector(
            'script[src*="cloudflareinsights.com"], script[data-cf-beacon]'
          )
        )
          detectedStack.push("cloudflare");
        if (
          document.querySelector(
            'script[src*="aws-amplify"], meta[name*="amplify" i]'
          )
        )
          detectedStack.push("aws-amplify");

        // --- Animation / Motion ---
        if (window.gsap || document.querySelector('script[src*="gsap"]'))
          detectedStack.push("gsap");
        if (
          document.querySelector('lottie-player, script[src*="lottie"]')
        )
          detectedStack.push("lottie");
        // Framer Motion (React lib, distinct from Framer builder)
        if (
          !detectedStack.includes("framer") &&
          document.querySelector(
            "[data-framer-appear-id], [data-framer-component-type]"
          )
        )
          detectedStack.push("framer-motion");

        const heroHeightRatio = Math.min(1, heroBottom / viewportHeight);

        const pricingText = [headline, subheadline, ...ctas]
          .filter(Boolean)
          .join(" ");
        const hasPricingTokens = /(pricing|plans|per month|per year|billing|free trial)/i.test(
          pricingText
        );

        // --- Promotion / e-commerce detection ---
        const promoRegex = /(\d+%\s*off|\bsale\b|\bflash sale\b|\bclearance\b|\bdiscount\b|\bsave\s+\d|\bdeal(s)?\b|\blimited.?time\b|\bends?\s+(today|tonight|soon|in)\b|\blast\s+(day|chance|hours?)\b|\bhurry\b|\bwhile\s+stocks?\s+last\b|\bdouble\b.*\b(sale|offer|deal)\b)/i;
        const transactionalCtaRegex = /^(shop\s*now|buy\s*now|add\s*to\s*cart|order\s*now|get\s*the\s*deal|grab\s*(it|yours)|shop\s*(all|the\s*sale)|view\s*deal)/i;
        const priceRegex = /\$\d+|\d+[.,]\d{2}\s*(USD|EUR|GBP|SGD|AUD|MYR|THB|PHP|IDR|VND|HKD|KRW|JPY|INR|BRL|CAD)?|\d+%\s*off/i;

        const allHeroText = heroText || "";
        const hasPromoLanguage = promoRegex.test(allHeroText) || promoRegex.test([headline, subheadline].filter(Boolean).join(" "));
        const hasTransactionalCta = ctas.some((cta) => transactionalCtaRegex.test(cta));
        const hasPriceDisplay = priceRegex.test(allHeroText);

        // Count price-tagged elements (product cards with prices)
        const priceElements = Array.from(document.querySelectorAll("*"))
          .filter((el) => inHero(el) && isVisible(el))
          .filter((el) => {
            const t = (el.innerText || "").trim();
            return t.length < 30 && priceRegex.test(t) && el.children.length === 0;
          });
        const priceCount = priceElements.length;

        // Countdown timer detection
        const hasCountdown = (() => {
          const timerSelectors = [
            "[class*='countdown' i]", "[id*='countdown' i]",
            "[class*='timer' i]", "[id*='timer' i]",
            "[class*='clock' i]", "[data-countdown]",
          ];
          for (const sel of timerSelectors) {
            const el = document.querySelector(sel);
            if (el && inHero(el) && isVisible(el)) return true;
          }
          // Heuristic: look for colon-separated numbers (00:12:34) in small elements
          const smallEls = Array.from(document.querySelectorAll("span, div, p"))
            .filter((el) => inHero(el) && isVisible(el) && (el.innerText || "").length < 20);
          return smallEls.some((el) => /\d{1,2}\s*:\s*\d{2}\s*:\s*\d{2}/.test(el.innerText || ""));
        })();

        const hasPromotionSignals = hasPromoLanguage || (hasTransactionalCta && hasPriceDisplay);

        // --- Commerce structure detection ---
        // Add-to-cart buttons in hero
        const addToCartRegex = /^(add\s*to\s*cart|add\s*to\s*bag|add\s*to\s*basket|buy\s*now|shop\s*now|quick\s*add|quick\s*shop)\s*$/i;
        const heroButtons = Array.from(document.querySelectorAll("button, a, [role='button']"))
          .filter((el) => inHero(el) && isVisible(el));
        const addToCartCount = heroButtons.filter((el) => addToCartRegex.test((el.innerText || "").trim())).length;

        // Product cards: elements that contain both a price and an image (common e-commerce pattern)
        const productCardSelectors = [
          "[class*='product' i]", "[class*='item-card' i]", "[class*='sku' i]",
          "[data-product]", "[data-sku]", "[data-item]",
          "[class*='card' i]",
        ].join(", ");
        const candidateCards = Array.from(document.querySelectorAll(productCardSelectors))
          .filter((el) => inHero(el) && isVisible(el));
        const productCardCount = candidateCards.filter((card) => {
          const hasImg = !!card.querySelector("img");
          const cardText = (card.innerText || "").trim();
          const hasPrice = priceRegex.test(cardText);
          return hasImg && hasPrice && cardText.length < 300;
        }).length;

        // Category navigation: sidebar or horizontal nav with category-like links
        const categoryNavSelectors = [
          "[class*='category' i]", "[class*='categories' i]",
          "[class*='department' i]", "[class*='sidebar' i] nav",
          "[class*='sidebar' i] ul", "[data-category]",
          "nav[class*='shop' i]", "[class*='browse' i]",
        ].join(", ");
        const categoryNavElements = Array.from(document.querySelectorAll(categoryNavSelectors))
          .filter((el) => inHero(el) || el.getBoundingClientRect().top < viewportHeight);
        const hasCategoryNav = categoryNavElements.some((el) => {
          const links = el.querySelectorAll("a");
          return links.length >= 3;
        });

        // "New arrivals" / discovery language detection
        const discoveryRegex = /\b(new\s*arrivals?|just\s*dropped|trending|best\s*sellers?|most\s*popular|curated|picks?\s*for\s*you|recommended|explore|discover|what'?s\s*new|fresh\s*finds?|editor'?s?\s*choice|top\s*rated)\b/i;
        const hasDiscoveryLanguage = discoveryRegex.test(allHeroText);

        // Brand campaign signals: full-bleed imagery, single-brand focus
        const brandCampaignRegex = /\b(collection|campaign|introducing|new\s*season|spring|summer|autumn|fall|winter|holiday|launch|collab(oration)?|limited\s*edition|exclusive)\b/i;
        const hasBrandCampaignLanguage = brandCampaignRegex.test(allHeroText);

        // Trust signals: guarantees, badges, reassurance copy
        const trustRegex = /\b(free\s*(shipping|delivery|returns?)|money.?back\s*guarantee|satisfaction\s*guaranteed|secure\s*(checkout|payment)|trusted\s*by|verified|authentic|100%\s*(genuine|original)|no\s*risk|easy\s*returns?|customer\s*reviews?|rated\s*\d|stars?\s*rating|\d+[,.]?\d*\+?\s*reviews?)\b/i;
        const hasTrustSignals = trustRegex.test(allHeroText);
        const trustBadgeSelectors = [
          "[class*='trust' i]", "[class*='badge' i]", "[class*='guarantee' i]",
          "[class*='secure' i]", "[class*='verified' i]", "[class*='certification' i]",
        ].join(", ");
        const trustBadgeCount = Array.from(document.querySelectorAll(trustBadgeSelectors))
          .filter((el) => inHero(el) && isVisible(el)).length;

        // Composite commerce signals
        const isCommerceHero = productCardCount >= 2 || (addToCartCount >= 2 && hasPriceDisplay);

        // --- Showcase / interactive demo detection ---
        const inFold = (el) => {
          const r = el.getBoundingClientRect();
          return r.bottom > 0 && r.top < viewportHeight;
        };
        // Canvas and WebGL elements in hero
        const heroCanvasElements = Array.from(document.querySelectorAll("canvas"))
          .filter((el) => inHero(el) && isVisible(el));
        const hasCanvas = heroCanvasElements.length > 0;
        const hasWebGL = heroCanvasElements.some((el) => {
          try { return !!(el.getContext("webgl2") || el.getContext("webgl")); } catch { return false; }
        });

        // Heavy SVG presence (inline animated SVGs, not just icons)
        const heroSvgs = Array.from(document.querySelectorAll("svg"))
          .filter((el) => inHero(el) && isVisible(el));
        const largeSvgCount = heroSvgs.filter((el) => {
          const r = el.getBoundingClientRect();
          return r.width > 80 && r.height > 80;
        }).length;

        // Interactive elements: code editors, playgrounds, embedded demos
        const interactiveSelectors = [
          "[class*='playground' i]", "[class*='editor' i]", "[class*='sandbox' i]",
          "[class*='codepen' i]", "[class*='repl' i]", "[class*='interactive' i]",
          "[class*='demo' i]:not(button):not(a)", "iframe[src*='codepen']",
          "iframe[src*='codesandbox']", "iframe[src*='stackblitz']",
          "[contenteditable='true']",
        ].join(", ");
        const hasInteractiveDemoBase = !!document.querySelector(interactiveSelectors);

        // Audio/voice-style interactive demo detection (e.g. ElevenLabs)
        const heroTextInputs = Array.from(
          document.querySelectorAll(
            "textarea, input[type='text'], input[type='search'], [contenteditable='true'], [role='textbox']"
          )
        ).filter((el) => inFold(el) && isVisible(el));
        const hasTextInput = heroTextInputs.length > 0;

        const heroAudioElements = Array.from(document.querySelectorAll("audio"))
          .filter((el) => inFold(el) && isVisible(el));
        const hasAudioElement = heroAudioElements.length > 0;

        const playButtonRegex = /\b(play|listen|preview|sample)\b/i;
        const voiceRegex = /\b(voice|voices|text to speech|tts)\b/i;
        const interactiveButtons = Array.from(
          document.querySelectorAll("button, a, [role='button'], [tabindex]")
        ).filter((el) => inFold(el) && isVisible(el));
        const hasPlayButton = interactiveButtons.some((el) => {
          const text = (el.innerText || "").trim();
          const aria = (el.getAttribute("aria-label") || "").trim();
          const title = (el.getAttribute("title") || "").trim();
          return playButtonRegex.test(text) || playButtonRegex.test(aria) || playButtonRegex.test(title);
        });
        const playControlCandidates = Array.from(
          document.querySelectorAll(
            "button, a, [role='button'], [tabindex]"
          )
        )
          .filter((el) => inFold(el) && isVisible(el))
          .filter((el) => {
            const cls = (el.className || "").toString();
            const id = (el.id || "").toString();
            const aria = (el.getAttribute("aria-label") || "");
            const testId = (el.getAttribute("data-testid") || "");
            const action = (el.getAttribute("data-action") || "");
            return /\bplay\b/i.test(cls) ||
              /\bplay\b/i.test(id) ||
              /\bplay\b/i.test(aria) ||
              /\bplay\b/i.test(testId) ||
              /\bplay\b/i.test(action);
          });
        const hasPlayControl = hasPlayButton || playControlCandidates.length > 0;

        const heroOptions = Array.from(
          document.querySelectorAll(
            "[role='listbox'], [role='option'], [role='tablist'], [role='tab'], [data-voice], [class*='voice' i]"
          )
        ).filter((el) => inFold(el) && isVisible(el));
        let hasSelectableList = heroOptions.length >= 3;

        // Detect list-style voice pickers: many rows with avatars + short labels
        const rowContainers = Array.from(document.querySelectorAll("div, section, ul, ol"))
          .filter((el) => inFold(el) && isVisible(el) && !inNavOrHeader(el) && !inFramerNavOrFooter(el))
          .filter((el) => {
            const style = getComputedStyle(el);
            const isFlex = style.display === "flex" && style.flexDirection !== "column";
            const isGrid = style.display === "grid";
            return (isFlex || isGrid) && el.children.length >= 4;
          });

        const hasSelectableListFromRows = rowContainers.some((container) => {
          const children = Array.from(container.children).filter(isVisible);
          if (children.length < 4) return false;
          const qualifying = children.filter((child) => {
            const text = cleanText(child.innerText || "");
            const wordCount = text.split(/\s+/).filter(Boolean).length;
            const hasAvatar = !!child.querySelector("img, svg") || /avatar|voice|speaker/i.test(child.className || "");
            return hasAvatar && wordCount > 0 && wordCount <= 4;
          });
          return qualifying.length >= 4;
        });
        if (hasSelectableListFromRows) hasSelectableList = true;

        const hasVoiceLanguage = voiceRegex.test(allHeroText);

        const looksLikeAudioDemo =
          (hasTextInput && (hasSelectableList || hasVoiceLanguage || hasPlayControl || hasAudioElement)) ||
          (hasSelectableList && (hasPlayControl || hasAudioElement || hasVoiceLanguage)) ||
          (hasPlayControl && hasVoiceLanguage);

        let hasInteractiveDemo = hasInteractiveDemoBase || looksLikeAudioDemo;

        // Animation library in stack (already detected above in detectedStack)
        const animationStacks = ["gsap", "lottie", "framer-motion", "three"];
        const hasAnimationStack = detectedStack.some((s) => animationStacks.includes(s));

        // Showcase language in hero text
        const showcaseRegex = /\b(animate|animation|interactive|playground|demo|experiment|creative|motion|3d|webgl|three\.?js|canvas|generative|immersive|experience)\b/i;
        const hasShowcaseLanguage = showcaseRegex.test(allHeroText);

        // Composite showcase signal: animation stack + visual-heavy hero with minimal CTA
        const isShowcaseHero = (hasAnimationStack || hasCanvas || hasWebGL || hasInteractiveDemo) &&
          (ctas.length <= 1 || hasShowcaseLanguage || hasInteractiveDemo);

        // --- Error / blocked page detection ---
        const errorPageRegex = /\b(something went wrong|access denied|blocked|forbidden|error occurred|page not found|404|403|500|502|503|504|service unavailable|temporarily unavailable|try again later|request blocked|security check|verify you are human|captcha|challenge|bot detected|automated access|unusual traffic|reference\s*(error\s*)?(code|id)|cloudflare|akamai|incapsula|distil|datadome|perimeterx)\b/i;
        const pageTitle = document.title || "";
        const bodyText = (document.body?.innerText || "").slice(0, 500);
        const isErrorPage = errorPageRegex.test(pageTitle) || errorPageRegex.test(bodyText) || errorPageRegex.test(allHeroText);
        const errorPageReason = isErrorPage ? (
          /access denied|blocked|forbidden|bot detected|automated|unusual traffic|security check|verify you are human|captcha|challenge/i.test(bodyText + pageTitle) ? "bot_blocked" :
          /404|page not found/i.test(bodyText + pageTitle) ? "not_found" :
          /500|502|503|504|service unavailable|temporarily unavailable/i.test(bodyText + pageTitle) ? "server_error" :
          "unknown_error"
        ) : null;

        const legalTextRegex = /(user agreement|privacy policy|cookie policy|terms|legal)/i;
        const navLinkRegex = /(^(top content|people|learning|jobs|games|career|productivity|finance|about|blog|pricing|contact|support|help|resources|docs|changelog|status)$)/i;
        const listContainers = Array.from(
          document.querySelectorAll("ul, ol")
        ).filter((list) => {
          if (!inHero(list) || !isVisible(list)) return false;
          // Exclude lists inside nav, header, footer, menu roles
          if (inNavOrHeader(list)) return false;
          return true;
        });

        const listItems = listContainers.flatMap((list) =>
          Array.from(list.querySelectorAll("li")).map((el) => {
            const r = el.getBoundingClientRect();
            const style = getComputedStyle(el);
            const listStyle = style.listStyleType || "";
            const hasIcon =
              !!el.querySelector("svg, img, i, [class*='icon' i]") ||
              !!el.querySelector("[data-icon]");
            const text = cleanText(el.innerText || "");
            const wordCount = text.split(" ").filter(Boolean).length;
            const looksLikeLogo =
              wordCount <= 2 &&
              !!el.querySelector("img, svg") &&
              !el.querySelector("p, span, div");
            const isLegal = legalTextRegex.test(text);
            const isNavLink = navLinkRegex.test(text);
            const inForm = !!el.closest("form");
            // Check if the list item is essentially just a link (nav-style)
            const isJustLink = el.children.length <= 1 && !!el.querySelector("a") && wordCount <= 3;
            return {
              text,
              top: r.top,
              listStyle,
              hasIcon,
              wordCount,
              looksLikeLogo,
              isLegal,
              isNavLink,
              inForm,
              isJustLink,
              listStyleType: listStyle,
            };
          })
        );

        const interactiveListItems = listItems
          .filter((item) => item.hasIcon)
          .filter((item) => !item.looksLikeLogo)
          .filter((item) => !item.isLegal && !item.isNavLink && !item.inForm && !item.isJustLink)
          .filter((item) => item.wordCount > 0 && item.wordCount <= 4)
          .filter((item) => item.text.length >= 2);
        const hasSelectableListFromItems = interactiveListItems.length >= 4;
        if (hasSelectableListFromItems) hasSelectableList = true;
        if (hasTextInput && (hasSelectableListFromItems || hasVoiceLanguage)) {
          hasInteractiveDemo = true;
        }

        const interactiveDebug = {
          has_text_input: hasTextInput,
          text_input_count: heroTextInputs.length,
          has_audio_element: hasAudioElement,
          audio_count: heroAudioElements.length,
          has_play_button: hasPlayButton,
          has_play_control: hasPlayControl,
          play_control_candidates: playControlCandidates.length,
          selectable_option_count: heroOptions.length,
          has_selectable_list: hasSelectableList,
          row_container_count: rowContainers.length,
          has_selectable_list_from_rows: hasSelectableListFromRows,
          has_selectable_list_from_items: hasSelectableListFromItems,
          has_voice_language: hasVoiceLanguage,
          has_interactive_demo_base: hasInteractiveDemoBase,
          looks_like_audio_demo: looksLikeAudioDemo,
          has_interactive_demo: hasInteractiveDemo,
        };

        // Filter for true feature bullets: substantive descriptions of product capabilities.
        // Exclude: short action hints ("Add website"), trust badges ("No credit card"),
        // and CTA-adjacent micro-copy.
        const actionHintRegex = /^(no credit|no card|free |cancel anytime|money.back)/i;
        const shortActionRegex = /^(add|import|see|view|get|try|start|create|set up|install|connect)\b/i;
        const featureListItems = listItems
          .filter((item) => item.text.length >= 20 && /[a-zA-Z]/.test(item.text))
          .filter((item) => item.top >= contentTop)
          .filter((item) => !item.looksLikeLogo)
          .filter((item) => !item.isLegal && !item.isNavLink && !item.inForm && !item.isJustLink)
          .filter((item) => !actionHintRegex.test(item.text))
          // Short items (< 5 words) starting with action verbs are CTA hints, not features
          .filter((item) => !(item.wordCount < 5 && shortActionRegex.test(item.text)))
          .filter((item) => {
            // Must have a visible list marker or a leading icon with substantial text
            if (item.listStyleType && item.listStyleType !== "none") return item.wordCount >= 4;
            if (!item.hasIcon) return false;
            return item.wordCount >= 5;
          });

        const bulletCount = featureListItems.length;

        // Virtual bullet detection: find div/section containers with 3+ similar children
        // that follow an icon + text pattern (Tailwind/component-based builds)
        let virtualBulletCount = 0;
        if (bulletCount < 2) {
          const bulletContainers = Array.from(
            document.querySelectorAll("div, section")
          ).filter((el) => {
            if (!inHero(el) || !isVisible(el) || inNavOrHeader(el)) return false;
            const style = getComputedStyle(el);
            const isFlex = style.display === "flex";
            const isGrid = style.display === "grid";
            return (isFlex || isGrid) && el.children.length >= 3;
          });

          for (const container of bulletContainers) {
            const children = Array.from(container.children).filter(isVisible);
            if (children.length < 3) continue;

            const featureChildren = children.filter((child) => {
              const hasIcon = !!child.querySelector("svg, img, i, [class*='icon' i], [data-icon]");
              const text = cleanText(child.innerText || "");
              const wordCount = text.split(/\s+/).filter(Boolean).length;
              return hasIcon && wordCount >= 4;
            });

            if (featureChildren.length >= 3) {
              virtualBulletCount = Math.max(virtualBulletCount, featureChildren.length);
            }
          }
        }

        const totalBulletCount = bulletCount + virtualBulletCount;
        const totalListsInHero = listContainers.length;

        const mediaElements = Array.from(
          document.querySelectorAll("img, video, svg, canvas, figure")
        )
          .filter((el) => inHero(el) && isVisible(el))
          .map((el) => {
            const r = el.getBoundingClientRect();
            return {
              el,
              rect: r,
              area: r.width * r.height,
            };
          });

        const largestMedia = mediaElements.sort((a, b) => b.area - a.area)[0];

        // Collect details for all meaningful images/media in the hero
        const heroImages = mediaElements
          .filter((m) => m.area > 400) // Skip tiny icons
          .slice(0, 10) // Cap at 10
          .map((m) => {
            const el = m.el;
            const tag = el.tagName.toLowerCase();
            return {
              tag,
              alt: el.alt || el.getAttribute("aria-label") || null,
              width: Math.round(m.rect.width),
              height: Math.round(m.rect.height),
              position: {
                top: Math.round(m.rect.top),
                left: Math.round(m.rect.left),
              },
            };
          });

        const keywordText = [headline, subheadline].filter(Boolean).join(" ");
        const hasDashboardKeywords = /(dashboard|analytics|reporting|metrics|kpi|overview|insights)/i.test(
          keywordText
        );
        const heroMediaTag =
          largestMedia?.el?.tagName?.toLowerCase?.() || null;
        const heroMediaSource =
          largestMedia?.el?.src ||
          largestMedia?.el?.currentSrc ||
          "";
        const heroMediaAlt = largestMedia?.el?.alt || "";
        const mediaLooksLikeProductUi = /(dashboard|analytics|report|insight|ui|product|screenshot)/i.test(
          `${heroMediaSource} ${heroMediaAlt}`
        );
        const heroMediaType =
          largestMedia &&
          largestMedia.area > viewportWidth * 0.22 * viewportHeight * 0.22 &&
          (heroMediaTag === "img" || heroMediaTag === "video") &&
          (mediaLooksLikeProductUi || hasDashboardKeywords)
            ? "product-ui"
            : null;

        const hasDashboardPreview =
          heroMediaType === "product-ui" && hasDashboardKeywords;

        // Logo detection: find small images that look like company/partner logos.
        // Exclude images inside data containers (tables, grids).
        const logoCandidate = Array.from(document.querySelectorAll("img"))
          .filter((el) => {
            if (!inHero(el) || !isVisible(el)) return false;
            if (el.closest("table, [role='grid'], [role='row'], [role='cell'], tr, td, th")) return false;
            return true;
          })
          .map((el) => {
            const r = el.getBoundingClientRect();
            return {
              width: r.width,
              height: r.height,
              top: r.top,
              left: r.left,
              centerY: r.top + r.height / 2,
              alt: (el.alt || "").toLowerCase(),
            };
          })
          .filter(
            (img) =>
              img.width > 24 &&
              img.width < 180 &&
              img.height < 80 &&
              !/(icon|favicon)/i.test(img.alt)
          );

        // SVG logo detection: inline SVGs that look like partner/company logos
        const svgLogoCandidates = Array.from(document.querySelectorAll("svg"))
          .filter((el) => {
            if (!inHero(el) || !isVisible(el)) return false;
            if (inNavOrHeader(el)) return false;
            // Exclude icon buttons — SVGs inside interactive elements are likely UI icons
            if (el.closest("button, a[href], [role='button']")) return false;
            if (el.closest("table, [role='grid'], [role='row']")) return false;
            return true;
          })
          .map((el) => {
            const r = el.getBoundingClientRect();
            return {
              width: r.width,
              height: r.height,
              top: r.top,
              left: r.left,
              centerY: r.top + r.height / 2,
              alt: (el.getAttribute("aria-label") || "").toLowerCase(),
            };
          })
          .filter(
            (svg) =>
              svg.width > 24 &&
              svg.width < 180 &&
              svg.height > 10 &&
              svg.height < 80 &&
              !/(icon|favicon|arrow|chevron|check|close|menu|hamburger)/i.test(svg.alt)
          );

        // Merge img and svg logo candidates
        const allLogoCandidates = [...logoCandidate, ...svgLogoCandidates];

        // Detect horizontal logo rows: cluster logos by similar Y position (within 25px).
        // A social proof row is 3+ logos at roughly the same vertical position,
        // spread horizontally across a meaningful width (> 200px).
        let logoRowCount = 0;
        if (allLogoCandidates.length >= 3) {
          const sorted = [...allLogoCandidates].sort((a, b) => a.centerY - b.centerY);
          let i = 0;
          while (i < sorted.length) {
            const rowY = sorted[i].centerY;
            const rowItems = [];
            let j = i;
            while (j < sorted.length && Math.abs(sorted[j].centerY - rowY) < 25) {
              rowItems.push(sorted[j]);
              j++;
            }
            if (rowItems.length >= 3) {
              // Check horizontal spread: logos must span > 200px horizontally
              const minLeft = Math.min(...rowItems.map((r) => r.left));
              const maxLeft = Math.max(...rowItems.map((r) => r.left));
              if (maxLeft - minLeft > 200) {
                logoRowCount = Math.max(logoRowCount, rowItems.length);
              }
            }
            i = j;
          }
        }

        // Logo container detection: find flex/grid containers with 3+ small media children
        // Catches styled logo bars even when individual items don't match size heuristics
        if (logoRowCount < 3) {
          const logoContainers = Array.from(document.querySelectorAll("div, section, ul"))
            .filter((el) => {
              if (!inHero(el) || !isVisible(el) || inNavOrHeader(el)) return false;
              const style = getComputedStyle(el);
              const isFlex = style.display === "flex" && style.flexDirection !== "column";
              const isGrid = style.display === "grid";
              return isFlex || isGrid;
            });

          for (const container of logoContainers) {
            const mediaChildren = Array.from(container.children).filter((child) => {
              if (!isVisible(child)) return false;
              const hasMedia = !!child.querySelector("img, svg") || child.tagName === "IMG" || child.tagName === "svg";
              const r = child.getBoundingClientRect();
              return hasMedia && r.width < 200 && r.height < 100;
            });
            if (mediaChildren.length >= 3) {
              logoRowCount = Math.max(logoRowCount, mediaChildren.length);
            }
          }
        }

        const logoCount = logoRowCount > 0 ? logoRowCount : allLogoCandidates.length;

        // Social proof: either explicit text OR a horizontal row of 3+ logos
        const hasSocialProofText = /(trusted by|loved by|used by|chosen by|powering|backed by|as seen in|as seen on|featured in|featured on|customers include|partners include|join\s+\d|rated\s+\d|\d[\d,.\s]*\+?\s*(users|teams|companies|businesses|organizations|brands|developers|customers)|(over|more than)\s+\d[\d,.\s]*\s*(users|teams|companies|businesses|organizations|brands|developers|customers)|\d+\s*\+?\s*(customers|teams|companies)\s*(trust|use|love|rely))/i.test(
          heroText
        );
        const hasLogoRow = logoRowCount >= 3;
        const hasSocialProof = hasSocialProofText || hasLogoRow;

        const metricsVisible = /(\$\s?\d|\b\d{1,3}(?:[.,]\d{3})*(?:k|m|b)?\b|%)/i.test(
          heroText
        );

        const leftCopyRightMedia =
          layout === "split" &&
          largestMedia &&
          largestMedia.rect.left > viewportWidth * 0.5;

        // --- Helper: parse an rgb/rgba string into {r,g,b,a} or null ---
        const parseRgba = (str) => {
          const m = (str || "").match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\s*\)/i);
          if (!m) return null;
          return { r: Number(m[1]), g: Number(m[2]), b: Number(m[3]), a: m[4] !== undefined ? Number(m[4]) : 1 };
        };

        // --- Helper: parse an hsl/hsla string into {r,g,b,a} ---
        const parseHsla = (str) => {
          const m = (str || "").match(/hsla?\(([\d.]+)(?:deg)?\s*[\s,]\s*([\d.]+)%\s*[\s,]\s*([\d.]+)%(?:\s*[\s,/]\s*([\d.]+%?))?\s*\)/i);
          if (!m) return null;
          const h = Number(m[1]) / 360;
          const s = Number(m[2]) / 100;
          const l = Number(m[3]) / 100;
          const a = m[4] !== undefined ? (m[4].endsWith("%") ? Number(m[4].slice(0, -1)) / 100 : Number(m[4])) : 1;
          const hue2rgb = (p, q, t) => {
            if (t < 0) t += 1;
            if (t > 1) t -= 1;
            if (t < 1 / 6) return p + (q - p) * 6 * t;
            if (t < 1 / 2) return q;
            if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
            return p;
          };
          let rr, gg, bb;
          if (s === 0) {
            rr = gg = bb = l;
          } else {
            const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
            const p = 2 * l - q;
            rr = hue2rgb(p, q, h + 1 / 3);
            gg = hue2rgb(p, q, h);
            bb = hue2rgb(p, q, h - 1 / 3);
          }
          return { r: Math.round(rr * 255), g: Math.round(gg * 255), b: Math.round(bb * 255), a };
        };

        // --- Helper: parse any CSS color token (rgb/rgba/hsl/hsla) ---
        const parseColor = (str) => parseRgba(str) || parseHsla(str);

        // --- Helper: parse a single CSS color token into {r,g,b,a} ---
        const parseAnyColor = (str) => {
          const parsed = parseColor(str);
          if (parsed) return parsed;
          if (str && str.startsWith("#")) {
            const hex = str.slice(1);
            let rr, gg, bb;
            if (hex.length === 3) {
              rr = parseInt(hex[0] + hex[0], 16);
              gg = parseInt(hex[1] + hex[1], 16);
              bb = parseInt(hex[2] + hex[2], 16);
            } else if (hex.length >= 6) {
              rr = parseInt(hex.slice(0, 2), 16);
              gg = parseInt(hex.slice(2, 4), 16);
              bb = parseInt(hex.slice(4, 6), 16);
            } else {
              return null;
            }
            return { r: rr, g: gg, b: bb, a: 1 };
          }
          return null;
        };

        // --- Helper: extract all parsed color stops from a gradient string ---
        const gradientColors = (gradientStr) => {
          const colorPattern = /(rgba?\([^)]+\)|hsla?\([^)]+\)|#[0-9a-fA-F]{3,8})/g;
          const matches = gradientStr.match(colorPattern);
          if (!matches || matches.length === 0) return [];
          const colors = [];
          for (const c of matches) {
            const parsed = parseAnyColor(c);
            if (parsed) colors.push(parsed);
          }
          return colors;
        };

        // --- Helper: extract first color stop from a gradient string ---
        const firstGradientColor = (gradientStr) => {
          const colors = gradientColors(gradientStr);
          return colors.length > 0 ? colors[0] : null;
        };

        // --- Helper: build a gradient tag like "pink-yellow-gradient" from color stops ---
        const buildGradientTag = (gradientStr) => {
          const colors = gradientColors(gradientStr);
          if (colors.length === 0) return null;
          // Classify each stop, deduplicate while preserving order
          const names = [];
          for (const c of colors) {
            const name = classifyColor(c);
            if (name && (names.length === 0 || names[names.length - 1] !== name)) {
              names.push(name);
            }
          }
          if (names.length === 0) return null;
          // Cap at 3 distinct colors to keep the tag readable
          const unique = names.slice(0, 3);
          return unique.join("-") + "-gradient";
        };

        // --- Helper: classify an {r,g,b} into a named color label ---
        const classifyColor = (c) => {
          if (!c) return null;
          const { r, g, b } = c;
          const maxC = Math.max(r, g, b);
          const minC = Math.min(r, g, b);
          const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;

          // Very dark
          if (maxC <= 35 && (maxC - minC) <= 10) return "black";
          // Only classify as generic "dark" when the color is desaturated.
          // Chromatic dark colors (e.g. deep burgundy, navy) should fall
          // through to the hue classification below so they get a real name.
          const darkDelta = maxC - minC;
          if (lum < 0.15 && darkDelta < 40) return "dark";

          // Very light / white
          if (minC >= 240) return "white";
          if (lum > 0.9) return "off_white";

          // Determine dominant hue
          const delta = maxC - minC;
          if (delta < 20) {
            // Grey tones
            return lum > 0.5 ? "light_grey" : "dark_grey";
          }

          let h = 0;
          if (maxC === r) h = ((g - b) / delta) % 6;
          else if (maxC === g) h = (b - r) / delta + 2;
          else h = (r - g) / delta + 4;
          h = Math.round(h * 60);
          if (h < 0) h += 360;

          // Map hue ranges to names
          if (h < 15 || h >= 345) return lum > 0.6 ? "light_red" : "red";
          if (h < 35) return lum > 0.6 ? "peach" : "orange";
          if (h < 65) return lum > 0.6 ? "light_yellow" : "yellow";
          if (h < 160) return lum > 0.6 ? "light_green" : "green";
          if (h < 200) return lum > 0.6 ? "light_cyan" : "cyan";
          if (h < 260) return lum > 0.6 ? "light_blue" : "blue";
          if (h < 290) return lum > 0.6 ? "light_purple" : "purple";
          if (h < 345) return lum > 0.6 ? "pink" : "magenta";
          return null;
        };

        const darkThemeResult = (() => {
          const result = {
            is_dark: false,
            hero_bg: null,
            hero_bg_gradient: null,
            hero_bg_color_name: null,
            hero_bg_gradient_tag: null,
            hero_text_color: null,
            sampled_element: null,
          };
          if (!headlineEl || !headlineRect) return result;
          // Sample a point just to the left of the headline — likely on the background, not on text
          const sampleX = Math.max(10, headlineRect.left - 30);
          const sampleY = Math.max(10, headlineRect.top + headlineRect.height / 2);

          // Walk from the element at that point upward until we find a non-transparent bg or gradient
          let el = document.elementFromPoint(sampleX, sampleY);
          if (!el) return result;
          let bg = "rgba(0, 0, 0, 0)";
          let bgImage = "none";
          let guard = 0;
          while (el && guard < 10) {
            const cs = getComputedStyle(el);
            bg = cs.backgroundColor;
            bgImage = cs.backgroundImage;
            // Stop if we found a solid bg or a gradient
            if ((bg && bg !== "rgba(0, 0, 0, 0)") || (bgImage && bgImage !== "none")) break;
            el = el.parentElement;
            guard += 1;
          }

          result.sampled_element = el
            ? el.tagName?.toLowerCase() + (el.className ? `.${String(el.className).split(" ")[0]}` : "")
            : null;
          result.hero_bg = bg;

          // Check for gradient background-image
          const hasGradient = bgImage && bgImage !== "none" && /gradient/i.test(bgImage);
          if (hasGradient) {
            result.hero_bg_gradient = bgImage;
            result.hero_bg_gradient_tag = buildGradientTag(bgImage);
          }

          // Text color
          const textColor = getComputedStyle(headlineEl).color;
          result.hero_text_color = textColor;

          // Determine the effective background color for classification
          let bgColor = null;
          const parsedBg = parseRgba(bg);
          if (parsedBg && parsedBg.a > 0) {
            bgColor = parsedBg;
          } else if (hasGradient) {
            // Extract first color stop from gradient
            bgColor = firstGradientColor(bgImage);
          }

          if (bgColor) {
            result.hero_bg_color_name = classifyColor(bgColor);
          }

          // Dark theme detection: luminance-based to catch dark blue/green/purple,
          // not just near-black backgrounds.
          if (bgColor && bgColor.a !== 0) {
            const bgLum = (0.2126 * bgColor.r + 0.7152 * bgColor.g + 0.0722 * bgColor.b) / 255;
            if (bgLum < 0.2) {
              const tMatch = textColor.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
              const tR = tMatch ? Number(tMatch[1]) : 0;
              const tG = tMatch ? Number(tMatch[2]) : 0;
              const tB = tMatch ? Number(tMatch[3]) : 0;
              const textLum = (0.2126 * tR + 0.7152 * tG + 0.0722 * tB) / 255;
              result.is_dark = textLum > 0.7;
            }
          }

          return result;
        })();
        const darkThemeHero = darkThemeResult.is_dark;

        const resolvedHeadline = headline || largestText;
        const headlineWordCount = resolvedHeadline
          ? resolvedHeadline.split(/\s+/).filter(Boolean).length
          : 0;
        // Copy-only hero: has a headline but no CTAs and no prominent media
        const isCopyOnly =
          !!resolvedHeadline &&
          headlineWordCount >= 3 &&
          ctas.length === 0 &&
          !heroMediaType;

        return {
          layout,
          alignment,
          hero_height_ratio: Number(heroHeightRatio.toFixed(2)),
          headline: resolvedHeadline,
          subheadline,
          headline_word_count: headlineWordCount,
          cta_count: ctas.length,
          primary_cta_text: primaryCta,
          ctas,
          cta_details: ctaDetails,
          has_form: forms.length > 0,
          form_fields_count: formFields,
          has_email_only: hasEmailOnly,
          has_password_field: hasPasswordField,
          has_oauth: hasOAuth,
          grid_cards_in_fold: maxChildren,
          has_filters: hasFilters,
          detected_stack: detectedStack,
          page_text: heroText,
          has_pricing_tokens: hasPricingTokens,
          has_promotion_signals: Boolean(hasPromotionSignals),
          has_promo_language: Boolean(hasPromoLanguage),
          has_transactional_cta: Boolean(hasTransactionalCta),
          has_price_display: Boolean(hasPriceDisplay),
          price_count: priceCount,
          has_countdown: Boolean(hasCountdown),
          add_to_cart_count: addToCartCount,
          product_card_count: productCardCount,
          has_category_nav: Boolean(hasCategoryNav),
          has_discovery_language: Boolean(hasDiscoveryLanguage),
          has_brand_campaign_language: Boolean(hasBrandCampaignLanguage),
          has_trust_signals: Boolean(hasTrustSignals),
          trust_badge_count: trustBadgeCount,
          is_commerce_hero: Boolean(isCommerceHero),
          has_canvas: Boolean(hasCanvas),
          has_webgl: Boolean(hasWebGL),
          large_svg_count: largeSvgCount,
          has_interactive_demo: Boolean(hasInteractiveDemo),
          has_animation_stack: Boolean(hasAnimationStack),
          has_showcase_language: Boolean(hasShowcaseLanguage),
          is_showcase_hero: Boolean(isShowcaseHero),
          is_error_page: Boolean(isErrorPage),
          error_page_reason: errorPageReason,
          bullet_count: totalBulletCount,
          feature_bullet_count: totalBulletCount,
          has_feature_bullets: totalBulletCount >= 2,
          total_lists_in_hero: totalListsInHero,
          has_dashboard_preview: Boolean(hasDashboardPreview),
          has_dashboard_keywords: Boolean(hasDashboardKeywords),
          has_social_proof: Boolean(hasSocialProof),
          logo_count: logoCount,
          left_copy_right_media: Boolean(leftCopyRightMedia),
          dark_theme_hero: Boolean(darkThemeHero),
          hero_bg: darkThemeResult.hero_bg,
          hero_bg_gradient: darkThemeResult.hero_bg_gradient,
          hero_bg_color_name: darkThemeResult.hero_bg_color_name,
          hero_bg_gradient_tag: darkThemeResult.hero_bg_gradient_tag,
          hero_text_color: darkThemeResult.hero_text_color,
          hero_bg_sampled_from: darkThemeResult.sampled_element,
          hero_media_type: heroMediaType,
          hero_images: heroImages,
          hero_image_count: heroImages.length,
          metrics_visible: Boolean(metricsVisible),
          is_copy_only: Boolean(isCopyOnly),
          interactive_debug: interactiveDebug,
          list_items_raw: featureListItems
            .concat(
              listItems.filter(
                (item) =>
                  !featureListItems.includes(item) &&
                  !item.looksLikeLogo &&
                  !item.isLegal &&
                  !item.isNavLink &&
                  !item.isJustLink
              )
            )
            .slice(0, 20)
            .map((item) => ({ text: item.text, wordCount: item.wordCount })),
        };
}

// Listen for messages from the service worker / side panel
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "EXTRACT_FINGERPRINT") {
    try {
      const fingerprint = extractFingerprint();
      sendResponse({ success: true, fingerprint });
    } catch (error) {
      sendResponse({ success: false, error: error.message });
    }
    return true; // async response
  }
});
