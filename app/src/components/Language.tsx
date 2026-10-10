"use client";
import { createContext, useContext, useEffect, useState } from "react";
type Language = "en" | "pl";
const Context = createContext({
  language: "en" as Language,
  setLanguage: (_: Language) => {},
  t: (en: string, _pl: string) => en,
});
export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguage] = useState<Language>("en");
  useEffect(() => {
    const saved = localStorage.getItem("fairodds-language");
    if (saved === "pl") setLanguage("pl");
  }, []);
  useEffect(() => {
    document.documentElement.lang = language;
    localStorage.setItem("fairodds-language", language);
  }, [language]);
  return (
    <Context.Provider
      value={{
        language,
        setLanguage,
        t: (en, pl) => (language === "pl" ? pl : en),
      }}
    >
      {children}
    </Context.Provider>
  );
}
export const useLanguage = () => useContext(Context);
