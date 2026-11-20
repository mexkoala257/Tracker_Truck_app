import { useState, useEffect, useCallback } from "react";
import {
  DISPLAY_THEMES,
  isValidDisplayTheme,
  type DisplayThemeId,
} from "@shared/customScreens";

const OFFICE_THEME_STORAGE_KEY = "fleet_office_theme";

export function getSavedOfficeTheme(): DisplayThemeId {
  try {
    const val = localStorage.getItem(OFFICE_THEME_STORAGE_KEY);
    if (isValidDisplayTheme(val)) return val;
  } catch {
    // ignore storage errors
  }
  return "industrial-dispatch";
}

export function applyDocumentTheme(theme: DisplayThemeId) {
  if (typeof document !== "undefined") {
    document.documentElement.setAttribute("data-theme", theme);
  }
}

export function useOfficeTheme() {
  const [officeTheme, setOfficeThemeState] = useState<DisplayThemeId>(() =>
    getSavedOfficeTheme(),
  );

  useEffect(() => {
    applyDocumentTheme(officeTheme);
  }, [officeTheme]);

  const setOfficeTheme = useCallback((next: DisplayThemeId) => {
    setOfficeThemeState(next);
    try {
      localStorage.setItem(OFFICE_THEME_STORAGE_KEY, next);
    } catch {
      // ignore
    }
    applyDocumentTheme(next);
  }, []);

  return {
    officeTheme,
    setOfficeTheme,
    themes: DISPLAY_THEMES,
    isLight: officeTheme === "daylight-paper",
  };
}
