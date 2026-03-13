# IntentBridge — Intent-Based Cross-Chain Bridge Polkadot → Arbitrum Sepolia → Hyperliquid avec Settlement Trustless

## TL;DR

Protocole de bridge cross-chain **intent-based** entre Polkadot Asset Hub et Hyperliquid Testnet (via Arbitrum Sepolia) qui offre **deux modes au choix de l'utilisateur** :

- **Instant Bridge** (~2s) : L'utilisateur paie des fees à un filler (LP) qui front les fonds immédiatement côté Arbitrum Sepolia. Le settlement utilise le **TEE fast path** via Phala Network (~5-10s), avec ZK BEEFY en fallback (~6-8 min). Le filler récupère les fonds lockés + ses fees une fois la preuve vérifiée on-chain.
- **Classic Bridge** (~6-8 min) : L'utilisateur ne paie aucune fee filler. Les fonds suivent le pipeline trustless complet : XCM v5 → Hyperbridge → ZK proof BEEFY → ISMP → Arbitrum Sepolia. Pas d'intermédiaire, pas de fee supplémentaire.
- **Route A** : Polkadot Hub → Arbitrum Sepolia → Hyperliquid Testnet. Les fonds arrivent sur Arbitrum Sepolia puis sont automatiquement déposés sur Hyperliquid via le bridge officiel (ERC20 transfer vers Bridge2).

**L'utilisateur choisit** son mode avant de bridge. Instant Bridge pour la vitesse (avec fee), Classic Bridge pour l'économie (sans fee supplémentaire). **Si l'utilisateur choisit Instant Bridge mais qu'aucun filler n'est disponible** dans le `FILLER_WINDOW` (~30s), le système **bascule automatiquement** en mode Classic — l'utilisateur reçoit ses fonds dans tous les cas, la seule différence est le délai.

Le modèle s'inspire des architectures intent-based (ERC-7683, Across Protocol) mais adapté à l'écosystème Polkadot ↔ Hyperliquid, en exploitant les primitives natives : XCM v5 pour le messaging cross-chain, Hyperbridge comme couche d'interopérabilité trustless, et les preuves ZK BEEFY pour la vérification de consensus Polkadot côté EVM.

---

## Le Concept (Intent-Based Bridging)

```
Le problème :
  Les bridges classiques imposent une attente de ~15-45 min (finalité + relay + vérification).
  → L'utilisateur ne peut pas trader immédiatement après un bridge.
  → UX catastrophique pour un trader qui veut entrer en position rapidement.

La solution IntentBridge :
  Offrir le CHOIX à l'utilisateur :
  → Instant Bridge : fonds en ~2s grâce à un filler (LP), moyennant une fee (~5-100 bps).
  → Classic Bridge : fonds en ~6-8 min via le pipeline trustless, sans fee supplémentaire.
  → Si Instant choisi mais aucun filler disponible → fallback automatique en Classic (~6-8 min).

Concrètement :
  Alice veut bridge 100 USDC de Polkadot Asset Hub vers Arbitrum Sepolia.

  Option A — Instant Bridge (Alice est pressée, elle veut trader maintenant) :
  → Alice choisit "Instant Bridge" dans le frontend
  → Alice lock 100 USDC dans l'escrow IntentGateway sur Asset Hub (fee = 0.10 USDC)
  → Un filler détecte l'intent (event OrderPlaced)
  → Le filler appelle fillOrder() sur Arbitrum Sepolia → Alice reçoit ~99.90 USDC instantanément
  → Alice trade sur Hyperliquid immédiatement
  → EN ARRIÈRE-PLAN : settlement trustless → le filler récupère 100 USDC

  Option B — Classic Bridge (Alice veut économiser la fee) :
  → Alice choisit "Classic Bridge" dans le frontend
  → Alice lock 100 USDC dans l'escrow IntentGateway sur Asset Hub (fee = 0)
  → Aucun filler ne prend l'ordre (fee = 0)
  → executeFallback() est déclenché après FILLER_WINDOW
  → XCM v5 → Hyperbridge → ZK proof BEEFY → ISMP → Arbitrum Sepolia
  → Alice reçoit 100 USDC (~6-8 min) — aucune fee filler prélevée
```

```
Comparaison des deux modes :

| Critère               | Instant Bridge (filler)          | Classic Bridge (direct)           |
|-----------------------|----------------------------------|-----------------------------------|
| Temps pour l'user     | ~2 secondes                      | ~6-8 minutes                      |
| Fee filler            | 5-100 bps (choix user)           | 0 (aucune fee filler)             |
| Intermédiaire         | Oui (filler LP)                  | Non (pipeline trustless direct)   |
| Trust assumption      | Trustless (ZK proof BEEFY)       | Trustless (ZK proof BEEFY)        |
| Montant reçu (100 USDC) | ~99.90-99.95 USDC            | 100 USDC                          |
| Idéal pour            | Traders pressés, positions urgentes | Transferts non urgents, économie |
| Si aucun filler       | Fallback auto → Classic (~6-8 min)  | N/A (pas de filler impliqué)     |
```

```
Comparaison avec les autres bridges :

| Critère               | Bridge classique (lock & mint) | Bridge optimistic (relay)    | IntentBridge (intent-based)     |
|-----------------------|-------------------------------|-----------------------------|---------------------------------|
| Temps pour l'user     | 15-45 min                     | 2-10 min (+ challenge)      | ~2s (Instant) ou ~7min (Classic)|
| Trust assumption      | Comité de validators          | Watcher honnête (1-of-N)    | Trustless (ZK proof BEEFY)      |
| Capital efficiency    | Faible (mint/burn)            | Moyenne (bonding)           | Haute (fillers compétitifs)     |
| UX trading            | Impossible pendant le bridge  | Attente réduite             | Trade immédiat (Instant mode)   |
| Settlement            | On-chain sync                 | Optimistic + challenge      | ZK proof async (~6-8 min)       |
| Choix utilisateur     | Non                           | Non                         | Oui (Instant vs Classic)        |
```

**Pourquoi intent-based** : L'utilisateur exprime une *intention* ("je veux 100 USDC sur Arbitrum Sepolia") et **choisit** comment il veut que cette intention soit exécutée. En mode Instant, le marché (fillers/LPs) se charge de l'exécuter rapidement moyennant une fee. En mode Classic, le pipeline trustless gère tout directement, sans intermédiaire.

**Le coût de l'instantanéité** : Les fees du filler — typiquement 5-100 bps selon la liquidité disponible et la taille de l'ordre. Plus la fee est élevée, plus le fill est rapide. L'utilisateur qui ne veut pas payer cette fee peut simplement choisir le Classic Bridge. **Si aucun filler ne répond en mode Instant**, le système bascule automatiquement en Classic — la fee n'est jamais prélevée si personne ne fill.

**Deux modes, même sécurité** : Les deux modes reposent sur le même settlement trustless (ZK BEEFY). La seule différence : le mode Instant utilise un filler comme intermédiaire temporaire pour accélérer la livraison. Le mode Classic envoie les fonds directement via le pipeline. En cas d'absence de filler en mode Instant, le fallback automatique vers Classic garantit que **l'utilisateur reçoit toujours ses fonds**, sans exception.

```
Deux modes de fonctionnement — AU CHOIX DE L'UTILISATEUR :

Mode A — Instant Bridge (filler, ~2s, avec fee) :
  T+0s    Alice choisit "Instant Bridge" et lock 100 USDC (fee = 0.10 USDC)
  T+2s    Filler détecte + fillOrder() → Alice reçoit ~99.90 USDC sur Arbitrum Sepolia
  T+2s    Alice trade immédiatement sur Hyperliquid
  T+7min  Settlement trustless → filler remboursé + fees
  → Coût : fees filler (~5-100 bps)
  → UX : instantanée

Mode A bis — Instant Bridge SANS filler disponible (fallback automatique) :
  T+0s    Alice choisit "Instant Bridge" et lock 100 USDC (fee = 0.10 USDC)
  T+30s   FILLER_WINDOW expire — aucun filler disponible
  T+30s   executeFallback() déclenché automatiquement → bascule en Classic
  T+1min  XCM v5 initie le transfer direct
  T+3min  Hyperbridge génère la preuve ZK BEEFY
  T+5min  ISMP relaie vers Arbitrum Sepolia
  T+7min  Alice reçoit ses 100 USDC sur Arbitrum Sepolia (fee non prélevée, aucun filler)
  → Coût : 0 (la fee n'est prélevée que si un filler fill effectivement)
  → UX : ~6-8 min d'attente (fallback transparent pour l'utilisateur)
  → Le frontend affiche : "Aucun filler disponible — bridge classique en cours..."

Mode B — Classic Bridge (~6-8 min, sans fee filler) :
  T+0s    Alice choisit "Classic Bridge" et lock 100 USDC (fee = 0)
  T+30s   FILLER_WINDOW expire — aucun filler (fee = 0 → non attractif)
  T+30s   executeFallback() déclenché automatiquement
  T+1min  XCM v5 initie le transfer direct
  T+3min  Hyperbridge génère la preuve ZK BEEFY
  T+5min  ISMP relaie vers Arbitrum Sepolia
  T+7min  Alice reçoit ses 100 USDC sur Arbitrum Sepolia (intégralité, aucune fee)
  → Coût : 0 fees filler (juste les frais réseau)
  → UX : ~6-8 min d'attente (bridge classique trustless)

Le frontend affiche le choix :
  → Toggle "Instant Bridge" / "Classic Bridge"
  → Instant : slider de fee (5-100 bps), estimation du temps de fill
  → Classic : pas de slider, affichage "~6-8 minutes, 0 fee filler"
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
  │  │                                                                    │  │
  │  │  ┌──────────────────────────────────────────────────────────────┐  │  │
  │  │  │ executeFallback() — si mode Classic (fee=0, pas de filler)   │  │  │
  │  │  └──────────────────────────────────────────────────────────────┘  │  │
  │  └────────────────────────────────────────────────────────────────────┘  │
  │                                                                          │
  │  Event: OrderPlaced(orderId, user, amount, destChain, feeOffer)          │
  └──────────────────────┬───────────────────────────────────────────────────┘
                         │
                         │  ① User lock USDC (fee > 0 = Instant, fee = 0 = Classic)
                         │
                         ▼
  ┌──────────────────────────────────────────────────────────────────────────┐
  │                  Filler Network (Off-Chain) — Mode Instant uniquement    │
  │                                                                          │
  │  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────────┐   │
  │  │  Filler A (LP)   │  │  Filler B (LP)   │  │  Filler C (LP)      │   │
  │  │  Watch events    │  │  Watch events    │  │  Watch events       │   │
  │  │  Compete on fees │  │  Compete on fees │  │  Compete on fees    │   │
  │  └──────────────────┘  └──────────────────┘  └──────────────────────┘   │
  │                                                                          │
  │  → Ignore les ordres avec fee = 0 (Classic Bridge)                       │
  │  → Compétition sur les ordres avec fee > 0 (Instant Bridge)              │
  └──────────────────────┬───────────────────────────────────────────────────┘
                         │
                         │  ② Filler détecte l'intent + front les fonds (Instant)
                         │     OU pipeline direct (Classic)
                         │
                         ▼
  ┌──────────────────────────────────────────────────────────────────────────┐
  │                       Arbitrum Sepolia (Destination Chain)                       │
  │                                                                          │
  │  ┌────────────────────────────────────────────────────────────────────┐  │
  │  │              IntentSettler (Mode Instant — via filler)              │  │
  │  │                                                                    │  │
  │  │  ┌──────────────┐  ┌──────────────┐  ┌─────────────────────────┐  │  │
  │  │  │ fillOrder()   │  │  FillStore   │  │  verifySettlement()     │  │  │
  │  │  │ (pay user)    │  │  (fills)     │  │  (ZK proof BEEFY)      │  │  │
  │  │  └──────────────┘  └──────────────┘  └─────────────────────────┘  │  │
  │  └────────────────────────────────────────────────────────────────────┘  │
  │                                                                          │
  │  ┌────────────────────────────────────────────────────────────────────┐  │
  │  │          FallbackReceiver (Mode Classic — pipeline direct)         │  │
  │  │                                                                    │  │
  │  │  ┌───────────────────────────────────────────────────────────────┐ │  │
  │  │  │ receiveFallbackFunds() — reçoit les USDC via ISMP (no filler)│ │  │
  │  │  └───────────────────────────────────────────────────────────────┘ │  │
  │  └────────────────────────────────────────────────────────────────────┘  │
  │                                                                          │
  │  → Mode Instant : Alice reçoit ses USDC en ~2s via le filler             │
  │  → Mode Classic : Alice reçoit ses USDC en ~7min via FallbackReceiver    │
  └──────────────────────────────────────────────────────────────────────────┘

  ┌──────────────────────────────────────────────────────────────────────────┐
  │              Settlement Trustless (Arrière-Plan ~6-8 min)                │
  │              → Utilisé par les DEUX modes                                │
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
  │  Mode Instant : verifySettlement() → preuve valide → signal à Asset Hub  │
  │      │          → releaseEscrow() → filler récupère USDC + fees          │
  │  Mode Classic : FallbackReceiver → fonds livrés directement à l'user     │
  └──────────────────────────────────────────────────────────────────────────┘
```

---

## Pourquoi Polkadot × Hyperliquid ?

| Critère | Bridge classique (Wormhole, etc.) | IntentBridge (Polkadot → Arbitrum Sepolia) |
|---------|----------------------------------|-------------------------------------|
| **Temps utilisateur** | 15-45 min (attente finalité + relay) | ~2s (Instant) ou ~7min (Classic) — au choix |
| **Settlement** | Synchronous (bloquant) | Asynchronous trustless (~6-8 min, non-bloquant) |
| **Trust model** | Comité multisig / guardian set | ZK proof BEEFY (trustless, vérifiable on-chain) |
| **Messaging** | Custom relay / oracle | XCM v5 natif (Polkadot native) |
| **Interop layer** | Propriétaire | Hyperbridge (open, ISMP-based) |
| **Capital efficiency** | Lock/mint (capital immobilisé) | Fillers compétitifs (capital rotatif) |
| **Proof system** | Souvent optimistic (challenge period) | ZK BEEFY (aucun challenge, vérification directe) |
| **Destination** | Chaîne EVM générique | Arbitrum Sepolia → accès direct Hyperliquid (perps, spot) |
| **Choix utilisateur** | Aucun (1 mode imposé) | Instant (rapide, fee) OU Classic (lent, gratuit) |

**Avantages clés de cette stack :**
- XCM v5 est le standard natif de messaging cross-chain dans l'écosystème Polkadot — battle-tested, upgradé régulièrement, et supporté par toutes les parachains
- Hyperbridge utilise ISMP pour une interopérabilité trustless entre Polkadot et les chaînes EVM — pas de comité multisig, pas de guardian set
- Les preuves ZK BEEFY permettent de vérifier le consensus Polkadot directement sur un contrat EVM — settlement cryptographiquement garanti
- Le bridge via Arbitrum Sepolia donne un accès direct à l'orderbook Hyperliquid — l'utilisateur peut ouvrir des positions perps instantanément après le bridge
- Le modèle intent-based permet une UX comparable à un CEX (fonds disponibles en secondes) avec les garanties d'un bridge trustless
- **Le choix du mode permet à chaque utilisateur d'optimiser selon ses priorités** : vitesse (Instant) ou économie (Classic)

---

## Smart Contracts — Architecture Détaillée

### 1. IntentGateway (Polkadot Asset Hub — Escrow Source)

Le point d'entrée côté source. Gère la création des ordres (intents), le lock des fonds en escrow, et la libération des fonds vers le filler après vérification de la preuve de settlement. **Le mode de bridge est déterminé par la `feeOffer`** : fee > 0 = Instant Bridge, fee = 0 = Classic Bridge.

**Structure d'un ordre (`Order`) :**
```
struct Order {
    orderId:       bytes32     // Hash unique de l'intent
    user:          address     // Adresse de l'utilisateur sur Asset Hub
    token:         address     // Token locké (USDC)
    amount:        uint256     // Montant locké
    destChain:     uint32      // Chain ID destination (Arbitrum Sepolia)
    destAddress:   address     // Adresse de l'utilisateur sur Arbitrum Sepolia
    feeOffer:      uint256     // Fee offerte au filler (0 = Classic Bridge, >0 = Instant Bridge)
    deadline:      uint256     // Expiration de l'intent
    status:        OrderStatus // Pending → Filled → Settled (Instant) | Pending → Fallback → Settled (Classic)
}
```

**Fonctions :**

| Fonction | Description |
|----------|-------------|
| `createOrder(token, amount, destChain, destAddress, feeOffer, deadline)` | Lock les fonds en escrow, émet `OrderPlaced`, retourne `orderId`. **feeOffer = 0 → Classic Bridge, feeOffer > 0 → Instant Bridge** |
| `releaseEscrow(orderId, fillerAddress, proof)` | Vérifie la preuve ZK BEEFY via Hyperbridge, libère les fonds lockés + fees vers le filler **(Instant mode uniquement)** |
| `executeFallback(orderId)` | Déclenché si aucun filler n'a fill l'intent après `FILLER_WINDOW`. Initie le bridge classique : XCM v5 → Hyperbridge → ISMP → fonds envoyés directement à l'utilisateur côté Arbitrum Sepolia. **Utilisé en mode Classic (fee=0) ou comme safety net en mode Instant si aucun filler ne répond** |
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
→ FILLER_WINDOW (30s) : fenêtre pendant laquelle les fillers peuvent fill l'intent
  → Mode Instant (fee > 0) : les fillers ont 30s pour fill, sinon executeFallback() prend le relais
  → Mode Classic (fee = 0) : aucun filler ne va fill → executeFallback() est la voie prévue
  → executeFallback() initie le bridge classique trustless (XCM v5 → Hyperbridge → ISMP)
  → L'utilisateur reçoit ses fonds directement sur Arbitrum Sepolia après le settlement (~6-8 min)
  → Pas de fee filler en mode Classic — l'intégralité du montant est bridgé
  → Un fill qui arrive APRÈS executeFallback() est rejeté (status déjà Fallback)
```

### 2. IntentSettler (Arbitrum Sepolia — Settlement Destination)

Contrat déployé sur Arbitrum Sepolia qui gère le fill des ordres par les fillers et la vérification du settlement trustless. **Utilisé uniquement en mode Instant Bridge.**

**Structure d'un fill (`Fill`) :**
```
struct Fill {
    orderId:       bytes32     // Référence à l'ordre source
    filler:        address     // Adresse du filler sur Arbitrum Sepolia
    recipient:     address     // Adresse de l'utilisateur sur Arbitrum Sepolia
    token:         address     // Token envoyé (USDC sur Arbitrum Sepolia)
    amount:        uint256     // Montant envoyé à l'utilisateur
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
→ Le filler prend un risque temporaire (~6-8 min entre fill et settlement)
→ Si le settlement échoue (preuve invalide), le filler ne récupère pas ses fonds lockés côté source
→ ReentrancyGuard + Pausable pour les cas d'urgence
```

### 3. FallbackReceiver (Arbitrum Sepolia — Réception Classic Bridge)

Contrat déployé sur Arbitrum Sepolia qui reçoit les fonds en mode Classic Bridge. Quand l'utilisateur choisit le mode Classic (fee = 0), les fonds arrivent directement via le pipeline trustless, sans passer par un filler.

```
→ receiveFallbackFunds(orderId, recipient, token, amount)
→ Appelé par le module ISMP après vérification ZK BEEFY
→ Transfère les USDC directement à l'utilisateur
→ Protection contre la double-livraison (mapping delivered)
→ L'utilisateur reçoit 100% du montant (aucune fee filler)
```

### 4. FillerRegistry (Arbitrum Sepolia — Registre des Fillers)

Contrat optionnel de registre pour les fillers. Permet aux utilisateurs de vérifier la réputation et la liquidité des fillers actifs. **Pertinent uniquement pour le mode Instant Bridge.**

| Fonction | Description |
|----------|-------------|
| `register(stake)` | Un filler stake des USDC comme garantie de solvabilité (min 100 USDC) |
| `unregister()` | Retrait du stake (cooldown 24h) |
| `slash(filler, orderId)` | Slash le stake si un filler ne settle pas (gouvernance) |
| `getFillerInfo(filler)` | Vue : stake, ordres remplis, taux de settlement, score |
| `getActiveFillers()` | Vue : liste des fillers actifs triés par score |

### 5. Settlement Pipeline — Modules

#### XCM v5 (Cross-Consensus Messaging)

Le protocole de messaging natif de Polkadot. Utilisé pour initier le processus de settlement depuis Asset Hub. **Utilisé par les deux modes.**

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

Le mécanisme de preuve qui permet de vérifier le consensus Polkadot sur une chaîne EVM. **C'est la base de la sécurité des deux modes.**

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
  → Mode Instant : transporte la preuve de settlement pour libérer l'escrow vers le filler
  → Mode Classic : transporte les fonds directement vers le FallbackReceiver
```

### 6. Libraries & Utils

| Contrat | Description |
|---------|-------------|
| `OrderLib.sol` | Encoding/decoding des ordres, hash computation, status transitions |
| `ProofVerifier.sol` | Vérification des preuves ZK BEEFY, interface avec le module ISMP |
| `BEEFYVerifier.sol` | Vérification des commitment roots BEEFY et des storage proofs |
| `FeeCalculator.sol` | Calcul des fees dynamiques basé sur la liquidité disponible et la congestion **(Instant Bridge uniquement)** |
| `Constants.sol` | `MIN_FEE_BPS = 5`, `MAX_FEE_BPS = 100`, `FILLER_WINDOW = 30`, `SETTLEMENT_TIMEOUT = 3600`, `MAX_ORDER_AMOUNT`, chain IDs |

---

## Que se passe-t-il quand Alice bridge 100 USDC ?

### Mode A — Instant Bridge (Alice paie une fee, reçoit en ~2s)

#### Phase 1 — Exécution Instantanée (~2 secondes)

```
Step 1 : Alice choisit "Instant Bridge" et fixe sa fee (ex: 10 bps = 0.10 USDC)
  → Alice appelle createOrder() sur IntentGateway (Asset Hub)
  → 100 USDC lockés dans l'escrow
  → Event OrderPlaced émis avec feeOffer = 0.10 USDC
  → orderId = keccak256(user, token, amount, destChain, destAddress, feeOffer, nonce)

Step 2 : Les fillers du réseau détectent l'event OrderPlaced
  → Filler A voit : 100 USDC, fee = 0.10 USDC, deadline = 1h
  → Filler A a 100 USDC de liquidité sur Arbitrum Sepolia → décide de fill

Step 3 : Filler A appelle fillOrder(orderId, alice, USDC, 100) sur IntentSettler (Arbitrum Sepolia)
  → Alice reçoit ~99.90 USDC sur Arbitrum Sepolia instantanément
  → Event OrderFilled émis

Step 4 : Alice ouvre une position 10x long ETH sur Hyperliquid
  → Aucune attente — les fonds sont disponibles immédiatement
```

#### Phase 2 — Settlement Trustless (~6-8 minutes, en arrière-plan)

```
Step 5 : XCM v5 initie le messaging depuis Asset Hub
  → Le message contient : orderId, preuve du lock, état de l'escrow
  → XCM route le message vers Hyperbridge (parachain)

Step 6 : Hyperbridge reçoit le message XCM
  → Hyperbridge attend la finalité BEEFY sur le block contenant le lock
  → Les validators Polkadot signent le commitment root du block
  → Hyperbridge génère la preuve ZK BEEFY

Step 7 : ISMP transporte la preuve vers Arbitrum Sepolia
  → Le relayer Hyperbridge soumet la preuve au contrat ISMP sur Arbitrum Sepolia
  → verifySettlement() est appelé sur IntentSettler

Step 8 : IntentSettler vérifie la preuve ZK BEEFY
  → Preuve valide → le fill est marqué comme settled
  → Signal envoyé à Asset Hub (via le même pipeline inverse)

Step 9 : IntentGateway reçoit la confirmation de settlement
  → releaseEscrow(orderId, fillerA) est exécuté
  → Filler A récupère 100 USDC (montant locké complet)
  → L'ordre passe en status Settled
```

**Important** : Alice n'attend pas le settlement. Elle a ses USDC dès le Step 3 et peut trader immédiatement. Le settlement protège le filler — il est **toujours** remboursé tant que le lock est valide côté Asset Hub.

### Mode B — Classic Bridge (Alice ne paie pas de fee, reçoit en ~7 min)

```
Step 1 : Alice choisit "Classic Bridge" dans le frontend
  → Alice appelle createOrder() sur IntentGateway (Asset Hub) avec feeOffer = 0
  → 100 USDC lockés dans l'escrow
  → Event OrderPlaced émis avec feeOffer = 0

Step 2 : Le FILLER_WINDOW expire (~30s) — aucun filler ne prend l'ordre (fee = 0)
  → L'ordre reste en status Pending
  → C'est le comportement attendu en mode Classic

Step 3 : executeFallback(orderId) est appelé (permissionless — par Alice, un keeper, ou le frontend)
  → L'ordre passe en status Fallback
  → Event FallbackExecuted émis
  → Le contrat initie un transfer direct via XCM v5

Step 4 : XCM v5 → Hyperbridge → ZK proof BEEFY → ISMP → Arbitrum Sepolia
  → Pipeline classique trustless
  → Les fonds vont DIRECTEMENT à Alice (pas à un filler)

Step 5 : Le contrat FallbackReceiver sur Arbitrum Sepolia reçoit les fonds
  → 100 USDC crédités à Alice sur Arbitrum Sepolia
  → Aucune fee filler — Alice récupère 100% du montant

Step 6 : Alice peut trader sur Hyperliquid
  → Délai total : ~6-8 minutes (bridge classique trustless)

Résumé :
  → Alice a choisi le Classic Bridge → pas de fee, mais ~7 min d'attente
  → Le pipeline est strictement trustless (ZK proof, aucun intermédiaire)
  → L'intégralité du montant est livré (100 USDC sur 100 USDC)
```

**Race condition protection** : Si un filler appelle `fillOrder()` pendant que `executeFallback()` est en cours de traitement, le contrat IntentSettler vérifie le status de l'ordre. Un ordre en status `Fallback` rejette tout `fillOrder()`. Inversement, si un filler fill l'intent juste avant l'appel `executeFallback()`, l'ordre passe en status `Filled` et `executeFallback()` revert. Le status est atomique — il n'y a jamais de double délivrance.

**Safety net en mode Instant** : Si l'utilisateur choisit Instant Bridge (fee > 0) mais qu'aucun filler ne répond dans le `FILLER_WINDOW`, le système bascule automatiquement en mode Classic via `executeFallback()`. L'utilisateur reçoit ses fonds dans tous les cas — la seule différence est le délai.

---

## Modèle Économique des Fillers

```
Le filler est un LP qui fournit de la liquidité instantanée côté destination.
→ Pertinent uniquement pour le mode Instant Bridge.

Revenue du filler :
  → Fees par ordre rempli (fixées par l'utilisateur dans feeOffer)
  → Volume × fee average = revenu journalier
  → Les fillers ignorent les ordres avec feeOffer = 0 (Classic Bridge)

Risques du filler :
  → Capital lock temporaire (~6-8 min entre fill et settlement)
  → Smart contract risk (bug dans IntentGateway ou IntentSettler)
  → Settlement failure (preuve invalide — extrêmement rare avec ZK BEEFY)

Capital efficiency :
  → Un filler avec 10,000 USDC peut fill ~100-200 ordres/jour
  → Rotation du capital : fill → settlement (~8 min) → capital libre → fill suivant
  → ~7.5 rotations/heure × 24h = ~180 rotations/jour théoriques

Compétition :
  → Les fillers sont en compétition pour remplir les ordres Instant
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
Mode Instant — Ordre de 100 USDC avec feeOffer = 0.10 USDC

Alice (User)                          Filler
  │                                     │
  │  lock 100 USDC                      │
  │  ────────────────────►              │
  │  (IntentGateway escrow)             │
  │                                     │
  │         fillOrder()                 │
  │  ◄────────────────────              │
  │  reçoit ~99.90 USDC sur Arbitrum Sepolia   │  dépense 100 USDC de sa liquidité
  │                                     │
  │  ~~ settlement trustless ~~         │
  │  ~~ (~6-8 min) ~~                  │
  │                                     │
  │                                     │  releaseEscrow()
  │                                     │  ◄──────────────
  │                                     │  récupère 100 USDC (escrow complet)
  │                                     │
  │  Profit filler : 0.10 USDC (fee)   │

Résultat :
  Alice : a payé 0.10 USDC de fee, reçu ~99.90 USDC instantanément sur Arbitrum Sepolia
  Filler : a immobilisé 100 USDC pendant ~8 min, gagné 0.10 USDC
```

```
Mode Classic — Ordre de 100 USDC avec feeOffer = 0

Alice (User)                          Pipeline Trustless
  │                                     │
  │  lock 100 USDC (fee = 0)            │
  │  ────────────────────►              │
  │  (IntentGateway escrow)             │
  │                                     │
  │  ~30s~ FILLER_WINDOW expire         │
  │                                     │
  │  executeFallback()                  │
  │  ────────────────────►              │
  │                                     │  XCM v5 → Hyperbridge → ZK BEEFY → ISMP
  │                                     │
  │  ~6-8 min~                          │
  │                                     │
  │  receiveFallbackFunds()             │
  │  ◄────────────────────              │
  │  reçoit 100 USDC sur Arbitrum Sepolia      │
  │  (intégralité, aucune fee)          │

Résultat :
  Alice : a payé 0 fee filler, reçu 100 USDC après ~7 min sur Arbitrum Sepolia
  Aucun filler impliqué — pipeline trustless direct
```

**Fee dynamique (Mode Instant uniquement) :**
```
Le feeOffer est fixé par l'utilisateur, mais un module FeeCalculator peut suggérer :

suggested_fee = base_fee + congestion_premium + size_premium

Où :
  base_fee          = fee minimum viable pour les fillers (ex: 5 bps)
  congestion_premium = augmente si beaucoup d'ordres pending / peu de fillers actifs
  size_premium       = augmente pour les gros ordres (risque de capital plus élevé)

→ L'utilisateur peut overrider la suggestion et fixer sa propre fee
→ Une fee plus élevée = fill plus rapide (priorité des fillers)
→ Une fee trop basse = risque de ne pas être fill → fallback automatique en Classic
→ Fee = 0 → Classic Bridge garanti (aucun filler ne prendra l'ordre)
```

---

## Settlement Pipeline — Détail Technique

```
┌─────────────────────────────────────────────────────────────────┐
│                    SETTLEMENT TIMELINE                           │
│                                                                 │
│  MODE INSTANT (avec filler) :                                   │
│  T+0s      Alice lock 100 USDC, fee=0.10 (IntentGateway)       │
│  T+1s      Event OrderPlaced émis                               │
│  T+2s      Filler détecte + fillOrder() (Arbitrum Sepolia)              │
│            → Alice a ses USDC, peut trader                      │
│                                                                 │
│  ─── SETTLEMENT EN ARRIÈRE-PLAN ───                             │
│                                                                 │
│  T+30s     Finalité du block Asset Hub (GRANDPA)                │
│  T+1min    BEEFY validators signent le commitment root          │
│  T+2min    Hyperbridge collecte les signatures BEEFY            │
│  T+3min    Hyperbridge génère la preuve ZK                      │
│  T+4min    ISMP relaie la preuve vers Arbitrum Sepolia                  │
│  T+5min    verifySettlement() sur IntentSettler                  │
│  T+6min    Signal retour vers Asset Hub                         │
│  T+7min    releaseEscrow() → filler récupère ses fonds + fees   │
│                                                                 │
│  Total settlement : ~6-8 minutes                                │
│  Temps perçu par Alice : ~2 secondes                            │
├─────────────────────────────────────────────────────────────────┤
│  MODE INSTANT — FALLBACK (aucun filler disponible) :            │
│  T+0s      Alice lock 100 USDC, fee=0.10 (IntentGateway)       │
│  T+1s      Event OrderPlaced émis                               │
│  T+30s     FILLER_WINDOW expire — aucun filler n'a fill        │
│  T+30s     executeFallback() déclenché automatiquement          │
│            → Bascule transparente en mode Classic               │
│                                                                 │
│  ─── PIPELINE TRUSTLESS (FALLBACK) ───                          │
│                                                                 │
│  T+1min    XCM v5 initie le transfer                            │
│  T+2min    BEEFY validators signent le commitment root          │
│  T+3min    Hyperbridge génère la preuve ZK                      │
│  T+5min    ISMP relaie vers Arbitrum Sepolia                            │
│  T+7min    FallbackReceiver → Alice reçoit 100 USDC             │
│            (fee non prélevée — aucun filler n'a fill)           │
│                                                                 │
│  Total : ~6-8 minutes                                           │
│  Note : la fee proposée n'est PAS déduite (aucun fill)         │
├─────────────────────────────────────────────────────────────────┤
│  MODE CLASSIC (sans filler) :                                   │
│  T+0s      Alice lock 100 USDC, fee=0 (IntentGateway)          │
│  T+1s      Event OrderPlaced émis                               │
│  T+30s     FILLER_WINDOW expire — aucun filler                  │
│  T+30s     executeFallback() déclenché                          │
│                                                                 │
│  ─── PIPELINE TRUSTLESS DIRECT ───                              │
│                                                                 │
│  T+1min    XCM v5 initie le transfer                            │
│  T+2min    BEEFY validators signent le commitment root          │
│  T+3min    Hyperbridge génère la preuve ZK                      │
│  T+5min    ISMP relaie vers Arbitrum Sepolia                            │
│  T+7min    FallbackReceiver → Alice reçoit 100 USDC             │
│                                                                 │
│  Total : ~6-8 minutes                                           │
│  Temps perçu par Alice : ~6-8 minutes (pas d'accélération)     │
└─────────────────────────────────────────────────────────────────┘
```

**Composants du pipeline :**

| Composant | Rôle | Latence |
|-----------|------|---------|
| XCM v5 | Messaging cross-consensus depuis Asset Hub | ~30s (finalité block) |
| GRANDPA | Finalité du block Polkadot | ~30s |
| BEEFY | Signatures des validators sur le commitment root | ~1-2 min |
| Hyperbridge | Agrégation signatures + génération preuve ZK | ~2-3 min |
| ISMP | Transport de la preuve vers Arbitrum Sepolia | ~1 min |
| IntentSettler | Vérification on-chain de la preuve ZK (Mode Instant) | ~1 tx |
| FallbackReceiver | Réception des fonds (Mode Classic) | ~1 tx |
| Signal retour | Confirmation settlement vers Asset Hub (Mode Instant) | ~1-2 min |
| IntentGateway | Release de l'escrow (Mode Instant) | ~1 tx |

---

## TEE Settlement — Fast Path via Phala Network

Le settlement TEE est un **fast path** (~5-10s) qui s'intercale entre le fill instantané et le settlement ZK BEEFY classique :

```
┌─────────────────────────────────────────────────────────────────┐
│                    SETTLEMENT 3 COUCHES                          │
│                                                                 │
│  Couche 1 — TEE Fast Path (Phala Network) : ~5-10s             │
│  ─────────────────────────────────────────────                  │
│  Le filler demande une attestation au TEE (Phat Contract).      │
│  L'enclave SGX/TDX vérifie l'escrow sur la source chain,       │
│  signe une attestation, et le filler la soumet on-chain.        │
│                                                                 │
│  T+2s    Filler fill l'ordre (Alice reçoit USDC)               │
│  T+5s    Filler demande attestation TEE au Phat Contract       │
│  T+7s    TEE vérifie escrow + signe attestation                │
│  T+8s    verifyTEESettlement() sur IntentSettler               │
│  T+10s   releaseEscrow() sur IntentGateway                     │
│                                                                 │
│  Couche 2 — ZK BEEFY Fallback : ~6-8 min                      │
│  ─────────────────────────────────────────────                  │
│  Si le TEE échoue/timeout, le settlement BEEFY prend le relais.│
│  Même pipeline qu'avant (GRANDPA → BEEFY → Hyperbridge → ISMP) │
│                                                                 │
│  Couche 3 — Classic Trustless Bridge : ~6-8 min                │
│  ─────────────────────────────────────────────                  │
│  Si aucun filler ne fill, fallback direct via ISMP.            │
│  L'utilisateur reçoit ses fonds sans intermédiaire.            │
└─────────────────────────────────────────────────────────────────┘
```

**Phala Network TEE** :
- Les Phat Contracts tournent dans des enclaves SGX/TDX sur les Secure Workers Phala
- Remote Attestation (RA) prouve que le code de l'enclave est intègre
- L'enclave génère une clé de signature interne (jamais exposée)
- Le contrat `TEEVerifier` vérifie que le signataire est une enclave trusted
- Si le TEE est compromis, le ZK BEEFY fallback protège toujours le protocole

**Comparaison des couches de settlement** :

| Couche | Temps | Trust Model | Quand utilisé |
|--------|-------|-------------|---------------|
| TEE (Phala) | ~5-10s | Hardware TEE + Remote Attestation | Fast path par défaut |
| ZK BEEFY | ~6-8 min | Trustless (preuves cryptographiques) | Fallback si TEE échoue |
| Classic | ~6-8 min | Trustless (pipeline direct) | Pas de filler disponible |

---

## Route A — Polkadot → Arbitrum Sepolia → Hyperliquid Testnet

La route principale du bridge :

```
Polkadot Hub (source)  →  Arbitrum Sepolia (destination)  →  Hyperliquid Testnet (trading)
     [escrow]                [fill + settle]                    [official bridge deposit]

T+0s    Lock mock USDC sur Polkadot Hub
T+2s    Filler front USDC2 sur Arbitrum Sepolia → user reçoit
T+5-10s TEE settlement (fast path)
T+...   User dépose USDC2 sur Hyperliquid Testnet via le bridge officiel
```

**USDC2** sur Arbitrum Sepolia : `0x1baAbB04529D43a73232B713C0FE471f7c7334d5`
Ce token est compatible avec le bridge officiel Hyperliquid Testnet. L'utilisateur peut déposer ses USDC2 directement vers Hyperliquid Testnet pour trader (perps, spot).

---

## Flow Utilisateur — Bridge (Asset Hub → Arbitrum Sepolia)

```
Step 1: Connecter wallet (Polkadot.js, SubWallet, Talisman) sur Asset Hub
        + connecter wallet EVM (MetaMask, Rabby) sur Arbitrum Sepolia

Step 2: Choisir le mode de bridge :
        ┌───────────────────────────┬────────────────────────────┐
        │     INSTANT BRIDGE        │      CLASSIC BRIDGE        │
        │     ~2 secondes           │      ~6-8 minutes          │
        │     Fee: 5-100 bps        │      Fee: 0                │
        │     [Slider de fee]       │      [Pas de fee]          │
        └───────────────────────────┴────────────────────────────┘

Step 3: Entrer le montant à bridge (ex: 100 USDC)
        → Mode Instant : affichage fee estimée + montant reçu (~99.90 USDC)
        → Mode Classic : affichage "Vous recevez 100 USDC dans ~7 min"

Step 4: Confirmer la transaction sur Asset Hub
        → createOrder() lock les USDC dans l'escrow
        → Event OrderPlaced émis → visible dans le dashboard

Step 5a (Mode Instant — filler disponible): Fill en ~2s
        → Le dashboard passe à "Filling..." puis "Filled!"
        → Les USDC apparaissent sur Arbitrum Sepolia instantanément

Step 5b (Mode Instant — aucun filler): Safety net
        → Après FILLER_WINDOW (~30s) : "No filler — switching to classic bridge..."
        → executeFallback() déclenché automatiquement
        → Les USDC arrivent après ~6-8 min (l'utilisateur est protégé)

Step 5c (Mode Classic): Pipeline direct
        → "Classic bridge in progress..."
        → executeFallback() déclenché après FILLER_WINDOW
        → Pipeline XCM v5 → Hyperbridge → ZK BEEFY → ISMP
        → Les USDC arrivent sur Arbitrum Sepolia après ~6-8 min

Step 6: Trader sur Hyperliquid
        → Ouvrir des positions perps, spot, etc.

Step 7: (Arrière-plan, Mode Instant uniquement) Settlement trustless
        → Le dashboard affiche la progression : XCM → Hyperbridge → ZK → ISMP → Settled
        → Le filler est remboursé automatiquement
```

---

## Flow Utilisateur — Bridge Retour (Arbitrum Sepolia → Asset Hub)

```
Step 1: Sur le dashboard, sélectionner "Bridge Back"

Step 2: Choisir le mode : Instant Bridge ou Classic Bridge

Step 3: Entrer le montant à bridge retour (ex: 150 USDC — profit inclus)
        → Mode Instant : createOrder() sur IntentGateway côté Arbitrum Sepolia (fee > 0)
        → Mode Classic : createOrder() sur IntentGateway côté Arbitrum Sepolia (fee = 0)

Step 4a (Instant): Un filler détecte l'intent et front les fonds sur Asset Hub
        → fillOrder() sur IntentSettler côté Asset Hub
        → L'utilisateur reçoit ses USDC sur Asset Hub (~2s)

Step 4b (Classic): Pipeline direct
        → executeFallback() après FILLER_WINDOW
        → Arbitrum Sepolia → Hyperbridge → ZK proof → ISMP → Asset Hub (~7 min)

Step 5: Settlement trustless en arrière-plan (Mode Instant)
        → Arbitrum Sepolia → Hyperbridge → ZK proof → ISMP → Asset Hub
        → Le filler récupère ses fonds + fees
```

---

## Config Réseau

### Production (Cible)

| Config | Valeur |
|--------|--------|
| **Source Chain** | Polkadot Asset Hub (parachain ID 1000) |
| **Destination Chain** | Arbitrum Sepolia (Hyperliquid L1) |
| **Messaging** | XCM v5 (Polkadot native) |
| **Interop Layer** | Hyperbridge (parachain) |
| **Proof System** | ZK BEEFY (Polkadot consensus proofs) |
| **Transport** | ISMP (Interoperable State Machine Protocol) |
| **Token bridgé** | USDC (Asset Hub native) |
| **Settlement time** | ~6-8 minutes (non-bloquant en mode Instant) |
| **Fill time (Instant)** | ~2 secondes (dépend des fillers actifs) |
| **Fill time (Classic)** | ~6-8 minutes (pipeline direct) |

### Hackathon Demo (Testnet)

| Config | Valeur |
|--------|--------|
| **Source Chain** | Sepolia (Ethereum testnet) — stand-in pour Asset Hub |
| **Destination Chain** | Arbitrum Sepolia — stand-in pour Arbitrum Sepolia |
| **Relay** | Bot simulateur (appelle `markOrderFilled` sur source après détection du fill sur dest) |
| **Settlement** | Auto-settlement via filler service (dummy proof) |
| **ISMP** | Contrats implémentent `IIsmpModule` — prêts pour Hyperbridge réel |

**Pourquoi Sepolia + Arbitrum Sepolia ?** Arbitrum Sepolia n'est pas encore supporté par Hyperbridge/ISMP. Les chaînes actuellement supportées par Hyperbridge sont : Ethereum, Arbitrum, Optimism, Base, Polygon, BNB, Gnosis. L'architecture et les contrats sont **identiques** — seuls les chain IDs changent quand Hyperbridge ajoutera Arbitrum Sepolia. Le demo sur Sepolia + Arbitrum Sepolia valide le flow complet end-to-end.

**Relay simulateur** : En production, Hyperbridge relayers livrent les messages ISMP entre chaînes. Pour le demo testnet, un bot (`filler/src/relay.ts`) surveille les événements `OrderFilled` sur la destination et appelle `markOrderFilled()` sur la source, simulant le message `FILL_CONFIRMATION` ISMP.

**Roadmap vers production** :
1. Hyperbridge ajoute Arbitrum Sepolia comme chaîne supportée
2. Remplacer les chain IDs (Sepolia → Asset Hub, Arb Sepolia → Arbitrum Sepolia)
3. Remplacer le relay simulateur par les vrais relayers Hyperbridge
4. Remplacer les dummy proofs par les vraies preuves ZK BEEFY
5. Les contrats `IIsmpModule.onAccept()` fonctionneront nativement

---

## Structure du Projet

```
intentbridge/
├── contracts/
│   ├── src/
│   │   ├── source/
│   │   │   ├── IntentGateway.sol          # Escrow source (Asset Hub), createOrder, releaseEscrow, executeFallback
│   │   │   └── OrderStore.sol             # Storage des ordres, status transitions
│   │   ├── destination/
│   │   │   ├── IntentSettler.sol           # Settlement destination (Arbitrum Sepolia), fillOrder, verifySettlement
│   │   │   ├── FillStore.sol              # Storage des fills
│   │   │   ├── FallbackReceiver.sol       # Réception des fonds en mode Classic Bridge (pas de filler)
│   │   │   └── FillerRegistry.sol         # Registre optionnel des fillers, staking, réputation
│   │   ├── settlement/
│   │   │   ├── ProofVerifier.sol          # Vérification des preuves ZK BEEFY
│   │   │   ├── ISMPHandler.sol            # Interface avec le module ISMP de Hyperbridge
│   │   │   └── BEEFYVerifier.sol          # Vérification des commitment roots BEEFY
│   │   ├── libs/
│   │   │   ├── OrderLib.sol               # Encoding/decoding ordres, hash, status transitions
│   │   │   ├── FeeCalculator.sol          # Calcul fees dynamiques (Mode Instant)
│   │   │   └── Constants.sol              # Paramètres protocole, chain IDs, timeouts
│   │   ├── interfaces/
│   │   │   ├── IIntentGateway.sol         # Interface escrow source
│   │   │   ├── IIntentSettler.sol         # Interface settlement destination
│   │   │   ├── IFillerRegistry.sol        # Interface registre fillers
│   │   │   ├── IISMP.sol                  # Interface ISMP legacy
│   │   │   ├── IISMPBridge.sol            # Types ISMP réels : IIsmpModule, IDispatcher, BridgeMessage
│   │   │   └── IERC20.sol                 # Interface ERC-20 standard
│   │   └── adapters/
│   │       └── ERC7683Adapter.sol         # ERC-7683 OriginAdapter + DestinationAdapter
│   ├── test/
│   │   ├── IntentGateway.t.sol            # Tests escrow : create, cancel, release, fallback, expiry, reentrancy
│   │   ├── IntentSettler.t.sol            # Tests settlement : fill, verify, double-fill, proof validation
│   │   ├── FillerRegistry.t.sol           # Tests registre : register, unregister, slash, scoring
│   │   ├── ProofVerifier.t.sol            # Tests preuves : valid proof, invalid proof, replay protection
│   │   ├── FeeCalculator.t.sol            # Tests fees : base, congestion, size premium, edge cases
│   │   ├── ISMPIntegration.t.sol          # Tests ISMP : full flow, settlement, fallback, double delivery
│   │   ├── AccessControl.t.sol            # Tests access control : Gateway, Settler, Registry, Fallback
│   │   ├── EndToEnd.t.sol                 # Tests E2E : instant, classic, cancel, multi-filler, double fill
│   │   └── mocks/
│   │       └── MockIsmpHost.sol           # Mock ISMP host pour tests
│   ├── script/
│   │   ├── DeployAssetHub.s.sol           # Déploiement IntentGateway sur source chain (Sepolia)
│   │   ├── DeployArbitrum Sepolia.s.sol           # Déploiement IntentSettler + FillerRegistry + FallbackReceiver (Arb Sepolia)
│   │   └── ConfigureCrossChain.s.sol      # Configuration cross-chain post-déploiement
│   ├── foundry.toml
│   └── lib/
│       ├── forge-std/
│       └── openzeppelin-contracts/
│
├── filler/                                 # Service off-chain du filler (Mode Instant)
│   ├── src/
│   │   ├── index.ts                       # Entry point, orchestration des services
│   │   ├── watcher.ts                     # Watch OrderPlaced events sur source chain
│   │   ├── executor.ts                    # Exécute fillOrder() sur destination, retry avec backoff
│   │   ├── settler.ts                     # Auto-settlement dual-chain (verify dest + release source)
│   │   ├── relay.ts                       # Simulateur cross-chain relay (markOrderFilled)
│   │   ├── state.ts                       # State tracking : cycle de vie complet des fills
│   │   ├── pricing.ts                     # Logique de fee evaluation (fill ou skip)
│   │   └── config.ts                      # RPC endpoints, clés, paramètres dual-chain
│   ├── package.json
│   └── tsconfig.json
│
├── frontend/                               # Dashboard utilisateur
│   ├── src/
│   │   ├── App.tsx                        # Router principal, pages
│   │   ├── pages/
│   │   │   ├── BridgePage.tsx             # Interface de bridge avec choix Instant/Classic
│   │   │   ├── DashboardPage.tsx          # Historique ordres, status settlement
│   │   │   └── FillerPage.tsx             # Dashboard filler (P&L, ordres remplis, liquidité)
│   │   ├── components/
│   │   │   ├── OrderForm.tsx              # Formulaire avec toggle Instant/Classic + slider fee
│   │   │   ├── OrderTracker.tsx           # Suivi temps réel du settlement pipeline
│   │   │   ├── SettlementProgress.tsx     # Barre de progression (Mode Instant: filler / Mode Classic: direct)
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
├── POLKADOT.md                             # Ce fichier
└── .gitignore
```

---

## Tests

### Suite de Tests

| Fichier | Tests | Description |
|---------|-------|-------------|
| `IntentGateway.t.sol` | Unit + Fuzz | Create order (fee>0 et fee=0), cancel after deadline, release with valid proof, reject invalid proof, executeFallback, reentrancy, double release, expiry edge cases |
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
   → Les fillers stakent des USDC comme garantie (min 100 USDC)
   → Slash possible en cas de comportement malveillant
   → Incite les fillers à être fiables

7. Mode Classic = safety net
   → Si aucun filler ne répond (même en mode Instant), executeFallback() prend le relais
   → L'utilisateur reçoit TOUJOURS ses fonds, quel que soit le mode choisi
   → Le protocole garantit la livraison dans 100% des cas
```

### Risques

```
1. Risque de liquidité filler (Mode Instant uniquement)
   → Si aucun filler n'a de liquidité → le système bascule automatiquement en Classic (~6-8 min)
   → L'utilisateur reçoit toujours ses fonds — les fillers sont une couche d'accélération
   → Mitigation : fee dynamique incite de nouveaux fillers quand la liquidité est basse

2. Risque de settlement delay
   → Si Hyperbridge/BEEFY est lent → le filler attend plus longtemps pour le remboursement
   → En mode Classic : l'utilisateur attend plus longtemps pour ses fonds
   → Mitigation : le capital du filler est temporairement bloqué, pas perdu

3. Smart contract risk
   → Bug dans IntentGateway ou IntentSettler → perte de fonds possible
   → Mitigation : audits, tests fuzz, bug bounty, déploiement progressif

4. Risque XCM/Hyperbridge
   → Si la couche d'interop est down → le settlement est bloqué (les deux modes)
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
    feeOffer,     // 0 = Classic, >0 = Instant
    deadline,
    nonce
))

→ Unique par combinaison user + paramètres + nonce
→ Le nonce empêche les collisions si un user crée plusieurs ordres identiques
→ feeOffer = 0 identifie un ordre Classic Bridge
```

### 2. Fee dynamique suggérée (Mode Instant uniquement)

```
suggested_fee = base_fee + congestion_premium + size_premium

Où :
  base_fee           = MIN_FEE_BPS × amount / 10000    (ex: 5 bps = 0.05%)
  congestion_premium = pending_orders / active_fillers × CONGESTION_MULTIPLIER
  size_premium       = max(0, (amount - LARGE_ORDER_THRESHOLD) × SIZE_BPS / 10000)

Exemple pour 100 USDC, 10 ordres pending, 5 fillers actifs :
  base_fee           = 5 × 100 / 10000 = 0.05 USDC
  congestion_premium = 10/5 × 0.02 = 0.04 USDC
  size_premium       = 0 (sous le seuil de 10,000 USDC)
  suggested_fee      = 0.09 USDC (~9 bps)

Note : en mode Classic, la fee est 0 — ce calcul ne s'applique pas.
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
et la proportion d'ordres Instant vs Classic
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

### Contracts — Déploiement (Testnet)

```bash
cp .env.example .env
# Remplir PRIVATE_KEY, RPC_SOURCE, RPC_DESTINATION, USDC addresses

# Déploiement IntentGateway (Sepolia — Source)
forge script script/DeployAssetHub.s.sol --rpc-url $RPC_SOURCE --broadcast --verify

# Déploiement IntentSettler + FillerRegistry + FallbackReceiver (Arb Sepolia — Destination)
forge script script/DeployArbitrum Sepolia.s.sol --rpc-url $RPC_DESTINATION --broadcast --verify

# Configuration cross-chain
forge script script/ConfigureCrossChain.s.sol --rpc-url $RPC_DESTINATION --broadcast
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
npm run dev       # Dev server → http://localhost:5173
npm run build     # Build production → dist/
```

### Ordre de déploiement complet

```
Phase 1 — Contrats Source (Asset Hub) :
  1. IntentGateway.sol → Escrow + OrderStore
  2. Configurer les paramètres : token whitelist, timeouts

Phase 2 — Contrats Destination (Arbitrum Sepolia) :
  1. IntentSettler.sol → Fill + Settlement verification
  2. FallbackReceiver.sol → Réception fonds Classic Bridge
  3. FillerRegistry.sol → Registre fillers (optionnel)
  4. Configurer le lien ISMP avec Hyperbridge

Phase 3 — Filler Infrastructure :
  1. Déployer le service filler
  2. Alimenter le filler en USDC sur Arbitrum Sepolia
  3. Register le filler dans FillerRegistry

Phase 4 — Frontend :
  1. Configurer les adresses dans contracts.ts
  2. Déployer le dashboard avec le toggle Instant/Classic
```

---

## Ce qui est implémenté

### Smart Contracts

| Contrat | État | Description |
|---------|------|-------------|
| IntentGateway | Implémenté | Escrow source, createOrder (fee>0 Instant, fee=0 Classic), releaseEscrow, executeFallback, cancelOrder |
| IntentSettler | Implémenté | Settlement destination, fillOrder, verifySettlement |
| FallbackReceiver | Implémenté | Réception fonds Classic Bridge via ISMP |
| FillerRegistry | Implémenté | Registre fillers, staking, réputation, slash |
| ProofVerifier | Implémenté | Vérification preuves ZK BEEFY (placeholder hackathon) |
| ISMPHandler | Implémenté | Interface ISMP pour Hyperbridge (placeholder hackathon) |
| BEEFYVerifier | Implémenté | Vérification commitment roots BEEFY (placeholder hackathon) |
| OrderLib | Implémenté | Encoding/decoding, hash, status transitions |
| FeeCalculator | Implémenté | Fees dynamiques, congestion, size premium |
| Constants | Implémenté | Paramètres protocole |

### Filler Service

| Module | État | Description |
|--------|------|-------------|
| Watcher | Implémenté | Listen OrderPlaced events sur source chain |
| Executor | Implémenté | Execute fillOrder() sur destination chain, retry avec backoff exponentiel |
| Settler | Implémenté | Auto-settlement dual-chain : verifySettlement (dest) + releaseEscrow (source) |
| Pricing | Implémenté | Évaluation fee/profitabilité avant fill |
| State | Implémenté | Tracking complet du cycle de vie : DETECTED → FILLING → FILLED → SETTLING → SETTLED → RELEASED |
| Relay | Implémenté | Simulateur cross-chain relay (markOrderFilled sur source après détection du fill sur dest) |

### Frontend

| Page / Feature | État | Description |
|---------------|------|-------------|
| Bridge Page | Implémenté | Interface de bridge avec choix Instant/Classic |
| Dashboard | Implémenté | Historique ordres, status settlement |
| Filler Dashboard | Implémenté | P&L, ordres remplis, liquidité |
| Order Tracker | Implémenté | Suivi temps réel du pipeline |
| Settlement Progress | Implémenté | Barre XCM → BEEFY → ISMP → Settled (Mode Instant et Classic) |
| Wallet Connect | Implémenté | Connexion wallet EVM |

### ISMP Integration

| Contrat | IIsmpModule | Description |
|---------|-------------|-------------|
| IntentGateway | Implémenté | `onAccept()` : décode FILL_CONFIRMATION → `_markOrderFilled()` |
| IntentSettler | Implémenté | `onAccept()` : décode SETTLEMENT_RELEASE → marque fill settled |
| FallbackReceiver | Implémenté | `onAccept()` : décode FALLBACK_DELIVERY → livre tokens |
| ISMPHandler | Implémenté | `dispatchSettlement()` avec vrais types `DispatchPost` + `StateMachine` |
| IISMPBridge | Implémenté | Types ISMP locaux : PostRequest, IIsmpModule, IDispatcher, BridgeMessage |

### ERC-7683 Compatibility

| Contrat | Description |
|---------|-------------|
| ERC7683OriginAdapter | Wraps IntentGateway — `open()` → `createOrder()`, `resolve()` pour fillers |
| ERC7683DestinationAdapter | Wraps IntentSettler — `fill()` → `fillOrder()` |

### Tests

| Suite | Tests | Description |
|-------|-------|-------------|
| IntentGateway.t.sol | Unit + Fuzz | Create, cancel, release, fallback, expiry, reentrancy |
| IntentSettler.t.sol | Unit + Fuzz | Fill, verify, double-fill, proof validation |
| FillerRegistry.t.sol | Unit | Register, unregister, slash, scoring |
| ProofVerifier.t.sol | Unit | ZK BEEFY proof, invalid proof, replay protection |
| FeeCalculator.t.sol | Unit + Fuzz | Base, congestion, size premium, min/max bounds |
| ISMPIntegration.t.sol | Unit | Full instant flow, settlement via ISMP, fallback, double delivery |
| AccessControl.t.sol | Unit | Gateway, Settler, FallbackReceiver, FillerRegistry access restrictions |
| EndToEnd.t.sol | Unit | E2E instant, classic fallback, cancel, multiple fillers, double fill prevention |

### À compléter (Roadmap Production)

- Remplacement des dummy proofs par de vraies preuves ZK BEEFY quand Hyperbridge supporte Arbitrum Sepolia
- Connexion wallet Polkadot (SubWallet, Talisman) en plus du wallet EVM
- Audit de sécurité complet
- Déploiement mainnet (Asset Hub + Arbitrum Sepolia)

---

## Dependencies

### Contracts (Solidity / Foundry)

| Package | Usage |
|---------|-------|
| OpenZeppelin 5.x | ERC-20, SafeERC20, ReentrancyGuard, Pausable, Ownable |
| forge-std | Testing framework, Script, console2 |
| Hyperbridge ISMP | Interface ISMP pour vérification cross-chain |

### Filler (Node.js / TypeScript)

| Package | Usage |
|---------|-------|
| ethers v6 | Interaction avec Arbitrum Sepolia (EVM) |
| @polkadot/api | Interaction avec Asset Hub (Substrate) |
| typescript | Typage statique |

### Frontend (React / TypeScript)

| Package | Usage |
|---------|-------|
| react | Framework UI |
| typescript | Typage statique |
| vite | Bundler + dev server |
| wagmi v2 + viem | Interaction EVM (Arbitrum Sepolia) |
| @tanstack/react-query | Data fetching |
| tailwindcss | Styling |
| react-router-dom | Routing |

---

## Points d'Attention

1. **Le choix Instant/Classic est déterminé par la `feeOffer`** — fee > 0 = Instant Bridge (filler prend l'ordre), fee = 0 = Classic Bridge (pipeline direct). Le frontend expose ce choix via un toggle clair
2. **Le fill instantané dépend de la liquidité filler** — S'il n'y a pas de filler actif avec assez de liquidité, même en mode Instant, le système bascule automatiquement en Classic Bridge. L'utilisateur reçoit toujours ses fonds
3. **Settlement ~6-8 min est une estimation** — Dépend de la latence BEEFY, Hyperbridge, et ISMP. Peut varier selon la congestion du réseau Polkadot
4. **ZK BEEFY est la clé du trustless** — Les deux modes (Instant et Classic) reposent sur les preuves ZK BEEFY. Sans preuve ZK, le settlement nécessiterait un comité multisig ou un challenge period
5. **XCM v5 est requis** — Les versions antérieures de XCM ne supportent pas toutes les primitives nécessaires (notamment Transact et le dry-run)
6. **Le filler prend un risque temporaire** — Il front les fonds ~6-8 min avant d'être remboursé. Ce risque est compensé par les fees (Mode Instant uniquement)
7. **Double-fill protection est critique** — Un bug dans la protection double-fill pourrait permettre à plusieurs fillers de fill le même ordre
8. **Deadline ≠ settlement timeout** — Le deadline est pour la création de l'intent (pas de fill après). Le settlement timeout est pour le processus de preuve
9. **USDC seulement dans un premier temps** — Le protocole peut être étendu à d'autres tokens, mais le risque de prix complique le modèle filler pour les tokens volatils
10. **Hyperbridge doit être opérationnel** — Si Hyperbridge est down, les deux modes sont bloqués (mais les fonds ne sont pas perdus — cancel possible après deadline)
11. **Le bridge retour utilise le même mécanisme** — IntentGateway + IntentSettler déployés sur les deux chaînes, pipeline inversé, même choix Instant/Classic

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
| Arbitrum Sepolia — EVM on Hyperliquid | `https://hyperliquid.gitbook.io/hyperliquid-docs/hyperevm` |
| Polkadot Asset Hub | `https://wiki.polkadot.network/docs/learn-guides-assets-create` |
| OpenZeppelin Contracts 5.x | `https://docs.openzeppelin.com/contracts` |
| Foundry Book | `https://book.getfoundry.sh` |

---
