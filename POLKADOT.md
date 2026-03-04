# IntentBridge — Intent-Based Cross-Chain Bridge Polkadot → HyperEVM avec Settlement Trustless

## TL;DR

Protocole de bridge cross-chain **intent-based** entre Polkadot Asset Hub et HyperEVM (Hyperliquid) qui permet des transferts quasi-instantanés (~2s) avec un settlement trustless en arrière-plan (~6-8 min). L'utilisateur lock ses USDC dans un escrow `IntentGateway` sur Asset Hub, un **filler** (LP) détecte l'intent et front les fonds côté HyperEVM via `fillOrder()`, puis le settlement s'effectue automatiquement via **XCM v5 → Hyperbridge → ZK proof BEEFY → ISMP → HyperEVM**. Le filler récupère les fonds lockés + ses fees une fois la preuve vérifiée on-chain. L'utilisateur, lui, a déjà ses USDC et peut trader sur Hyperliquid **immédiatement**. Si aucun filler n'est disponible, le protocole bascule automatiquement en **bridge classique trustless** (~6-8 min) — les fonds sont envoyés directement à l'utilisateur via le même pipeline ZK, sans intermédiaire.

Le modèle s'inspire des architectures intent-based (ERC-7683, Across Protocol) mais adapté à l'écosystème Polkadot ↔ Hyperliquid, en exploitant les primitives natives : XCM v5 pour le messaging cross-chain, Hyperbridge comme couche d'interopérabilité trustless, et les preuves ZK BEEFY pour la vérification de consensus Polkadot côté EVM.

---

## Le Concept (Intent-Based Bridging)

```
Le problème :
  Les bridges classiques imposent une attente de ~15-45 min (finalité + relay + vérification).
  → L'utilisateur ne peut pas trader immédiatement après un bridge.
  → UX catastrophique pour un trader qui veut entrer en position rapidement.

La solution IntentBridge :
  Séparer l'exécution immédiate du settlement trustless.
  → L'utilisateur reçoit ses fonds en ~2s grâce à un filler (LP).
  → Le settlement (preuve + libération escrow) se fait en arrière-plan (~6-8 min).

Concrètement :
  Alice veut bridge 100 USDC de Polkadot Asset Hub vers HyperEVM.
  → Alice lock 100 USDC dans l'escrow IntentGateway sur Asset Hub
  → Un filler détecte l'intent (event OrderPlaced)
  → Le filler appelle fillOrder() sur HyperEVM → Alice reçoit 100 USDC instantanément
  → Alice trade sur Hyperliquid immédiatement
  → EN ARRIÈRE-PLAN : XCM v5 → Hyperbridge → ZK proof BEEFY → ISMP → HyperEVM
  → Le contrat source vérifie la preuve et libère l'escrow vers le filler
  → Le filler récupère 100 USDC + ses fees
```

```
Comparaison des approches :

| Critère               | Bridge classique (lock & mint) | Bridge optimistic (relay)    | IntentBridge (intent-based)     |
|-----------------------|-------------------------------|-----------------------------|---------------------------------|
| Temps pour l'user     | 15-45 min                     | 2-10 min (+ challenge)      | ~2 secondes                     |
| Trust assumption      | Comité de validators          | Watcher honnête (1-of-N)    | Trustless (ZK proof BEEFY)      |
| Capital efficiency    | Faible (mint/burn)            | Moyenne (bonding)           | Haute (fillers compétitifs)     |
| UX trading            | Impossible pendant le bridge  | Attente réduite             | Trade immédiat                  |
| Settlement            | On-chain sync                 | Optimistic + challenge      | ZK proof async (~6-8 min)       |
| Fallback si pas de LP | N/A                           | N/A                         | Bridge classique auto (~6-8 min)|
```

**Pourquoi intent-based** : L'utilisateur exprime une *intention* ("je veux 100 USDC sur HyperEVM") et le marché (fillers/LPs) se charge de l'exécuter. Le settlement trustless garantit que le filler est toujours remboursé — pas de risque de perte de fonds. Les fillers sont en compétition sur les fees → meilleur prix pour l'utilisateur.

**Le coût** : Les fees du filler — typiquement 5-30 bps selon la liquidité disponible et la taille de l'ordre. C'est le prix de l'instantanéité. Plus il y a de fillers en compétition, plus les fees baissent.

**Fallback : bridge classique si aucun filler disponible** : Le protocole ne dépend pas de la présence de fillers pour fonctionner. Si aucun filler ne remplit l'intent avant le deadline, le système bascule automatiquement en mode **bridge classique trustless** — les fonds suivent le pipeline complet XCM v5 → Hyperbridge → ZK proof BEEFY → ISMP → HyperEVM, et l'utilisateur reçoit ses fonds directement après le settlement (~6-8 min). Pas d'instantanéité, mais pas de blocage non plus. Les fillers sont une **couche d'accélération optionnelle**, pas une dépendance.

```
Deux modes de fonctionnement :

Mode A — Intent-Based (filler disponible) :
  T+0s    Alice lock 100 USDC sur Asset Hub
  T+2s    Filler détecte + fillOrder() → Alice reçoit 100 USDC sur HyperEVM
  T+2s    Alice trade immédiatement sur Hyperliquid
  T+7min  Settlement trustless → filler remboursé + fees
  → Coût : fees filler (~5-30 bps)
  → UX : instantanée

Mode B — Bridge Classique (aucun filler disponible) :
  T+0s    Alice lock 100 USDC sur Asset Hub
  T+...   Aucun filler ne fill l'intent
  T+30s   Le système détecte l'absence de fill → bascule en mode direct
  T+1min  XCM v5 initie le transfer direct
  T+3min  Hyperbridge génère la preuve ZK BEEFY
  T+5min  ISMP relaie vers HyperEVM
  T+7min  Alice reçoit ses 100 USDC sur HyperEVM (directement depuis le pipeline)
  → Coût : 0 fees filler (juste les frais réseau)
  → UX : ~6-8 min d'attente (bridge classique trustless)

Le frontend affiche le mode actif :
  → "Searching for filler..." (pendant la fenêtre d'attente filler)
  → "Filler found! Instant delivery" OU "No filler available — classic bridge (~7 min)"
```

---

## Architecture Globale

```
  ┌──────────────────────────────────────────────────────────────────────────┐
  │                    Polkadot Asset Hub (Source Chain)                      │
  │                                                                          │
  │  ┌────────────────────────────────────────────────────────────────────┐  │
  │  │                     IntentGateway (Escrow)                         │  │
  │  │                                                                    │  │
  │  │  ┌──────────────┐  ┌──────────────┐  ┌─────────────────────────┐  │  │
  │  │  │ createOrder() │  │  OrderStore  │  │  releaseEscrow()        │  │  │
  │  │  │ (lock USDC)   │  │  (intents)   │  │  (après ZK proof)      │  │  │
  │  │  └──────────────┘  └──────────────┘  └─────────────────────────┘  │  │
  │  └────────────────────────────────────────────────────────────────────┘  │
  │                                                                          │
  │  Event: OrderPlaced(orderId, user, amount, destChain, feeOffer)          │
  └──────────────────────┬───────────────────────────────────────────────────┘
                         │
                         │  ① User lock USDC
                         │
                         ▼
  ┌──────────────────────────────────────────────────────────────────────────┐
  │                         Filler Network (Off-Chain)                       │
  │                                                                          │
  │  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────────┐   │
  │  │  Filler A (LP)   │  │  Filler B (LP)   │  │  Filler C (LP)      │   │
  │  │  Watch events    │  │  Watch events    │  │  Watch events       │   │
  │  │  Compete on fees │  │  Compete on fees │  │  Compete on fees    │   │
  │  └──────────────────┘  └──────────────────┘  └──────────────────────┘   │
  └──────────────────────┬───────────────────────────────────────────────────┘
                         │
                         │  ② Filler détecte l'intent + front les fonds
                         │
                         ▼
  ┌──────────────────────────────────────────────────────────────────────────┐
  │                       HyperEVM (Destination Chain)                       │
  │                                                                          │
  │  ┌────────────────────────────────────────────────────────────────────┐  │
  │  │                     IntentSettler (Settlement)                      │  │
  │  │                                                                    │  │
  │  │  ┌──────────────┐  ┌──────────────┐  ┌─────────────────────────┐  │  │
  │  │  │ fillOrder()   │  │  FillStore   │  │  verifySettlement()     │  │  │
  │  │  │ (pay user)    │  │  (fills)     │  │  (ZK proof BEEFY)      │  │  │
  │  │  └──────────────┘  └──────────────┘  └─────────────────────────┘  │  │
  │  └────────────────────────────────────────────────────────────────────┘  │
  │                                                                          │
  │  → Alice reçoit 100 USDC instantanément                                  │
  │  → Alice trade sur Hyperliquid immédiatement                             │
  └──────────────────────────────────────────────────────────────────────────┘

  ┌──────────────────────────────────────────────────────────────────────────┐
  │              Settlement Trustless (Arrière-Plan ~6-8 min)                │
  │                                                                          │
  │  XCM v5 (Asset Hub)                                                      │
  │      │                                                                   │
  │      ▼                                                                   │
  │  Hyperbridge (Interop Layer)                                             │
  │      │                                                                   │
  │      ▼                                                                   │
  │  ZK Proof BEEFY (Consensus Polkadot vérifié côté EVM)                   │
  │      │                                                                   │
  │      ▼                                                                   │
  │  ISMP (Interoperable State Machine Protocol)                             │
  │      │                                                                   │
  │      ▼                                                                   │
  │  HyperEVM → verifySettlement() → preuve valide → signal à Asset Hub      │
  │      │                                                                   │
  │      ▼                                                                   │
  │  Asset Hub → releaseEscrow() → filler récupère USDC + fees              │
  └──────────────────────────────────────────────────────────────────────────┘
```

---

## Pourquoi Polkadot × Hyperliquid ?

| Critère | Bridge classique (Wormhole, etc.) | IntentBridge (Polkadot → HyperEVM) |
|---------|----------------------------------|-------------------------------------|
| **Temps utilisateur** | 15-45 min (attente finalité + relay) | ~2 secondes (filler front les fonds) |
| **Settlement** | Synchronous (bloquant) | Asynchronous trustless (~6-8 min, non-bloquant) |
| **Trust model** | Comité multisig / guardian set | ZK proof BEEFY (trustless, vérifiable on-chain) |
| **Messaging** | Custom relay / oracle | XCM v5 natif (Polkadot native) |
| **Interop layer** | Propriétaire | Hyperbridge (open, ISMP-based) |
| **Capital efficiency** | Lock/mint (capital immobilisé) | Fillers compétitifs (capital rotatif) |
| **Proof system** | Souvent optimistic (challenge period) | ZK BEEFY (aucun challenge, vérification directe) |
| **Destination** | Chaîne EVM générique | HyperEVM → accès direct Hyperliquid (perps, spot) |

**Avantages clés de cette stack :**
- XCM v5 est le standard natif de messaging cross-chain dans l'écosystème Polkadot — battle-tested, upgradé régulièrement, et supporté par toutes les parachains
- Hyperbridge utilise ISMP pour une interopérabilité trustless entre Polkadot et les chaînes EVM — pas de comité multisig, pas de guardian set
- Les preuves ZK BEEFY permettent de vérifier le consensus Polkadot directement sur un contrat EVM — settlement cryptographiquement garanti
- HyperEVM donne un accès direct à l'orderbook Hyperliquid — l'utilisateur peut ouvrir des positions perps instantanément après le bridge
- Le modèle intent-based permet une UX comparable à un CEX (fonds disponibles en secondes) avec les garanties d'un bridge trustless

---

## Smart Contracts — Architecture Détaillée

### 1. IntentGateway (Polkadot Asset Hub — Escrow Source)

Le point d'entrée côté source. Gère la création des ordres (intents), le lock des fonds en escrow, et la libération des fonds vers le filler après vérification de la preuve de settlement.

**Structure d'un ordre (`Order`) :**
```
struct Order {
    orderId:       bytes32     // Hash unique de l'intent
    user:          address     // Adresse de l'utilisateur sur Asset Hub
    token:         address     // Token locké (USDC)
    amount:        uint256     // Montant locké
    destChain:     uint32      // Chain ID destination (HyperEVM)
    destAddress:   address     // Adresse de l'utilisateur sur HyperEVM
    feeOffer:      uint256     // Fee offerte au filler (en USDC)
    deadline:      uint256     // Expiration de l'intent
    status:        OrderStatus // Pending → Filled → Settled → Expired | Pending → Fallback → Settled
}
```

**Fonctions :**

| Fonction | Description |
|----------|-------------|
| `createOrder(token, amount, destChain, destAddress, feeOffer, deadline)` | Lock les fonds en escrow, émet `OrderPlaced`, retourne `orderId` |
| `releaseEscrow(orderId, fillerAddress, proof)` | Vérifie la preuve ZK BEEFY via Hyperbridge, libère les fonds lockés + fees vers le filler |
| `executeFallback(orderId)` | Déclenché si aucun filler n'a fill l'intent après `FILLER_WINDOW`. Initie le bridge classique : XCM v5 → Hyperbridge → ISMP → fonds envoyés directement à l'utilisateur côté HyperEVM. Pas de fee filler. |
| `cancelOrder(orderId)` | Annulation par l'utilisateur si deadline dépassée et ordre non rempli (status Pending) |
| `getOrder(orderId)` | Vue : retourne les détails complets d'un ordre |
| `getActiveOrders()` | Vue : liste tous les ordres Pending (pour les fillers) |

**Events :**
```
OrderPlaced(orderId, user, token, amount, destChain, destAddress, feeOffer, deadline)
OrderCancelled(orderId, user, refundAmount)
EscrowReleased(orderId, fillerAddress, amount, fee)
FallbackExecuted(orderId, user, amount, destAddress)
```

**Sécurité :**
```
→ Les fonds sont lockés dans le contrat — l'utilisateur ne peut pas les retirer tant que l'ordre est Pending et non expiré
→ releaseEscrow() ne peut être appelé qu'avec une preuve valide vérifiée par le module Hyperbridge/ISMP
→ cancelOrder() n'est possible qu'après deadline ET si status == Pending
→ Double-fill protection : un orderId ne peut être rempli qu'une seule fois
→ ReentrancyGuard sur toutes les fonctions mutatives
→ FILLER_WINDOW (ex: 30s) : fenêtre pendant laquelle les fillers peuvent fill l'intent
  → Après FILLER_WINDOW sans fill : executeFallback() devient callable (permissionless)
  → executeFallback() initie le bridge classique trustless (XCM v5 → Hyperbridge → ISMP)
  → L'utilisateur reçoit ses fonds directement sur HyperEVM après le settlement (~6-8 min)
  → Pas de fee filler en mode fallback — l'intégralité du montant est bridgé
  → Un fill qui arrive APRÈS executeFallback() est rejeté (status déjà Fallback)
```

### 2. IntentSettler (HyperEVM — Settlement Destination)

Contrat déployé sur HyperEVM qui gère le fill des ordres par les fillers et la vérification du settlement trustless.

**Structure d'un fill (`Fill`) :**
```
struct Fill {
    orderId:       bytes32     // Référence à l'ordre source
    filler:        address     // Adresse du filler sur HyperEVM
    recipient:     address     // Adresse de l'utilisateur sur HyperEVM
    token:         address     // Token envoyé (USDC sur HyperEVM)
    amount:        uint256     // Montant envoyé à l'utilisateur (amount - feeOffer)
    fillTimestamp: uint256     // Timestamp du fill
    settled:       bool        // True après vérification de la preuve
}
```

**Fonctions :**

| Fonction | Description |
|----------|-------------|
| `fillOrder(orderId, recipient, token, amount)` | Le filler front les fonds → l'utilisateur reçoit ses USDC instantanément. Émet `OrderFilled` |
| `verifySettlement(orderId, proof)` | Vérifie la preuve ZK BEEFY via ISMP, marque le fill comme settled, envoie le signal de release à Asset Hub |
| `getFill(orderId)` | Vue : retourne les détails d'un fill |
| `getPendingSettlements()` | Vue : liste les fills non encore settled (pour les relayers) |

**Events :**
```
OrderFilled(orderId, filler, recipient, token, amount, fillTimestamp)
SettlementVerified(orderId, filler, proofHash)
```

**Sécurité :**
```
→ fillOrder() vérifie que l'orderId n'a pas déjà été rempli (double-fill protection)
→ fillOrder() vérifie que le filler a suffisamment de fonds pour couvrir le montant
→ verifySettlement() ne peut réussir qu'avec une preuve ZK BEEFY valide
→ Le filler prend un risque temporaire (~6-8 min) : il front les fonds avant le settlement
→ Si le settlement échoue (preuve invalide), le filler ne récupère pas ses fonds lockés côté source
→ ReentrancyGuard + Pausable pour les cas d'urgence
```

### 3. FillerRegistry (HyperEVM — Registre des Fillers)

Contrat optionnel de registre pour les fillers. Permet aux utilisateurs de vérifier la réputation et la liquidité des fillers actifs.

| Fonction | Description |
|----------|-------------|
| `register(stake)` | Un filler stake des USDC comme garantie de solvabilité |
| `unregister()` | Retrait du stake (cooldown period) |
| `slash(filler, orderId)` | Slash le stake si un filler ne settle pas (gouvernance) |
| `getFillerInfo(filler)` | Vue : stake, ordres remplis, taux de settlement, score |
| `getActiveFillers()` | Vue : liste des fillers actifs triés par score |

### 4. Settlement Pipeline — Modules

#### XCM v5 (Cross-Consensus Messaging)

Le protocole de messaging natif de Polkadot. Utilisé pour initier le processus de settlement depuis Asset Hub.

```
XCM v5 apporte :
  → Asset transfers trustless entre parachains
  → Programmabilité améliorée (Transact, ExchangeAsset)
  → Dry-run execution pour estimer les fees
  → Support natif d'Asset Hub comme hub de liquidité
```

#### Hyperbridge (Interoperability Layer)

Couche d'interopérabilité trustless entre Polkadot et les chaînes EVM. Utilise ISMP comme protocole de transport.

```
Hyperbridge :
  → Parachain Polkadot dédiée à l'interopérabilité
  → Vérifie le consensus Polkadot via preuves ZK BEEFY
  → Relaie les messages cross-chain via ISMP
  → Pas de comité multisig — vérification cryptographique pure
```

#### ZK Proof BEEFY (Bridge Efficiency Enabling Finality Yielder)

Le mécanisme de preuve qui permet de vérifier le consensus Polkadot sur une chaîne EVM.

```
BEEFY :
  → Protocole de finalité complémentaire à GRANDPA
  → Les validators Polkadot signent des commitment roots
  → Ces signatures sont agrégées et vérifiables via une preuve ZK
  → Un contrat EVM peut vérifier la preuve → confirmer que Asset Hub a bien locké les fonds
  → Trustless : pas besoin de faire confiance à un relayer, la preuve est auto-vérifiable
```

#### ISMP (Interoperable State Machine Protocol)

Le protocole de transport utilisé par Hyperbridge pour relayer les messages entre chaînes.

```
ISMP :
  → Protocole de messaging inter-chaîne basé sur des preuves d'état
  → Chaque message contient une preuve de l'état source
  → Le contrat destination vérifie la preuve avant d'exécuter le message
  → Compatible avec n'importe quelle chaîne capable de vérifier des preuves Merkle
```

### 5. Libraries & Utils

| Contrat | Description |
|---------|-------------|
| `OrderLib.sol` | Encoding/decoding des ordres, hash computation, status transitions |
| `ProofVerifier.sol` | Vérification des preuves ZK BEEFY, interface avec le module ISMP |
| `FeeCalculator.sol` | Calcul des fees dynamiques basé sur la liquidité disponible et la congestion |
| `Constants.sol` | `MIN_FEE_BPS = 5`, `MAX_FEE_BPS = 100`, `FILLER_WINDOW = 30`, `SETTLEMENT_TIMEOUT = 3600`, `MAX_ORDER_AMOUNT`, chain IDs |

---

## Que se passe-t-il quand Alice bridge 100 USDC ?

### Phase 1 — Exécution Instantanée (~2 secondes)

```
Step 1 : Alice appelle createOrder() sur IntentGateway (Asset Hub)
  → 100 USDC lockés dans l'escrow
  → Event OrderPlaced émis avec tous les paramètres de l'intent
  → orderId = keccak256(user, token, amount, destChain, destAddress, nonce)

Step 2 : Les fillers du réseau détectent l'event OrderPlaced
  → Filler A voit : 100 USDC, fee = 0.10 USDC, deadline = 30 min
  → Filler A a 100 USDC de liquidité sur HyperEVM → décide de fill

Step 3 : Filler A appelle fillOrder(orderId, alice, USDC, 100) sur IntentSettler (HyperEVM)
  → Alice reçoit 100 USDC sur HyperEVM instantanément
  → Event OrderFilled émis

Step 4 : Alice ouvre une position 10x long ETH sur Hyperliquid
  → Aucune attente — les fonds sont disponibles immédiatement
```

### Phase 2 — Settlement Trustless (~6-8 minutes, en arrière-plan)

```
Step 5 : XCM v5 initie le messaging depuis Asset Hub
  → Le message contient : orderId, preuve du lock, état de l'escrow
  → XCM route le message vers Hyperbridge (parachain)

Step 6 : Hyperbridge reçoit le message XCM
  → Hyperbridge attend la finalité BEEFY sur le block contenant le lock
  → Les validators Polkadot signent le commitment root du block
  → Hyperbridge génère la preuve ZK BEEFY

Step 7 : ISMP transporte la preuve vers HyperEVM
  → Le relayer Hyperbridge soumet la preuve au contrat ISMP sur HyperEVM
  → verifySettlement() est appelé sur IntentSettler

Step 8 : IntentSettler vérifie la preuve ZK BEEFY
  → Preuve valide → le fill est marqué comme settled
  → Signal envoyé à Asset Hub (via le même pipeline inverse)

Step 9 : IntentGateway reçoit la confirmation de settlement
  → releaseEscrow(orderId, fillerA) est exécuté
  → Filler A récupère 100 USDC + 0.10 USDC de fees
  → L'ordre passe en status Settled
```

**Important** : Alice n'attend pas le settlement. Elle a ses 100 USDC dès le Step 3 et peut trader immédiatement. Le settlement protège le filler — il est **toujours** remboursé tant que le lock est valide côté Asset Hub.

### Mode B — Aucun filler disponible (Bridge Classique Automatique)

```
Si aucun filler ne fill l'intent pendant le FILLER_WINDOW (~30s) :

Step 1 : Alice appelle createOrder() sur IntentGateway (Asset Hub)
  → 100 USDC lockés dans l'escrow
  → Event OrderPlaced émis

Step 2 : Le FILLER_WINDOW expire — aucun filler n'a répondu
  → L'ordre reste en status Pending

Step 3 : executeFallback(orderId) est appelé (permissionless — par Alice, un keeper, ou le frontend)
  → L'ordre passe en status Fallback
  → Event FallbackExecuted émis
  → Le contrat initie un transfer direct via XCM v5

Step 4 : XCM v5 → Hyperbridge → ZK proof BEEFY → ISMP → HyperEVM
  → Pipeline classique trustless, identique au settlement des fillers
  → Mais cette fois les fonds vont DIRECTEMENT à Alice (pas à un filler)

Step 5 : Le contrat FallbackReceiver sur HyperEVM reçoit les fonds
  → 100 USDC crédités à Alice sur HyperEVM
  → Aucune fee filler (Alice récupère 100% du montant)

Step 6 : Alice peut trader sur Hyperliquid
  → Délai total : ~6-8 minutes (bridge classique trustless)

Résumé :
  → Pas de filler = pas d'instantanéité, mais le bridge fonctionne quand même
  → Le protocole GARANTIT la livraison des fonds dans tous les cas
  → Le mode fallback est strictement trustless (ZK proof, aucun intermédiaire)
  → L'utilisateur ne paie aucune fee filler en mode fallback
```

**Race condition protection** : Si un filler appelle `fillOrder()` pendant que `executeFallback()` est en cours de traitement, le contrat IntentSettler vérifie le status de l'ordre. Un ordre en status `Fallback` rejette tout `fillOrder()`. Inversement, si un filler fill l'intent juste avant l'appel `executeFallback()`, l'ordre passe en status `Filled` et `executeFallback()` revert. Le status est atomique — il n'y a jamais de double délivrance.

---

## Modèle Économique des Fillers

```
Le filler est un LP qui fournit de la liquidité instantanée côté destination.

Revenue du filler :
  → Fees par ordre rempli (fixées par l'utilisateur dans feeOffer)
  → Volume × fee average = revenu journalier

Risques du filler :
  → Capital lock temporaire (~6-8 min entre fill et settlement)
  → Smart contract risk (bug dans IntentGateway ou IntentSettler)
  → Settlement failure (preuve invalide — extrêmement rare avec ZK BEEFY)

Capital efficiency :
  → Un filler avec 10,000 USDC peut fill ~100-200 ordres/jour
  → Rotation du capital : fill → settlement (~8 min) → capital libre → fill suivant
  → ~7.5 rotations/heure × 24h = ~180 rotations/jour théoriques

Compétition :
  → Les fillers sont en compétition pour remplir les ordres
  → Les ordres avec les fees les plus élevées sont remplis en premier
  → Plus il y a de fillers → fees plus basses → meilleur prix pour l'utilisateur
  → Équilibre naturel : les fees convergent vers le coût du capital + risque
```

```
Formule du rendement filler :

APR_filler = (avg_fee × fills_per_day × 365) / capital_deployed

Exemple :
  avg_fee = 0.10 USDC (10 bps sur 100 USDC)
  fills_per_day = 150
  capital = 10,000 USDC

  APR = (0.10 × 150 × 365) / 10,000 = 54.75%
```

---

## Fees & Distribution

```
Ordre de 100 USDC avec feeOffer = 0.10 USDC

Alice (User)                          Filler
  │                                     │
  │  lock 100 USDC                      │
  │  ────────────────────►              │
  │  (IntentGateway escrow)             │
  │                                     │
  │         fillOrder()                 │
  │  ◄────────────────────              │
  │  reçoit 100 USDC sur HyperEVM      │  dépense 100 USDC de sa liquidité
  │                                     │
  │  ~~ settlement trustless ~~         │
  │  ~~ (~6-8 min) ~~                  │
  │                                     │
  │                                     │  releaseEscrow()
  │                                     │  ◄──────────────
  │                                     │  récupère 100 USDC + 0.10 USDC fee
  │                                     │

Résultat :
  Alice : a payé 0.10 USDC de fee, reçu 100 USDC instantanément sur HyperEVM
  Filler : a immobilisé 100 USDC pendant ~8 min, gagné 0.10 USDC
```

**Fee dynamique (optionnel) :**
```
Le feeOffer est fixé par l'utilisateur, mais un module FeeCalculator peut suggérer :

suggested_fee = base_fee + congestion_premium + size_premium

Où :
  base_fee          = fee minimum viable pour les fillers (ex: 5 bps)
  congestion_premium = augmente si beaucoup d'ordres pending / peu de fillers actifs
  size_premium       = augmente pour les gros ordres (risque de capital plus élevé)

→ L'utilisateur peut overrider la suggestion et fixer sa propre fee
→ Une fee plus élevée = fill plus rapide (priorité des fillers)
→ Une fee trop basse = risque de ne pas être fill avant le deadline
```

---

## Settlement Pipeline — Détail Technique

```
┌─────────────────────────────────────────────────────────────────┐
│                    SETTLEMENT TIMELINE                           │
│                                                                 │
│  T+0s      Alice lock 100 USDC (IntentGateway, Asset Hub)       │
│  T+1s      Event OrderPlaced émis                               │
│  T+2s      Filler détecte + fillOrder() (HyperEVM)              │
│            → Alice a ses USDC, peut trader                      │
│                                                                 │
│  ─── SETTLEMENT EN ARRIÈRE-PLAN ───                             │
│                                                                 │
│  T+30s     Finalité du block Asset Hub (GRANDPA)                │
│  T+1min    BEEFY validators signent le commitment root          │
│  T+2min    Hyperbridge collecte les signatures BEEFY            │
│  T+3min    Hyperbridge génère la preuve ZK                      │
│  T+4min    ISMP relaie la preuve vers HyperEVM                  │
│  T+5min    verifySettlement() sur IntentSettler                  │
│  T+6min    Signal retour vers Asset Hub                         │
│  T+7min    releaseEscrow() → filler récupère ses fonds + fees   │
│                                                                 │
│  Total settlement : ~6-8 minutes                                │
│  Temps perçu par Alice : ~2 secondes                            │
└─────────────────────────────────────────────────────────────────┘
```

**Composants du pipeline :**

| Composant | Rôle | Latence |
|-----------|------|---------|
| XCM v5 | Messaging cross-consensus depuis Asset Hub | ~30s (finalité block) |
| GRANDPA | Finalité du block Polkadot | ~30s |
| BEEFY | Signatures des validators sur le commitment root | ~1-2 min |
| Hyperbridge | Agrégation signatures + génération preuve ZK | ~2-3 min |
| ISMP | Transport de la preuve vers HyperEVM | ~1 min |
| IntentSettler | Vérification on-chain de la preuve ZK | ~1 tx |
| Signal retour | Confirmation settlement vers Asset Hub | ~1-2 min |
| IntentGateway | Release de l'escrow | ~1 tx |

---

## Flow Utilisateur — Bridge (Asset Hub → HyperEVM)

```
Step 1: Connecter wallet (Polkadot.js, SubWallet, Talisman) sur Asset Hub
        + connecter wallet EVM (MetaMask, Rabby) sur HyperEVM
Step 2: Entrer le montant à bridge (ex: 100 USDC)
        → Conversion en fee suggérée, estimation du temps de fill
Step 3: Confirmer la transaction sur Asset Hub
        → createOrder() lock les USDC dans l'escrow
        → Event OrderPlaced émis → visible dans le dashboard
Step 4a (filler disponible): Fill en ~2s
        → Le dashboard passe à "Filling..." puis "Filled!"
        → Les USDC apparaissent sur HyperEVM instantanément
Step 4b (aucun filler): Fallback automatique
        → Après FILLER_WINDOW (~30s) : "No filler — classic bridge in progress..."
        → executeFallback() déclenché automatiquement
        → Pipeline XCM v5 → Hyperbridge → ZK BEEFY → ISMP
        → Les USDC arrivent sur HyperEVM après ~6-8 min
Step 5: Trader sur Hyperliquid
        → Ouvrir des positions perps, spot, etc.
Step 6: (Arrière-plan, Mode A uniquement) Settlement trustless
        → Le dashboard affiche la progression : XCM → Hyperbridge → ZK → ISMP → Settled
        → Le filler est remboursé automatiquement
```

---

## Flow Utilisateur — Bridge Retour (HyperEVM → Asset Hub)

```
Step 1: Sur le dashboard, sélectionner "Bridge Back"
Step 2: Entrer le montant à bridge retour (ex: 150 USDC — profit inclus)
        → createOrder() sur le contrat IntentGateway déployé côté HyperEVM
        → USDC lockés en escrow sur HyperEVM
Step 3: Un filler détecte l'intent et front les fonds sur Asset Hub
        → fillOrder() sur IntentSettler côté Asset Hub
        → L'utilisateur reçoit ses USDC sur Asset Hub
Step 4: Settlement trustless en arrière-plan (pipeline inverse)
        → HyperEVM → Hyperbridge → ZK proof → ISMP → Asset Hub
        → Le filler récupère ses fonds + fees
```

---

## Config Réseau

| Config | Valeur |
|--------|--------|
| **Source Chain** | Polkadot Asset Hub (parachain ID 1000) |
| **Destination Chain** | HyperEVM (Hyperliquid L1) |
| **Messaging** | XCM v5 (Polkadot native) |
| **Interop Layer** | Hyperbridge (parachain) |
| **Proof System** | ZK BEEFY (Polkadot consensus proofs) |
| **Transport** | ISMP (Interoperable State Machine Protocol) |
| **Token bridgé** | USDC (Asset Hub native) |
| **Settlement time** | ~6-8 minutes (non-bloquant pour l'utilisateur) |
| **Fill time** | ~2 secondes (dépend des fillers actifs) |

---

## Structure du Projet

```
intentbridge/
├── contracts/
│   ├── src/
│   │   ├── source/
│   │   │   ├── IntentGateway.sol          # Escrow source (Asset Hub), createOrder, releaseEscrow
│   │   │   └── OrderStore.sol             # Storage des ordres, status transitions
│   │   ├── destination/
│   │   │   ├── IntentSettler.sol           # Settlement destination (HyperEVM), fillOrder, verifySettlement
│   │   │   ├── FillStore.sol              # Storage des fills
│   │   │   ├── FallbackReceiver.sol       # Réception des fonds en mode bridge classique (pas de filler)
│   │   │   └── FillerRegistry.sol         # Registre optionnel des fillers, staking, réputation
│   │   ├── settlement/
│   │   │   ├── ProofVerifier.sol          # Vérification des preuves ZK BEEFY
│   │   │   ├── ISMPHandler.sol            # Interface avec le module ISMP de Hyperbridge
│   │   │   └── BEEFYVerifier.sol          # Vérification des commitment roots BEEFY
│   │   ├── libs/
│   │   │   ├── OrderLib.sol               # Encoding/decoding ordres, hash, status transitions
│   │   │   ├── FeeCalculator.sol          # Calcul fees dynamiques
│   │   │   └── Constants.sol              # Paramètres protocole, chain IDs, timeouts
│   │   └── interfaces/
│   │       ├── IIntentGateway.sol         # Interface escrow source
│   │       ├── IIntentSettler.sol         # Interface settlement destination
│   │       ├── IFillerRegistry.sol        # Interface registre fillers
│   │       ├── IISMP.sol                  # Interface ISMP (Hyperbridge)
│   │       └── IERC20.sol                 # Interface ERC-20 standard
│   ├── test/
│   │   ├── IntentGateway.t.sol            # Tests escrow : create, cancel, release, expiry, reentrancy
│   │   ├── IntentSettler.t.sol            # Tests settlement : fill, verify, double-fill, proof validation
│   │   ├── FillerRegistry.t.sol           # Tests registre : register, unregister, slash, scoring
│   │   ├── ProofVerifier.t.sol            # Tests preuves : valid proof, invalid proof, replay protection
│   │   └── FeeCalculator.t.sol            # Tests fees : base, congestion, size premium, edge cases
│   ├── script/
│   │   ├── DeployAssetHub.s.sol           # Déploiement IntentGateway sur Asset Hub
│   │   └── DeployHyperEVM.s.sol           # Déploiement IntentSettler + FillerRegistry sur HyperEVM
│   ├── foundry.toml
│   └── lib/
│       ├── forge-std/
│       └── openzeppelin-contracts/
│
├── filler/                                 # Service off-chain du filler
│   ├── src/
│   │   ├── index.ts                       # Entry point, event listener, fill logic
│   │   ├── watcher.ts                     # Watch OrderPlaced events sur Asset Hub
│   │   ├── executor.ts                    # Exécute fillOrder() sur HyperEVM
│   │   ├── settler.ts                     # Monitor settlement pipeline, trigger verifySettlement
│   │   ├── pricing.ts                     # Logique de fee evaluation (fill ou skip)
│   │   └── config.ts                      # RPC endpoints, clés, paramètres
│   ├── package.json
│   └── tsconfig.json
│
├── frontend/                               # Dashboard utilisateur
│   ├── src/
│   │   ├── App.tsx                        # Router principal, pages
│   │   ├── pages/
│   │   │   ├── BridgePage.tsx             # Interface de bridge (amount, fee, confirmation)
│   │   │   ├── DashboardPage.tsx          # Historique ordres, status settlement, positions
│   │   │   └── FillerPage.tsx             # Dashboard filler (P&L, ordres remplis, liquidité)
│   │   ├── components/
│   │   │   ├── OrderForm.tsx              # Formulaire de création d'ordre
│   │   │   ├── OrderTracker.tsx           # Suivi temps réel du settlement pipeline
│   │   │   ├── SettlementProgress.tsx     # Barre de progression XCM → BEEFY → ISMP → Settled (Mode A: filler / Mode B: fallback)
│   │   │   └── WalletConnect.tsx          # Connexion double wallet (Polkadot + EVM)
│   │   ├── hooks/
│   │   │   ├── useOrderEvents.ts          # Listen OrderPlaced / OrderFilled events
│   │   │   ├── useSettlementStatus.ts     # Track settlement progression
│   │   │   └── useFillerStats.ts          # Stats du filler (orders, revenue, capital)
│   │   └── config/
│   │       └── contracts.ts               # Adresses déployées, ABIs, chain configs
│   ├── package.json
│   └── vite.config.ts
│
├── README.md                               # Ce fichier
└── .gitignore
```

---

## Tests

### Suite de Tests

| Fichier | Tests | Description |
|---------|-------|-------------|
| `IntentGateway.t.sol` | Unit + Fuzz | Create order, cancel after deadline, release with valid proof, reject invalid proof, reentrancy, double release, expiry edge cases |
| `IntentSettler.t.sol` | Unit + Fuzz | Fill order, double-fill revert, verify settlement, invalid proof revert, settled status, fill after deadline revert |
| `FillerRegistry.t.sol` | Unit | Register, unregister cooldown, slash, score calculation, active fillers list |
| `ProofVerifier.t.sol` | Unit | Valid ZK BEEFY proof, invalid proof, tampered proof, replay attack protection |
| `FeeCalculator.t.sol` | Unit + Fuzz | Base fee, congestion premium, size premium, min/max bounds, fuzz input ranges |

```bash
# Lancer tous les tests
cd contracts && forge test -vvv

# Tests fuzz
forge test --match-test testFuzz -vvv

# Coverage
forge coverage
```

---

## Sécurité & Risques

### Protections Implémentées

```
1. Double-fill protection
   → Un orderId ne peut être fill qu'une seule fois
   → fillOrder() revert si le fill existe déjà

2. Deadline enforcement
   → L'utilisateur fixe un deadline à la création
   → Après deadline : cancelOrder() possible (remboursement intégral)
   → Avant deadline : annulation impossible (protection du filler)

3. Proof verification
   → releaseEscrow() requiert une preuve ZK BEEFY valide
   → La preuve est vérifiée on-chain par le module Hyperbridge/ISMP
   → Pas de trust assumption : vérification cryptographique pure

4. ReentrancyGuard
   → Toutes les fonctions mutatives sont protégées
   → Empêche les attaques de réentrance sur lock/release

5. Pausable
   → Le owner peut pauser les contrats en cas d'urgence
   → Utile en cas de bug découvert ou de comportement anormal

6. Filler staking (optionnel)
   → Les fillers stakent des USDC comme garantie
   → Slash possible en cas de comportement malveillant
   → Incite les fillers à être fiables
```

### Risques

```
1. Risque de liquidité filler
   → Si aucun filler n'a de liquidité → le système bascule en mode bridge classique (~6-8 min)
   → L'utilisateur reçoit toujours ses fonds — le fallback est automatique et trustless
   → Mitigation : fee dynamique incite de nouveaux fillers quand la liquidité est basse

2. Risque de settlement delay
   → Si Hyperbridge/BEEFY est lent → le filler attend plus longtemps pour le remboursement
   → Mitigation : le capital du filler est temporairement bloqué, pas perdu

3. Smart contract risk
   → Bug dans IntentGateway ou IntentSettler → perte de fonds possible
   → Mitigation : audits, tests fuzz, bug bounty, déploiement progressif

4. Risque XCM/Hyperbridge
   → Si la couche d'interop est down → le settlement est bloqué
   → Mitigation : timeout + fallback (cancel après deadline)

5. Risque de prix (pour le filler)
   → Le filler front des USDC stables → pas de risque de prix sur USDC
   → Risque uniquement si le token bridgé est volatile (non applicable pour USDC)
```

---

## Calculs Mathématiques Clés

### 1. Hash de l'ordre (orderId)

```
orderId = keccak256(abi.encodePacked(
    user,
    token,
    amount,
    destChain,
    destAddress,
    feeOffer,
    deadline,
    nonce
))

→ Unique par combinaison user + paramètres + nonce
→ Le nonce empêche les collisions si un user crée plusieurs ordres identiques
```

### 2. Fee dynamique suggérée

```
suggested_fee = base_fee + congestion_premium + size_premium

Où :
  base_fee           = MIN_FEE_BPS × amount / 10000    (ex: 5 bps = 0.05%)
  congestion_premium = pending_orders / active_fillers × CONGESTION_MULTIPLIER
  size_premium       = max(0, (amount - LARGE_ORDER_THRESHOLD) × SIZE_BPS / 10000)

Exemple pour 100 USDC, 10 ordres pending, 5 fillers actifs :
  base_fee           = 5 × 100 / 10000 = 0.05 USDC
  congestion_premium = 10/5 × 0.02 = 0.04 USDC
  size_premium       = 0 (sous le seuil)
  suggested_fee      = 0.09 USDC (~9 bps)
```

### 3. Capital efficiency du filler

```
capital_efficiency = fills_per_day / (capital / avg_order_size)

Avec settlement ~8 min :
  rotations_per_hour = 60 / 8 = 7.5
  rotations_per_day  = 7.5 × 24 = 180
  → Un capital de 10,000 USDC peut fill jusqu'à 1,800,000 USDC/jour

Rendement annualisé :
  APR = avg_fee_bps × rotations_per_day × 365 / 10000
  APR = 10 × 180 × 365 / 10000 = 65,700 bps = 657%

Note : rendement théorique maximum — en pratique limité par la demande réelle
```

---

## Déploiement

### Prérequis

```bash
# Installer Foundry
curl -L https://foundry.paradigm.xyz | bash
foundryup

# Installer Node.js (>= 18)
# Cloner le repo
git clone https://github.com/ton-org/intentbridge.git
cd intentbridge
```

### Contracts — Build & Test

```bash
cd contracts
forge install
forge build
forge test -vvv

# Coverage
forge coverage
```

### Contracts — Déploiement

```bash
cp .env.example .env
# Remplir PRIVATE_KEY, RPC_URL_ASSET_HUB, RPC_URL_HYPEREVM

# Déploiement IntentGateway (Asset Hub)
forge script script/DeployAssetHub.s.sol --rpc-url $RPC_ASSET_HUB --broadcast

# Déploiement IntentSettler + FillerRegistry (HyperEVM)
forge script script/DeployHyperEVM.s.sol --rpc-url $RPC_HYPEREVM --broadcast
```

### Filler — Run

```bash
cd filler
npm install
cp .env.example .env
# Remplir RPC endpoints, clés du filler, adresses des contrats

npm run start      # Démarre le service filler
npm run dev        # Mode développement avec hot reload
```

### Frontend — Dev & Build

```bash
cd frontend
npm install
npm run dev       # Dev server → http://localhost:3000
npm run build     # Build production → dist/
```

### Ordre de déploiement complet

```
Phase 1 — Contrats Source (Asset Hub) :
  1. IntentGateway.sol → Escrow + OrderStore
  2. Configurer les paramètres : token whitelist, timeouts

Phase 2 — Contrats Destination (HyperEVM) :
  1. IntentSettler.sol → Fill + Settlement verification
  2. FillerRegistry.sol → Registre fillers (optionnel)
  3. Configurer le lien ISMP avec Hyperbridge

Phase 3 — Filler Infrastructure :
  1. Déployer le service filler
  2. Alimenter le filler en USDC sur HyperEVM
  3. Register le filler dans FillerRegistry

Phase 4 — Frontend :
  1. Configurer les adresses dans contracts.ts
  2. Déployer le dashboard
```

---

## Ce qui est implémenté

### Smart Contracts

| Contrat | État | Description |
|---------|------|-------------|
| IntentGateway | Design | Escrow source, createOrder, releaseEscrow, cancelOrder |
| IntentSettler | Design | Settlement destination, fillOrder, verifySettlement |
| FillerRegistry | Design | Registre fillers, staking, réputation, slash |
| ProofVerifier | Design | Vérification preuves ZK BEEFY |
| ISMPHandler | Design | Interface ISMP pour Hyperbridge |
| OrderLib | Design | Encoding/decoding, hash, status transitions |
| FeeCalculator | Design | Fees dynamiques, congestion, size premium |
| Constants | Design | Paramètres protocole |

### Filler Service

| Module | État | Description |
|--------|------|-------------|
| Watcher | Design | Listen OrderPlaced events sur Asset Hub |
| Executor | Design | Execute fillOrder() sur HyperEVM |
| Settler | Design | Monitor + trigger verifySettlement |
| Pricing | Design | Évaluation fee/profitabilité avant fill |

### Frontend

| Page / Feature | État | Description |
|---------------|------|-------------|
| Bridge Page | Design | Interface de bridge, amount, fee, confirmation |
| Dashboard | Design | Historique ordres, status settlement |
| Filler Dashboard | Design | P&L, ordres remplis, liquidité |
| Order Tracker | Design | Suivi temps réel du pipeline |
| Settlement Progress | Design | Barre XCM → BEEFY → ISMP → Settled |
| Wallet Connect | Design | Double wallet Polkadot + EVM |

### À compléter

- Implémentation des smart contracts (Solidity)
- Intégration réelle avec Hyperbridge/ISMP (preuves ZK BEEFY)
- Service filler fonctionnel (event listener + executor)
- Frontend avec interactions on-chain réelles
- Tests unitaires et fuzz complets
- Audit de sécurité
- Déploiement testnet (Asset Hub testnet + HyperEVM testnet)
- Déploiement mainnet

---

## Dependencies

### Contracts (Solidity / Foundry)

| Package | Usage |
|---------|-------|
| OpenZeppelin 5.x | ERC-20, SafeERC20, ReentrancyGuard, Pausable |
| forge-std | Testing framework, Script, console2 |
| Hyperbridge ISMP | Interface ISMP pour vérification cross-chain |

### Filler (Node.js / TypeScript)

| Package | Usage |
|---------|-------|
| ethers / viem | Interaction avec HyperEVM (EVM) |
| @polkadot/api | Interaction avec Asset Hub (Substrate) |
| typescript | Typage statique |

### Frontend (React / TypeScript)

| Package | Usage |
|---------|-------|
| react | Framework UI |
| typescript | Typage statique |
| vite | Bundler + dev server |
| wagmi + viem | Interaction EVM (HyperEVM) |
| @polkadot/extension-dapp | Wallet Polkadot (SubWallet, Talisman) |
| tailwindcss | Styling |

---

## Points d'Attention

1. **Le fill instantané dépend de la liquidité filler** — S'il n'y a pas de filler actif avec assez de liquidité, le protocole bascule automatiquement en mode bridge classique trustless (~6-8 min). L'utilisateur reçoit toujours ses fonds — les fillers sont une couche d'accélération, pas une dépendance
2. **Settlement ~6-8 min est une estimation** — Dépend de la latence BEEFY, Hyperbridge, et ISMP. Peut varier selon la congestion du réseau Polkadot
3. **ZK BEEFY est la clé du trustless** — Sans preuve ZK, le settlement nécessiterait un comité multisig ou un challenge period. BEEFY permet une vérification directe du consensus Polkadot côté EVM
4. **XCM v5 est requis** — Les versions antérieures de XCM ne supportent pas toutes les primitives nécessaires (notamment Transact et le dry-run)
5. **Le filler prend un risque temporaire** — Il front les fonds ~6-8 min avant d'être remboursé. Ce risque est compensé par les fees
6. **Double-fill protection est critique** — Un bug dans la protection double-fill pourrait permettre à plusieurs fillers de fill le même ordre
7. **Deadline ≠ settlement timeout** — Le deadline est pour la création de l'intent (pas de fill après). Le settlement timeout est pour le processus de preuve
8. **USDC seulement dans un premier temps** — Le protocole peut être étendu à d'autres tokens, mais le risque de prix complique le modèle filler pour les tokens volatils
9. **Hyperbridge doit être opérationnel** — Si Hyperbridge est down, le settlement est bloqué (mais les fonds ne sont pas perdus — cancel possible après deadline)
10. **Le bridge retour utilise le même mécanisme** — IntentGateway + IntentSettler déployés sur les deux chaînes, pipeline inversé

---

## Références

| Ressource | Lien |
|-----------|------|
| ERC-7683 — Cross-Chain Intents Standard | `https://eips.ethereum.org/EIPS/eip-7683` |
| Across Protocol — Intent-Based Bridge | `https://docs.across.to` |
| Polkadot XCM v5 — Documentation | `https://wiki.polkadot.network/docs/learn-xcm` |
| Hyperbridge — Interoperability Protocol | `https://docs.hyperbridge.network` |
| BEEFY — Bridge Efficiency Enabling Finality Yielder | `https://wiki.polkadot.network/docs/learn-beefy` |
| ISMP — Interoperable State Machine Protocol | `https://docs.hyperbridge.network/protocol/ismp` |
| Hyperliquid — Documentation | `https://hyperliquid.gitbook.io/hyperliquid-docs` |
| HyperEVM — EVM on Hyperliquid | `https://hyperliquid.gitbook.io/hyperliquid-docs/hyperevm` |
| Polkadot Asset Hub | `https://wiki.polkadot.network/docs/learn-guides-assets-create` |
| OpenZeppelin Contracts 5.x | `https://docs.openzeppelin.com/contracts` |
| Foundry Book | `https://book.getfoundry.sh` |

---

## Stack Technique Complète

| Composant | Tech |
|-----------|------|
| Smart Contracts | Solidity ^0.8.24, Foundry, OpenZeppelin 5.x |
| Source Chain | Polkadot Asset Hub (parachain ID 1000) |
| Destination Chain | HyperEVM (Hyperliquid L1) |
| Messaging | XCM v5 (Polkadot native cross-consensus messaging) |
| Interop Layer | Hyperbridge (trustless, ISMP-based) |
| Proof System | ZK BEEFY (Polkadot consensus proofs vérifiables côté EVM) |
| Transport | ISMP (Interoperable State Machine Protocol) |
| Filler Service | TypeScript, ethers/viem (EVM) + @polkadot/api (Substrate) |
| Frontend | React + TypeScript + Vite |
| Web3 EVM | wagmi + viem |
| Web3 Polkadot | @polkadot/extension-dapp |
| Styling | Tailwind CSS |
| Token bridgé | USDC (Asset Hub ↔ HyperEVM) |
| Testing | Foundry (forge test, unit + fuzz) |
