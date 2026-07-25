"use strict";

/**
 * Register reusable UI components on the global scope and Node exports.
 * @param {typeof globalThis} globalScope
 */
(function initUIComponents(globalScope) {
  const CARD_DEFINITIONS = Object.freeze([
    Object.freeze({
      key: "domestic",
      icon: "CN",
      iconClass: "domestic",
      title: "从国内测试",
      description: "这是您访问国内网站所使用的 IP",
      copyLabel: "国内",
      group: "domestic",
    }),
    Object.freeze({
      key: "foreign",
      icon: "INTL",
      iconClass: "foreign",
      title: "从国外测试",
      description: "这是您访问海外站点所使用的 IP",
      copyLabel: "国外",
      group: "overseas",
    }),
    Object.freeze({
      key: "google",
      icon: "G",
      iconClass: "google",
      title: "从谷歌测试",
      description: "这是您访问谷歌系服务所使用的出口",
      copyLabel: "谷歌",
      group: "overseas",
    }),
    Object.freeze({
      key: "cf",
      icon: "CF",
      iconClass: "cloudflare",
      title: "从 Cloudflare 测试",
      description: "这是您访问 Cloudflare 网站时的出口",
      copyLabel: "CF",
      group: "overseas",
    }),
  ]);

  /**
   * Return card definitions in the requested key order.
   * @param {string[]} keys
   * @returns {Array<(typeof CARD_DEFINITIONS)[number]>}
   */
  function getCardDefinitions(keys) {
    const definitions = new Map(
      CARD_DEFINITIONS.map((definition) => [definition.key, definition]),
    );

    return keys.map((key) => {
      const definition = definitions.get(key);
      if (!definition) throw new Error(`Missing card definition: ${key}`);
      return definition;
    });
  }

  /**
   * Create an element with optional class and text content.
   * @param {string} tagName
   * @param {string} [className]
   * @param {string} [text]
   * @returns {HTMLElement}
   */
  function createElement(tagName, className = "", text = "") {
    const element = document.createElement(tagName);
    if (className) element.className = className;
    if (text) element.textContent = text;
    return element;
  }

  /**
   * Build the DOM tree for one detector card.
   * @param {(typeof CARD_DEFINITIONS)[number]} definition
   * @returns {HTMLElement}
   */
  function createResultCardElement(definition, compact = false) {
    const card = createElement(
      "article",
      compact ? "result-item" : "card domestic-card",
    );
    card.dataset.key = definition.key;

    const header = createElement("div", "card-header");
    const icon = createElement(
      "div",
      `card-icon ${definition.iconClass}`,
      definition.icon,
    );
    icon.setAttribute("aria-hidden", "true");
    const statusElement = createElement("div", "card-status");
    statusElement.setAttribute("aria-hidden", "true");
    header.append(
      icon,
      createElement("div", "card-title", definition.title),
      statusElement,
    );

    const ipRow = createElement("div", "ip-row");
    const ip = createElement("div", "ip-display");
    ip.id = `${definition.key}-ip`;
    ip.appendChild(createElement("span", "loading", "检测中"));

    const copyButton = createElement("button", "copy-btn", "📋");
    copyButton.type = "button";
    copyButton.dataset.copyTarget = ip.id;
    copyButton.setAttribute("aria-label", "复制 IP");
    copyButton.title = "复制 IP";
    ipRow.append(ip, copyButton);

    const location = createElement("div", "ip-location");
    location.id = `${definition.key}-location`;

    card.append(
      header,
      ipRow,
      location,
      createElement("div", "card-desc", definition.description),
      createElement("div", "card-meta"),
    );
    return card;
  }

  /**
   * Build one shared card for the overseas detector rows.
   * @param {Array<(typeof CARD_DEFINITIONS)[number]>} definitions
   * @returns {{ root: HTMLElement, cards: Map<string, HTMLElement> }}
   */
  function createOverseasGroupElement(definitions) {
    const root = createElement("section", "card overseas-card");
    root.setAttribute("aria-labelledby", "overseas-card-title");

    const heading = createElement("div", "group-heading");
    const headingText = createElement("div", "group-heading-text");
    const eyebrow = createElement("div", "group-eyebrow", "OVERSEAS");
    const title = createElement("h2", "group-title", "海外出口");
    title.id = "overseas-card-title";
    headingText.append(eyebrow, title);
    heading.append(
      createElement("div", "group-icon", "INTL"),
      headingText,
      createElement(
        "div",
        "group-description",
        "国外站点与服务的出口检测",
      ),
    );

    const list = createElement("div", "result-list");
    const cards = new Map();
    definitions.forEach((definition) => {
      const card = createResultCardElement(definition, true);
      cards.set(definition.key, card);
      list.appendChild(card);
    });

    root.append(heading, list);
    return { root, cards };
  }

  /**
   * Replace the card grid with configured detector cards.
   * @param {HTMLElement} container
   * @param {string[]} keys
   * @returns {Map<string, HTMLElement>}
   */
  function mountResultCards(container, keys) {
    const cards = new Map();
    const fragment = document.createDocumentFragment();
    const definitions = getCardDefinitions(keys);

    definitions
      .filter((definition) => definition.group !== "overseas")
      .forEach((definition) => {
        const card = createResultCardElement(definition);
        cards.set(definition.key, card);
        fragment.appendChild(card);
      });

    const overseasDefinitions = definitions.filter(
      (definition) => definition.group === "overseas",
    );
    if (overseasDefinitions.length > 0) {
      const overseasGroup = createOverseasGroupElement(overseasDefinitions);
      overseasGroup.cards.forEach((card, key) => cards.set(key, card));
      fragment.appendChild(overseasGroup.root);
    }

    container.replaceChildren(fragment);
    return cards;
  }

  /**
   * Create the controller for one detector card.
   * @param {{ root: HTMLElement, status: Record<string, string>, isValidIP: (value: string) => boolean, getLatencyTier: (latency: number) => string }} options
   */
  function createResultCard({ root, status, isValidIP, getLatencyTier }) {
    const ipElement = root.querySelector(".ip-display");
    const locationElement = root.querySelector(".ip-location");
    const statusElement = root.querySelector(".card-status");
    const copyButton = root.querySelector(".copy-btn");
    const metaElement = root.querySelector(".card-meta");

    /**
     * Render the result and metadata for this card.
     * @param {{ ip: string, location?: string, cardStatus: string, latency?: number | null, source?: string | null }} value
     */
    function render({
      ip,
      location = "",
      cardStatus,
      latency = null,
      source = null,
    }) {
      if (copyButton) {
        copyButton.hidden =
          cardStatus === status.LOADING ||
          cardStatus === status.ERROR ||
          !isValidIP(ip);
      }

      if (ipElement) {
        ipElement.textContent = "";
        if (cardStatus === status.ERROR || cardStatus === status.LOADING) {
          ipElement.appendChild(
            createElement(
              "span",
              cardStatus === status.ERROR ? "error" : "loading",
              ip,
            ),
          );
        } else {
          ipElement.textContent = ip;
        }
      }

      if (locationElement) locationElement.textContent = location;

      if (metaElement) {
        metaElement.textContent = "";
        if (
          latency !== null &&
          cardStatus !== status.LOADING &&
          cardStatus !== status.ERROR
        ) {
          metaElement.appendChild(
            createElement(
              "span",
              `latency ${getLatencyTier(latency)}`,
              `${latency} ms`,
            ),
          );
          if (source) {
            metaElement.appendChild(createElement("span", "api-source", source));
          }
        }
      }

      if (statusElement) {
        const stateClass =
          cardStatus === status.SUCCESS
            ? status.SUCCESS
            : cardStatus === status.ERROR
              ? status.ERROR
              : cardStatus === status.WARN
                ? status.WARN
                : "";
        statusElement.className = `card-status${stateClass ? ` ${stateClass}` : ""}`;
      }
    }

    return {
      render,
      readIp() {
        return ipElement?.textContent?.trim() || "";
      },
    };
  }

  /**
   * Create the summary banner controller.
   * @param {HTMLElement} root
   */
  function createSummary(root) {
    const statusElement = root.querySelector("#summary-status");
    const timeElement = root.querySelector("#summary-time");

    return {
      render(text, badgeText = "", badgeClass = "") {
        if (!statusElement) return;
        statusElement.textContent = text;
        if (!badgeText) return;
        statusElement.append(
          " ",
          createElement("span", `badge ${badgeClass}`, badgeText),
        );
      },
      updateTimestamp() {
        if (!timeElement) return;
        timeElement.textContent = new Date().toLocaleTimeString("zh-CN", {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        });
      },
    };
  }

  /**
   * Create toast, clipboard, and pointer-tooltip interactions.
   * @param {{ toastElement: HTMLElement | null, tipElement: HTMLElement | null, toastDurationMs: number }} options
   */
  function createFeedback({ toastElement, tipElement, toastDurationMs }) {
    const isTouch = !window.matchMedia("(hover: hover)").matches;
    let toastTimer = null;

    function showToast(message) {
      if (!toastElement) return;
      toastElement.textContent = message;
      toastElement.classList.add("show");
      clearTimeout(toastTimer);
      toastTimer = setTimeout(
        () => toastElement.classList.remove("show"),
        toastDurationMs,
      );
    }

    function fallbackCopyToClipboard(text) {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.setAttribute("readonly", "");
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      textarea.style.pointerEvents = "none";
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();

      let copied = false;
      try {
        copied = document.execCommand("copy");
      } finally {
        textarea.remove();
      }
      return copied;
    }

    async function copyToClipboard(text) {
      try {
        if (navigator.clipboard?.writeText && window.isSecureContext) {
          await navigator.clipboard.writeText(text);
        } else if (!fallbackCopyToClipboard(text)) {
          throw new Error("Clipboard API unavailable");
        }
        showToast(`已复制: ${text}`);
        return true;
      } catch {
        showToast("复制失败");
        return false;
      }
    }

    function moveTip(x, y) {
      if (!tipElement) return;
      tipElement.style.left = `${x + 14}px`;
      tipElement.style.top = `${y - 28}px`;
    }

    return {
      copyToClipboard,
      isTouch,
      moveTip,
      showToast,
      showTip(text, x, y) {
        if (!tipElement || isTouch) return;
        tipElement.textContent = text;
        tipElement.style.opacity = "1";
        moveTip(x, y);
      },
      hideTip() {
        if (tipElement) tipElement.style.opacity = "0";
      },
    };
  }

  const uiComponents = {
    CARD_DEFINITIONS,
    createFeedback,
    createOverseasGroupElement,
    createResultCard,
    createResultCardElement,
    createSummary,
    getCardDefinitions,
    mountResultCards,
  };

  globalScope.IPCheckerUIComponents = uiComponents;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = uiComponents;
  }
})(typeof globalThis !== "undefined" ? globalThis : window);
