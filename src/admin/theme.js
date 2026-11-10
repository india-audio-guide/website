export const THEME_STORAGE_KEY = "iag-admin-theme";

export const THEME = {
  light: "light",
  dark: "dark",
};

const LOGO = {
  light: "/icons/icon_light.svg",
  dark: "/icons/icon_dark.svg",
};

const THEME_COLOR = {
  light: "#B4441A",
  dark: "#1f1c1a",
};

export function readStoredTheme(storage) {
  try {
    const raw = storage?.getItem?.(THEME_STORAGE_KEY);
    if (raw === THEME.light || raw === THEME.dark) return raw;
  } catch {
    // private mode / blocked storage
  }
  return null;
}

export function writeStoredTheme(storage, theme) {
  try {
    if (theme === THEME.light || theme === THEME.dark) {
      storage?.setItem?.(THEME_STORAGE_KEY, theme);
    }
  } catch {
    // ignore
  }
}

export function systemPrefersDark(mediaQuery) {
  return Boolean(mediaQuery?.matches);
}

/** Stored light/dark wins; otherwise follow the system. */
export function resolveTheme(stored, prefersDark) {
  if (stored === THEME.light || stored === THEME.dark) return stored;
  return prefersDark ? THEME.dark : THEME.light;
}

export function nextTheme(resolved) {
  return resolved === THEME.dark ? THEME.light : THEME.dark;
}

export function themeToggleLabel(resolved) {
  return resolved === THEME.dark ? "Switch to light mode" : "Switch to dark mode";
}

export function logoSrcForTheme(resolved) {
  return resolved === THEME.dark ? LOGO.dark : LOGO.light;
}

export function themeColorForTheme(resolved) {
  return resolved === THEME.dark ? THEME_COLOR.dark : THEME_COLOR.light;
}

/**
 * Apply theme to the document.
 * - With a stored choice, set html[data-theme].
 * - With no stored choice, remove data-theme so CSS follows prefers-color-scheme.
 */
export function applyTheme({
  stored,
  prefersDark,
  root,
  metaThemeColor,
  logo,
} = {}) {
  const resolved = resolveTheme(stored, prefersDark);
  if (!root) {
    return { resolved, stored: stored ?? null };
  }
  if (stored === THEME.light || stored === THEME.dark) {
    root.setAttribute("data-theme", stored);
  } else {
    root.removeAttribute("data-theme");
  }
  if (metaThemeColor) {
    metaThemeColor.setAttribute("content", themeColorForTheme(resolved));
  }
  if (logo) {
    logo.setAttribute("src", logoSrcForTheme(resolved));
  }
  return { resolved, stored: stored ?? null };
}

export function syncThemeToggleButton(button, resolved) {
  if (!button) return;
  button.setAttribute("aria-label", themeToggleLabel(resolved));
  button.dataset.theme = resolved;
}
