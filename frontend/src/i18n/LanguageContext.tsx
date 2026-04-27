import { createContext, useState, useCallback, type ReactNode } from 'react'
import { en } from './translations/en'
import { fr } from './translations/fr'

export type Language = 'en' | 'fr'
export type Translations = typeof en

const translations: Record<Language, Translations> = { en, fr }

interface LanguageContextType {
  language: Language
  setLanguage: (lang: Language) => void
  t: Translations
}

export const LanguageContext = createContext<LanguageContextType>({
  language: 'en',
  setLanguage: () => {},
  t: en,
})

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLang] = useState<Language>(() => {
    const saved = localStorage.getItem('openpulsechain_lang') as Language | null
    return saved === 'fr' ? 'fr' : 'en'
  })

  const setLanguage = useCallback((lang: Language) => {
    setLang(lang)
    localStorage.setItem('openpulsechain_lang', lang)
  }, [])

  return (
    <LanguageContext.Provider value={{ language, setLanguage, t: translations[language] }}>
      {children}
    </LanguageContext.Provider>
  )
}
