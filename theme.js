(function () {
  "use strict";

  const STORAGE_KEY = "zine_theme_v1";
  const themes = ["red", "orange", "yellow", "green", "blue", "purple"];

  function readTheme() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored === null) return "purple";
      const parsed = JSON.parse(stored);
      const value = typeof parsed === "string" ? parsed : parsed && parsed.theme;
      return themes.includes(value) ? value : "purple";
    } catch (error) {
      console.error("Unable to read the ZINE theme.", error);
      return "purple";
    }
  }

  function applyTheme(theme) {
    const selected = themes.includes(theme) ? theme : "purple";
    document.documentElement.dataset.theme = selected;
    const themeColor = document.querySelector('meta[name="theme-color"]');
    if (themeColor) {
      const background = getComputedStyle(document.documentElement).getPropertyValue("--bg").trim();
      if (background) themeColor.setAttribute("content", background);
    }
    document.querySelectorAll("[data-theme-name]").forEach((button) => {
      button.setAttribute("aria-checked", String(button.dataset.themeName === selected));
    });
    return selected;
  }

  function setTheme(theme) {
    const selected = applyTheme(theme);
    if (window.ZineCloud) window.ZineCloud.setRecord(STORAGE_KEY, { theme: selected });
    else localStorage.setItem(STORAGE_KEY, JSON.stringify({ theme: selected }));
    return selected;
  }

  applyTheme(readTheme());

  window.ZineTheme = {
    themes: [...themes],
    getTheme: readTheme,
    setTheme,
  };

  window.addEventListener("zine:cloud-synced", () => {
    applyTheme(readTheme());
  });

  function bindThemeMenu() {
    const toggle = document.getElementById("themeToggle");
    const menu = document.getElementById("themeMenu");
    if (!toggle || !menu) return;

    applyTheme(readTheme());

    function closeMenu() {
      menu.hidden = true;
      toggle.setAttribute("aria-expanded", "false");
    }

    toggle.addEventListener("click", (event) => {
      event.stopPropagation();
      const opening = menu.hidden;
      menu.hidden = !opening;
      toggle.setAttribute("aria-expanded", String(opening));
    });

    menu.addEventListener("click", (event) => {
      const button = event.target.closest("[data-theme-name]");
      if (!button) return;
      setTheme(button.dataset.themeName);
      closeMenu();
    });

    document.addEventListener("click", (event) => {
      if (!menu.hidden && !event.target.closest("#themeMenu, #themeToggle")) closeMenu();
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !menu.hidden) {
        closeMenu();
        toggle.focus();
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bindThemeMenu, { once: true });
  } else {
    bindThemeMenu();
  }
}());
