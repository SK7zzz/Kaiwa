/* Keyboard and focus behavior shared by the app's dialogs. */
"use strict";

(() => {
  const focusableSelector = "button, input, select, textarea, a[href], [tabindex='0']";
  const cancelButtons = {
    "custom-modal": "cr-cancel", "story-modal": "st-cancel",
    "switch-modal": "switch-cancel", "summary-modal": "sum-back",
    "call-overlay": "call-hangup",
  };
  const returnFocus = new WeakMap();

  function focusable(dialog) {
    return [...dialog.querySelectorAll(focusableSelector)]
      .filter(element => !element.disabled && element.getClientRects().length);
  }

  function focusDialog(dialog) {
    returnFocus.set(dialog, document.activeElement);
    (focusable(dialog)[0] || dialog).focus();
    document.getElementById("app").inert = true;
  }

  function restoreFocus(dialog) {
    const activeDialog = document.querySelector(".modal:not(.hidden), .popup:not(.hidden), .call-overlay:not(.hidden)");
    document.getElementById("app").inert = Boolean(activeDialog);
    const previous = returnFocus.get(dialog);
    if (activeDialog) (focusable(activeDialog)[0] || activeDialog).focus();
    else if (previous?.isConnected && previous.getClientRects().length) previous.focus();
    else document.getElementById("hero-practice").focus();
  }

  function dialogKeydown(event, dialog) {
    if (event.key === "Escape") {
      if (dialog.id === "word-pop") dialog.classList.add("hidden");
      else {
        const close = dialog.id === "summary-modal" && document.getElementById("sum-close")
          ? "sum-close" : cancelButtons[dialog.id];
        document.getElementById(close)?.click();
      }
      event.preventDefault();
      return;
    }
    if (event.key !== "Tab") return;
    const controls = focusable(dialog);
    const first = controls[0] || dialog;
    const last = controls.at(-1) || dialog;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault(); last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault(); first.focus();
    }
  }

  document.querySelectorAll(".modal, .popup, .call-overlay").forEach(dialog => {
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("tabindex", "-1");
    const title = dialog.querySelector("h2");
    if (title) {
      title.id ||= `${dialog.id}-title`;
      dialog.setAttribute("aria-labelledby", title.id);
    } else {
      const labels = { "word-pop": "Ayuda con una palabra", "call-overlay": "Conversación por voz" };
      dialog.setAttribute("aria-label", labels[dialog.id] || "Informe de la sesión");
    }
    let open = false;
    new MutationObserver(() => {
      const visible = !dialog.classList.contains("hidden");
      if (visible && !open) focusDialog(dialog);
      if (!visible && open) restoreFocus(dialog);
      open = visible;
      if (visible && (document.activeElement === dialog || !dialog.contains(document.activeElement))) (focusable(dialog)[0] || dialog).focus();
    }).observe(dialog, { attributes: true, attributeFilter: ["class"], childList: true, subtree: true });
    dialog.addEventListener("keydown", event => dialogKeydown(event, dialog));
  });

  document.addEventListener("click", event => {
    if (event.target.closest("[data-action='practice']")) show("home");
  });
  document.addEventListener("keydown", event => {
    const word = event.target.closest(".tok");
    if (word && (event.key === "Enter" || event.key === " ")) {
      event.preventDefault(); word.click();
    }
  });
  document.querySelectorAll("button[title]").forEach(button => {
    if (!button.textContent.trim()) button.setAttribute("aria-label", button.title);
  });
  document.getElementById("greeting").setAttribute("lang", "ja");
  document.getElementById("call-status").setAttribute("role", "status");
  document.getElementById("settings-saved").setAttribute("role", "status");
  function syncVoiceControls() {
    const mute = document.getElementById("call-mute");
    const captions = document.getElementById("call-cc");
    const muted = mute.classList.contains("muted-on");
    const captioned = captions.classList.contains("active");
    mute.setAttribute("aria-pressed", String(muted));
    mute.setAttribute("aria-label", muted ? "Activar micrófono" : "Silenciar micrófono");
    captions.setAttribute("aria-pressed", String(captioned));
    captions.setAttribute("aria-label", captioned ? "Ocultar subtítulos" : "Mostrar subtítulos");
  }
  const voiceControls = new MutationObserver(syncVoiceControls);
  ["call-mute", "call-cc"].forEach(id => voiceControls.observe(document.getElementById(id), { attributes: true, attributeFilter: ["class"] }));
  syncVoiceControls();
  document.querySelectorAll(".level-row").forEach(group => {
    const syncSelection = () => group.querySelectorAll("button").forEach(button => {
      button.setAttribute("aria-pressed", String(button.classList.contains("active")));
    });
    new MutationObserver(syncSelection).observe(group, { attributes: true, subtree: true, attributeFilter: ["class"] });
    syncSelection();
  });
})();
