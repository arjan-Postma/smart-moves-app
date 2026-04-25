import React, { createContext, useContext, useState, useEffect } from 'react';
import { AppLanguage, getLanguage, saveLanguage } from '../lib/languageStorage';

interface LanguageContextValue {
  language: AppLanguage;
  setLanguage: (lang: AppLanguage) => void;
}

const LanguageContext = createContext<LanguageContextValue>({
  language: 'en',
  setLanguage: () => {},
});

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguageState] = useState<AppLanguage>('en');

  useEffect(() => {
    getLanguage().then(setLanguageState);
  }, []);

  function setLanguage(lang: AppLanguage) {
    setLanguageState(lang);
    saveLanguage(lang);
  }

  return (
    <LanguageContext.Provider value={{ language, setLanguage }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  return useContext(LanguageContext);
}
