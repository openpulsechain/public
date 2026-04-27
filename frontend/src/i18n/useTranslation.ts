import { useContext } from 'react'
import { LanguageContext } from './LanguageContext'

export function useTranslation() {
  const ctx = useContext(LanguageContext)
  return ctx
}
