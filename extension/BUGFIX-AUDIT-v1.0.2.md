# Extension OpenPulsechain — Audit Correctif v1.0.2

**Date** : 2026-04-08
**Scope** : Audit complet du module Safety + composants dépendants
**Déclencheur** : Crash écran noir lors de la recherche PMEME dans Token Safety
**Résultat** : 10 bugs identifiés, 10 corrigés

---

## Synthèse exécutive

L'extension v1.0.1 publiée sur le Chrome Web Store présentait un défaut architectural critique : **aucun Error Boundary React**. Toute exception non gérée durant le rendu cassait silencieusement l'intégralité du popup (écran noir). Cette fragilité masquait 9 bugs supplémentaires dans le parsing des réponses API, les notifications, et l'affichage des données.

---

## Bug #1 — Error Boundary manquant (CRITIQUE)

**Fichier** : `src/popup/App.tsx`
**Ligne** : Composant racine `App()`

**Source du problème** :
React sans Error Boundary crashe silencieusement : si un composant enfant lève une exception pendant le render, React démonte tout l'arbre → le popup affiche un div vide (écran noir). Aucun message d'erreur, aucun moyen de récupérer.

**Impact** : Chaque bug ci-dessous pouvait provoquer un écran noir complet.

**Correction** :
Ajout d'une classe `ErrorBoundary` (React class component avec `getDerivedStateFromError` + `componentDidCatch`) qui wrape le contenu de `App()`. En cas de crash, affiche un message "Something went wrong" avec le message d'erreur et un bouton "Try again" qui reset l'état.

```tsx
class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null }
  static getDerivedStateFromError(error: Error) { return { error } }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[OpenPulsechain] React crash:', error, info.componentStack)
  }
  render() {
    if (this.state.error) {
      return (/* message d'erreur + bouton retry */)
    }
    return this.props.children
  }
}
```

**Vérification** : Toute exception future affiche un message au lieu d'un écran noir.

---

## Bug #2 — Parsing alertes : `data.alerts` au lieu de `data.data` (CRITIQUE)

**Fichier** : `src/background/service-worker.ts`
**Ligne** : 108 (avant correction)

**Source du problème** :
L'API `GET /api/v1/alerts/recent` retourne `{ "data": [...], "count": N }`.
Le code lisait `data.alerts` — un champ qui **n'existe pas** dans la réponse.

```typescript
// AVANT (bug)
const alerts = data.alerts || []
// → alerts toujours [] car data.alerts === undefined
```

**Impact** : Le badge de notification et les alertes push ne fonctionnaient **jamais**. Le service worker interrogeait l'API toutes les 5 minutes mais ignorait systématiquement les résultats.

**Correction** :
```typescript
// APRÈS
const alerts = data.data || data.alerts || []
```

**Preuve API** :
```json
// GET /api/v1/alerts/recent?limit=3
{ "data": [{ "id": 749, "alert_type": "whale_dump", ... }], "count": 749 }
// → "data" existe, "alerts" n'existe pas
```

**Vérification** : `curl -s "https://safety.openpulsechain.com/api/v1/alerts/recent?limit=3" | python3 -c "import json,sys; d=json.load(sys.stdin); print('data' in d, 'alerts' in d)"` → `True False`

---

## Bug #3 — Filtre notifications : `alert_level` au lieu de `severity` (CRITIQUE)

**Fichier** : `src/background/service-worker.ts`
**Ligne** : 126 (avant correction)

**Source du problème** :
Le code filtrait les alertes critiques avec `a.alert_level` mais l'API retourne `a.severity`.

```typescript
// AVANT (bug)
const critical = newAlerts.filter(
  (a: { alert_level: string }) => a.alert_level === 'critical' || a.alert_level === 'high'
)
// → critical toujours [] car alert_level n'existe pas
```

**Impact** : Même si le bug #2 était corrigé, les notifications push pour les alertes critiques (rug pulls, whale dumps) ne se déclenchaient **jamais**.

**Correction** :
```typescript
// APRÈS
const critical = newAlerts.filter(
  (a: { severity: string }) => a.severity === 'critical' || a.severity === 'high'
)
```

**Preuve API** :
```json
{ "id": 749, "severity": "high", "alert_type": "whale_dump" }
// → "severity" existe, "alert_level" n'existe pas
```

---

## Bug #4 — Notification token_symbol inexistant (MEDIUM)

**Fichier** : `src/background/service-worker.ts`
**Ligne** : 133 (avant correction)

**Source du problème** :
Le code accédait à `alert.token_symbol` et `alert.detail` pour construire la notification, mais ces champs n'existent pas sur l'objet `ScamAlert`. L'info du token est dans `alert.data` (JSON stringifié).

```typescript
// AVANT (bug)
title: `Scam Alert: ${alert.token_symbol || 'Unknown Token'}`,
message: alert.detail || `${alert.alert_type} detected`,
// → Toujours "Unknown Token" et message générique
```

**Impact** : Notifications inutiles car aucune info identifiable sur le token.

**Correction** :
```typescript
// APRÈS — parse alert.data pour extraire le symbole
let tokenInfo = ''
try {
  const parsed = typeof alert.data === 'string' ? JSON.parse(alert.data) : alert.data
  tokenInfo = parsed?.token_symbol || parsed?.token_address?.slice(0, 10) || ''
} catch { /* ignore */ }
title: `Scam Alert: ${tokenInfo || 'Unknown Token'}`,
message: `${alert.alert_type} detected (${alert.severity})`,
```

---

## Bug #5 — `cves.length` sans optional chaining (HIGH)

**Fichier** : `src/background/service-worker.ts`
**Ligne** : 92 (avant correction)

**Source du problème** :
L'API `/api/v1/chrome-security` peut ne pas retourner le champ `cves`. Le code accédait `cves.length` sans vérifier que `cves` existe.

```typescript
// AVANT (bug)
message: `...${cves.length ? ` (${cves.join(', ')})` : ''}.`
// → TypeError: Cannot read property 'length' of undefined
```

**Impact** : Crash silencieux du service worker si l'API ne retourne pas `cves`. Le worker redémarre au prochain alarm mais perd son état.

**Correction** :
```typescript
// APRÈS
message: `...${cves?.length ? ` (${cves.join(', ')})` : ''}.`
```

---

## Bug #6 — Nom du token jamais affiché : `token_symbol` vs `symbol` (HIGH)

**Fichier** : `src/popup/components/SafetyCheck.tsx` + `src/lib/api.ts`
**Lignes** : SafetyCheck 319-322, api.ts interface SafetyScore

**Source du problème** :
L'API Safety retourne **deux champs distincts** pour le nom du token :
- `token_symbol: null` (toujours null dans la réponse actuelle)
- `symbol: "PMEME"` (le vrai nom, champ séparé)

L'interface TypeScript ne déclarait que `token_symbol`. Le code faisait :
```typescript
// AVANT (bug)
safety.token_symbol || getSymbol(safety.token_address) || shortenAddress(safety.token_address)
// → null || undefined (pas dans registry) || "0xac47...da2b"
// → Affiche l'adresse tronquée au lieu de "PMEME"
```

**Impact** : Pour tous les tokens non présents dans le registre local (90%+ des tokens), le nom n'était jamais affiché. L'utilisateur voyait une adresse hexadécimale au lieu du symbole.

**Correction** :

1. Interface `SafetyScore` mise à jour :
```typescript
token_symbol?: string | null
token_name?: string | null
symbol?: string | null
name?: string | null
```

2. Helper `getDisplaySymbol()` ajouté :
```typescript
function getDisplaySymbol(safety: { token_address: string; token_symbol?: string | null; symbol?: string | null }): string {
  return safety.token_symbol || safety.symbol || getSymbol(safety.token_address) || shortenAddress(safety.token_address)
}
```

**Preuve API** :
```json
{
  "token_symbol": null,
  "symbol": "PMEME",
  "name": "Pulse Meme"
}
```

---

## Bug #7 — Aucune validation des données avant render (CRITIQUE)

**Fichier** : `src/popup/components/SafetyCheck.tsx`
**Ligne** : 211-213 (avant correction)

**Source du problème** :
Le résultat de `getTokenSafety()` était passé directement à `setSafety()` sans validation. Si l'API retournait un objet avec des champs manquants, `undefined`, ou de mauvais type, le render crashait.

```typescript
// AVANT (bug)
const result = await Promise.race([getTokenSafety(addr), timeout])
if (!result) throw new Error('Token not found')
setSafety(result) // ← aucune validation de structure
```

**Impact** : Crash React sur tout token dont la réponse API a des champs inattendus (null au lieu de number, string au lieu d'array, etc.)

**Correction** :
```typescript
// APRÈS — validation + normalisation
if (!result || typeof result.score !== 'number' || !result.token_address) {
  throw new Error('Token not found or not yet analyzed')
}
result.risks = Array.isArray(result.risks) ? result.risks : []
result.contract_dangers = Array.isArray(result.contract_dangers) ? result.contract_dangers : []
result.score = Number(result.score) || 0
result.honeypot_score = Number(result.honeypot_score) || 0
result.contract_score = Number(result.contract_score) || 0
result.lp_score = Number(result.lp_score) || 0
result.holders_score = Number(result.holders_score) || 0
result.holder_count = Number(result.holder_count) || 0
result.top1_pct = Number(result.top1_pct) || 0
result.top10_pct = Number(result.top10_pct) || 0
result.total_liquidity_usd = Number(result.total_liquidity_usd) || 0
result.age_days = Number(result.age_days) || 0
setSafety(result)
```

---

## Bug #8 — `cachedFetch` crash sur réponse non-JSON (HIGH)

**Fichier** : `src/lib/api.ts`
**Ligne** : 121 (avant correction)

**Source du problème** :
`res.json()` lève une exception si le corps de la réponse n'est pas du JSON valide (page d'erreur HTML, timeout Cloudflare, etc.). Aucun try/catch autour.

```typescript
// AVANT (bug)
const data = await res.json() // → SyntaxError si réponse HTML
```

**Impact** : Exception non gérée propagée jusqu'au composant → crash React → écran noir.

**Correction** :
```typescript
// APRÈS
let data: unknown
try {
  data = await res.json()
} catch {
  throw new Error('API returned invalid JSON')
}
```

---

## Bug #9 — `parseInt`/`parseFloat` sans NaN guard (MEDIUM)

**Fichier** : `src/popup/components/TokenDetail.tsx`
**Ligne** : 185-186 (avant correction)

**Source du problème** :
`parseInt()` et `parseFloat()` retournent `NaN` si l'entrée est invalide. `NaN.toLocaleString()` ne crash pas mais affiche "NaN". Plus grave, des calculs avec NaN propagent NaN partout.

```typescript
// AVANT (bug)
fakeHolders: fakeInfo?.holders ? parseInt(fakeInfo.holders) : 0,
// → Si holders = "abc", parseInt retourne NaN
```

**Correction** :
```typescript
// APRÈS
const parsedHolders = parseInt(fakeInfo?.holders)
fakeHolders: Number.isFinite(parsedHolders) ? parsedHolders : 0,
```

---

## Bug #10 — Division par zéro dans Dashboard (MEDIUM)

**Fichier** : `src/popup/components/Dashboard.tsx`
**Ligne** : 114 (avant correction)

**Source du problème** :
Le calcul du % de variation 30 jours divisait par `oldest` sans vérifier que `oldest > 0`.

```typescript
// AVANT (bug)
const pct = (amount / oldest) * 100
// → Si oldest === 0, pct = Infinity ou -Infinity
```

**Impact** : Affichage "Infinity%" dans la carte wallet du dashboard.

**Correction** :
```typescript
// APRÈS
const pct = oldest > 0 ? (amount / oldest) * 100 : 0
```

---

## Matrice de vérification

| # | Test | Commande / Méthode | Résultat attendu | Statut |
|---|------|-------------------|-------------------|--------|
| 1 | Error Boundary render | Provoquer une exception dans un composant | Message d'erreur + bouton retry | ✅ |
| 2 | Alerts chargement | `curl /api/v1/alerts/recent` → parse `data.data` | Alertes affichées dans le badge | ✅ |
| 3 | Alerts severity filter | Vérifier `a.severity` vs `a.alert_level` | Notifications critiques envoyées | ✅ |
| 4 | Notification token info | Parse `alert.data` JSON → `token_symbol` | Notification avec nom du token | ✅ |
| 5 | CVEs optional chaining | API sans champ `cves` | Pas de crash service worker | ✅ |
| 6 | PMEME symbol display | Chercher PMEME → vérifier affichage nom | "PMEME" affiché (pas "0xac47...") | ✅ |
| 7 | Validation données safety | API avec champs null/manquants | Normalisation → render sans crash | ✅ |
| 8 | Non-JSON response | API retourne HTML (erreur 502) | Message "API returned invalid JSON" | ✅ |
| 9 | NaN guard TokenDetail | `parseInt("abc")` → `Number.isFinite` | Affiche 0 au lieu de NaN | ✅ |
| 10 | Division par zéro Dashboard | `oldest = 0` → `pct` | Affiche 0% au lieu de Infinity% | ✅ |

---

## Tests API effectués

```
TEST 1: PMEME Safety → token_symbol=null, symbol="PMEME" → display="PMEME" ✅
TEST 2: HEX Safety → score=100, grade=A → display="HEX" ✅
TEST 3: Token inexistant → score=10, grade=F → render sans crash ✅
TEST 4: Alerts → clé "data" (pas "alerts"), severity (pas alert_level) ✅
TEST 5: Batch endpoint → 10 champs conformes à BatchEntry ✅
TEST 6: Deployer → dead_ratio=0.0, risk_level="unknown" ✅
```

---

## Fichiers modifiés

| Fichier | Modifications |
|---------|--------------|
| `src/popup/App.tsx` | + ErrorBoundary class component |
| `src/popup/components/SafetyCheck.tsx` | + `getDisplaySymbol()`, validation données, null checks `?? 0` |
| `src/popup/components/TokenDetail.tsx` | + `Number.isFinite()` guards |
| `src/popup/components/Dashboard.tsx` | + `oldest > 0` guard |
| `src/lib/api.ts` | + `symbol`/`name` dans SafetyScore, `pair_address` nullable, try/catch JSON |
| `src/background/service-worker.ts` | + `data.data`, `a.severity`, `cves?.length`, parse `alert.data` |

---

## Build

```
TypeScript: 0 erreurs
Vite build: ✓ built in 1.17s
```
