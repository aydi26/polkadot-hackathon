# Velora — Intent-Based Cross-Chain Bridge Polkadot → Arbitrum Sepolia → Hyperliquid avec Privacy Pool + TEE Settlement

## TL;DR

Protocole de bridge cross-chain **intent-based** et **privacy-first** entre Polkadot Asset Hub et Hyperliquid Testnet (via Arbitrum Sepolia). **Tous les dépôts sont anonymes par défaut** — l'adresse de destination est chiffrée ECIES et un identifiant unlinkable est utilisé côté destination.

- **Privacy Pool** : L'utilisateur dépose dans un contrat de mixing time-locked sur Polkadot Hub. Le filler TEE trigger le withdraw automatiquement après expiration du lock.
- **TEE-only settlement** (~5-10s) : Le filler tourne dans un **TEE Phala dstack** (Intel TDX). Il déchiffre la destination dans l'enclave, fill avec un `fillId` unlinkable via un **fresh wallet single-use**, et settle via attestation TDX. Aucun lien on-chain entre source et destination.
- **Montants standardisés** : 6, 7, 8, 9 ou 10 USDC — empêche la corrélation par montant.
- **Délai de livraison** : L'utilisateur choisit un délai de privacy lock (instantané, 15s, 30s, 1 min, ou custom jusqu'à 1h) — casse la corrélation temporelle.
- **Route** : Polkadot Hub → Arbitrum Sepolia → Hyperliquid Testnet. Le filler TEE dépose automatiquement sur Hyperliquid via le bridge officiel + `usdSend`.

**Privacy by default** : Toutes les commandes passent par le PrivacyPool. La destAddress est chiffrée ECIES avec la clé publique du TEE. Le secret de retrait est aussi chiffré. Seul le TEE peut déchiffrer et trigger le withdraw. Le `fillId` côté destination est dérivé par `keccak256(sourceOrderId, teeSecret)` — unlinkable sans le secret TEE. Le dépôt Hyperliquid est fait via un fresh wallet single-use — aucun lien avec le filler TEE.

Le modèle s'inspire des architectures intent-based (ERC-7683, Across Protocol) mais adapté à l'écosystème Polkadot ↔ Hyperliquid, en exploitant le chiffrement ECIES dans un TEE Phala dstack pour la confidentialité, et un PrivacyPool pour le mixing.

---

## Le Concept (Intent-Based Bridging + Privacy Pool)

```
Le problème :
  Les bridges classiques exposent les adresses source et destination on-chain.
  → N'importe qui peut tracer les transferts cross-chain.
  → Pas de confidentialité pour les traders.

La solution Velora :
  Un bridge intent-based où TOUS les dépôts sont anonymes :
  → L'utilisateur dépose dans un PrivacyPool (mixing) avec un délai configurable.
  → Le filler TEE déchiffre la destination à l'intérieur de l'enclave.
  → Le fill utilise un identifiant unlinkable et un fresh wallet jetable.
  → Aucun observateur ne peut relier source et destination.

Concrètement :
  Alice veut bridge 10 USDC de Polkadot Asset Hub vers Hyperliquid Testnet.

  T+0s    Alice dépose 10 USDC dans le PrivacyPool (Polkadot Hub)
          → Secret + destination chiffrés ECIES
          → Event sans adresse utilisateur
  T+Xs    Privacy lock expire (durée choisie par Alice)
  T+Xs    TEE filler déchiffre le secret, trigger le withdraw automatiquement
          → PrivacyPool crée un ordre privé sur IntentGateway (user = Pool)
  T+2s    TEE filler déchiffre la destination, fill avec fresh wallet
          → Bridge USDC2 vers Hyperliquid via Bridge2
          → usdSend du fresh wallet vers l'adresse de destination
  T+10s   TEE settlement : attestation TDX + releaseEscrow
          → Fonds libérés sur Polkadot Hub

  Résultat : Bob (wallet de destination d'Alice) reçoit ~9.99 USDC sur Hyperliquid.
  Personne ne peut prouver que le dépôt d'Alice = le fill de Bob.
```

```
Comparaison avec les autres bridges :

| Critère               | Bridge classique        | Bridge optimistic       | Velora (privacy-first)        |
|-----------------------|------------------------|------------------------|-------------------------------|
| Temps pour l'user     | 15-45 min              | 2-10 min               | ~2s (après privacy lock)      |
| Privacy               | Aucune                 | Aucune                 | 6 couches de protection       |
| Trust assumption      | Comité de validators   | Watcher honnête        | TEE attestation (TDX)         |
| Capital efficiency    | Faible (mint/burn)     | Moyenne (bonding)      | Haute (filler compétitif)     |
| Mixing                | Non                    | Non                    | PrivacyPool time-locked       |
| Destination visible   | Oui                    | Oui                    | Non (ECIES chiffré)           |
| IDs linkables         | Oui                    | Oui                    | Non (fillId unlinkable)       |
```

---

## Architecture Globale

```
┌──────────────────────────────────────────────────────────────────────────┐
│                    Polkadot Asset Hub (Source Chain)                      │
│                                                                          │
│  ┌────────────────────────────────────────────────────────────────────┐  │
│  │                     DepositRouter (Privacy Proxy)                   │  │
│  │  deposit(amount, commitmentHash, encryptedDest, encryptedSecret)   │  │
│  │  → Forward vers PrivacyPool (masque l'adresse de l'utilisateur)    │  │
│  └───────────────────────────┬────────────────────────────────────────┘  │
│                              │                                           │
│  ┌───────────────────────────▼────────────────────────────────────────┐  │
│  │                     PrivacyPool (Mixing Contract)                   │  │
│  │                                                                    │  │
│  │  deposit()  → Lock USDC + enregistre commitment, délai, secrets    │  │
│  │  withdraw() → Vérifie secret, approve → createPrivateOrder()       │  │
│  │  Montants standards : 6, 7, 8, 9, 10 USDC                        │  │
│  │  Time-lock : 0 à 3600 secondes                                    │  │
│  └────────────────────────────────────────────────────────────────────┘  │
│                                                                          │
│  ┌────────────────────────────────────────────────────────────────────┐  │
│  │                     IntentGateway (Escrow)                         │  │
│  │                                                                    │  │
│  │  createPrivateOrder()  → Crée ordre avec encryptedDest             │  │
│  │  markOrderFilled()     → Marque comme rempli (relay)               │  │
│  │  releaseEscrow()       → Libère fonds (attestation TEE)            │  │
│  │  teeEncryptionPubKey() → Clé publique ECIES du TEE                │  │
│  └────────────────────────────────────────────────────────────────────┘  │
│                                                                          │
│  Events :                                                                │
│  PrivacyDeposit(commitmentHash, amount, delay) — PAS d'adresse user     │
│  PrivateOrderPlaced(orderId, user=PrivacyPool, encryptedDest)           │
│  EscrowReleased(orderId, filler, amount)                                │
└──────────────────────┬───────────────────────────────────────────────────┘
                       │
                       │  ① User dépose dans PrivacyPool via DepositRouter
                       │
                       ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                  TEE Filler (Phala dstack CVM — Intel TDX)               │
│                                                                          │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────────┐   │
│  │  PoolWatcher     │  │  Watcher         │  │  Executor            │   │
│  │  Detect deposits │  │  Detect orders   │  │  Decrypt dest        │   │
│  │  Decrypt secrets │  │  from Gateway    │  │  Fresh wallet        │   │
│  │  Trigger withdraw│  │                  │  │  Bridge to HL        │   │
│  └──────────────────┘  └──────────────────┘  │  usdSend to dest    │   │
│                                               └──────────────────────┘   │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────────┐   │
│  │  Settler         │  │  Relay           │  │  API (port 3001)     │   │
│  │  TEE attestation │  │  fillId→sourceId │  │  /api/fill/:orderId  │   │
│  │  releaseEscrow   │  │  markOrderFilled │  │  fillTxHash, fillId  │   │
│  └──────────────────┘  └──────────────────┘  │  freshWallet,        │   │
│                                               │  settleTxHash        │   │
│  3 clés dérivées dans l'enclave :             └──────────────────────┘   │
│  • Wallet (signer tx + attestations)                                     │
│  • Encryption (ECIES decrypt dest + secret)                              │
│  • FillId secret (keccak256 pour fillId unlinkable)                      │
└──────────────────────┬───────────────────────────────────────────────────┘
                       │
                       │  ② TEE decrypt, fill via fresh wallet, bridge to HL
                       │
                       ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                       Arbitrum Sepolia (Destination Chain)                │
│                                                                          │
│  ┌────────────────────────────────────────────────────────────────────┐  │
│  │              IntentSettler (Fill + Settlement)                      │  │
│  │                                                                    │  │
│  │  fillOrder(fillId, recipient, token, amount)                       │  │
│  │  verifyTEESettlement(orderId, attestation, signature)              │  │
│  └────────────────────────────────────────────────────────────────────┘  │
│                                                                          │
│  ┌─────────────────────────────┐  ┌───────────────────────────────────┐  │
│  │  TEEVerifier                │  │  FillerRegistry                   │  │
│  │  verifyAttestation()        │  │  register/stake/slash             │  │
│  │  verifyAttestationWithQuote │  │  reputation tracking              │  │
│  │  TDX quote recording       │  │                                   │  │
│  └─────────────────────────────┘  └───────────────────────────────────┘  │
│                                                                          │
│  Events :                                                                │
│  OrderFilled(fillId, filler, recipient, amount) — fillId ≠ sourceOrderId│
│  TEESettlementVerified(orderId, filler, enclaveSigner)                   │
└──────────────────────────────────────────────────────────────────────────┘
                       │
                       │  ③ USDC2 → Hyperliquid Bridge2 → usdSend (fresh wallet → dest)
                       │
                       ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                       Hyperliquid Testnet                                 │
│                                                                          │
│  Bridge2 : 0x08cfc1B6b2dCF36A1480b99353A354AA8AC56f89                   │
│  Deposit : USDC2.transfer(bridge, amount) — crédité en < 1 min          │
│  usdSend : API L1 — transfert interne wallet → wallet (no gas)          │
│  Minimum : 5 USDC                                                        │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## Pourquoi Polkadot × Hyperliquid ?

| Critère | Bridge classique (Wormhole, etc.) | Velora (Polkadot → Hyperliquid) |
|---------|----------------------------------|-------------------------------------|
| **Privacy** | Aucune — adresses exposées on-chain | 6 couches de protection |
| **Temps utilisateur** | 15-45 min | ~2s (après privacy lock) |
| **Settlement** | Synchronous (bloquant) | TEE attestation async (~5-10s) |
| **Trust model** | Comité multisig / guardian set | TEE attestation (Intel TDX) |
| **Destination visible** | Oui | Non (ECIES chiffré) |
| **Mixing** | Non | PrivacyPool time-locked |
| **Fresh wallet** | Non | Oui — wallet jetable par fill |
| **Destination** | Chaîne EVM générique | Hyperliquid (perps, spot) |

---

## Smart Contracts — Architecture Détaillée

### 1. PrivacyPool (Polkadot Hub — Mixing Contract)

Contrat de mixing time-locked. L'utilisateur dépose des USDC standardisés avec un commitment hash, une destination chiffrée et un secret chiffré. Le TEE filler trigger le retrait automatiquement après expiration du time-lock.

**Fonctions :**

| Fonction | Description |
|----------|-------------|
| `deposit(amount, commitmentHash, encryptedDest, encryptedSecret, delaySeconds)` | Dépose des USDC standardisés (6-10) avec time-lock. Event `PrivacyDeposit` sans adresse user |
| `withdraw(secret, feeOffer, deadline)` | Appelé par le TEE filler — vérifie le secret, approuve USDC, appelle `createPrivateOrder()` sur IntentGateway. `msg.sender = PrivacyPool` |
| `isReady(commitmentHash)` | Vue : vérifie si le time-lock est expiré |
| `remainingLockTime(commitmentHash)` | Vue : temps restant avant withdrawal possible |

**Sécurité :**
- Montants standardisés enforced : `require(standardAmounts[amount])` — seulement 6, 7, 8, 9, 10 USDC
- Time-lock : `require(block.timestamp >= releaseTime)`
- Un commitment ne peut être utilisé qu'une fois
- Secret vérifié : `keccak256(secret) == commitmentHash`
- ReentrancyGuard sur toutes les fonctions mutatives
- Seul le TEE filler appelle `withdraw()` — l'utilisateur ne peut pas

### 2. DepositRouter (Polkadot Hub — Privacy Proxy)

Proxy qui forward les dépôts vers PrivacyPool. Masque l'adresse de l'utilisateur dans les events `Transfer` ERC-20 — la tx montre `from: DepositRouter` au lieu de `from: Alice`.

### 3. IntentGateway (Polkadot Hub — Escrow Source)

Point d'entrée pour les ordres privés. Gère l'escrow des fonds et la libération après settlement TEE.

**Fonctions :**

| Fonction | Description |
|----------|-------------|
| `createPrivateOrder(token, amount, destChain, encryptedDest, feeOffer, deadline)` | Crée un ordre avec destination chiffrée. Appelé par PrivacyPool (pas l'utilisateur). Émet `PrivateOrderPlaced` |
| `markOrderFilled(orderId)` | Appelé par le relay après détection du fill sur la destination |
| `releaseEscrow(orderId, fillerAddress, attestation)` | Vérifie l'attestation TEE et libère les fonds vers le filler |
| `cancelOrder(orderId)` | Annulation par l'utilisateur si deadline dépassée et ordre non rempli |
| `teeEncryptionPubKey()` | Vue : clé publique ECIES du TEE (pour chiffrer dest + secret) |
| `getOrder(orderId)` | Vue : détails complets d'un ordre |
| `getActiveOrders()` | Vue : liste des ordres Pending |

### 4. IntentSettler (Arbitrum Sepolia — Settlement Destination)

Contrat de fill et settlement sur la destination. Le TEE filler appelle `fillOrder()` avec un `fillId` unlinkable.

**Fonctions :**

| Fonction | Description |
|----------|-------------|
| `fillOrder(fillId, recipient, token, amount)` | Le filler front les fonds avec un fillId unlinkable. Émet `OrderFilled` |
| `verifyTEESettlement(orderId, attestation, signature)` | Vérifie l'attestation TEE signée par l'enclave |
| `verifyTEESettlementWithQuote(orderId, attestation, signature, tdxQuote)` | Idem + enregistre le TDX quote hash on-chain |
| `getFill(orderId)` | Vue : détails d'un fill |

### 5. TEEVerifier (Arbitrum Sepolia — Attestation Verification)

Vérifie les attestations TEE et enregistre les TDX quotes on-chain.

| Fonction | Description |
|----------|-------------|
| `verifyAttestation(orderId, attestation, signature)` | Vérifie signature ECDSA de l'enclave |
| `verifyAttestationWithQuote(orderId, attestation, signature, tdxQuote)` | Vérifie + enregistre TDX quote hash |
| `addTrustedEnclave(enclaveAddress)` | Ajoute une enclave de confiance (owner only) |

### 6. FillerRegistry (Arbitrum Sepolia)

Registre des fillers avec staking et réputation.

| Fonction | Description |
|----------|-------------|
| `register(stake)` | Stake USDC comme garantie de solvabilité |
| `recordFill(filler, orderId)` | Enregistre un fill réussi |
| `recordSettlement(filler, orderId)` | Enregistre un settlement réussi |
| `slash(filler, orderId)` | Slash en cas de comportement malveillant |

### 7. Libraries

| Contrat | Description |
|---------|-------------|
| `OrderLib.sol` | Encoding/decoding des ordres, `computeOrderId()`, `computePrivateOrderId()`, status transitions |
| `Constants.sol` | `MIN_FEE_BPS = 5`, `MAX_FEE_BPS = 100`, `FILLER_WINDOW = 30`, `MIN_ORDER_AMOUNT = 1e6`, `MAX_ORDER_AMOUNT = 1_000_000e6` |

---

## Flow complet — Alice bridge 10 USDC

```
T+0s    Alice choisit 10 USDC + adresse destination + délai 30s
        → Frontend chiffre dest + secret avec TEE pubkey (ECIES secp256k1)
        → DepositRouter.deposit(10e6, commitmentHash, encryptedDest, encryptedSecret, 30)
        → PrivacyPool reçoit les 10 USDC
        → Event PrivacyDeposit(commitmentHash, 10e6, 30, encryptedSecret) — pas d'adresse user

T+30s   Privacy lock expire
        → PoolWatcher (TEE) détecte isReady(commitmentHash) == true
        → TEE déchiffre le secret avec la clé privée ECIES
        → TEE appelle PrivacyPool.withdraw(secret, feeOffer, deadline)
        → PrivacyPool crée ordre privé sur IntentGateway
        → Event PrivateOrderPlaced(orderId, user=PrivacyPool, encryptedDest)

T+32s   TEE Executor détecte l'ordre
        → Déchiffre l'adresse de destination (ECIES)
        → Génère fillId = keccak256(sourceOrderId, teeSecret)
        → Crée fresh wallet (clé aléatoire, single-use)
        → Transfert USDC2 + ETH gas vers fresh wallet
        → Fresh wallet appelle USDC2.transfer(HL_BRIDGE_ADDRESS, amount)
        → Attend crédit HL (~30-60s)
        → Fresh wallet exécute usdSend(destination, amount)
        → Vérifie que les fonds sont arrivés
        → Fresh wallet jeté

T+35s   TEE Relay
        → Détecte OrderFilled(fillId) sur Arbitrum Sepolia
        → Mappe fillId → sourceOrderId
        → Appelle markOrderFilled(sourceOrderId) sur IntentGateway

T+40s   TEE Settlement
        → Signe attestation TEE pour sourceOrderId
        → releaseEscrow(sourceOrderId, fillerAddress, attestation)
        → Fonds libérés sur Polkadot Hub
        → Ordre terminé

Total : ~40s (dont 30s de privacy lock choisi par Alice)
Sans privacy lock (instantané) : ~10s total
```

---

## TEE Settlement — Phala dstack

Le filler tourne dans une **Confidential VM** (CVM) Phala dstack basée sur **Intel TDX**.

```
┌─────────────────────────────────────────────────────────────────┐
│                    SETTLEMENT TEE (~5-10s)                        │
│                                                                 │
│  Le filler tourne dans une CVM dstack (Intel TDX).              │
│  3 clés dérivées indépendantes dans l'enclave :                 │
│  • Wallet : signer tx, attestations, trigger withdraws          │
│  • Encryption : déchiffrer dest + secret (ECIES secp256k1)      │
│  • FillId secret : keccak256(sourceOrderId, secret) = unlinkable│
│                                                                 │
│  T+0s    Filler détecte l'ordre PrivateOrderPlaced              │
│  T+1s    Déchiffre dest avec clé ECIES dans le TEE              │
│  T+2s    Génère fillId unlinkable                               │
│  T+3s    Crée fresh wallet, transfert USDC2 + gas               │
│  T+4s    Fresh wallet bridge vers Hyperliquid                    │
│  T+5s    usdSend du fresh wallet → destination                  │
│  T+7s    dstack tdxQuote() → attestation TDX                    │
│  T+8s    Signe attestation avec la clé wallet TEE               │
│  T+9s    releaseEscrow() sur IntentGateway                      │
│  T+10s   Escrow libéré, ordre terminé                           │
│                                                                 │
│  Attestation enregistrée on-chain :                             │
│  • TEEVerifier.AttestationVerified(orderId, signer)             │
│  • TEEVerifier.TDXQuoteRecorded(orderId, tdxQuoteHash)          │
│  • IntentSettler.TEESettlementVerified(orderId, filler, enclave)│
└─────────────────────────────────────────────────────────────────┘
```

**Phala dstack TEE** :
- Le filler tourne dans une Confidential VM (CVM) sur Intel TDX via dstack
- Le wallet est dérivé déterministiquement via `dstack SDK deriveKey("velora/filler/wallet")` — lié à l'identité de l'app (app-id + compose-hash)
- `tdxQuote()` génère une attestation TDX prouvant l'exécution sur hardware authentique
- Les measurements RTMR3 contiennent : app-id, compose-hash, key-provider
- Le contrat `TEEVerifier` vérifie la signature ECDSA + enregistre le TDX quote hash on-chain

**3 modes TEE** :

| Mode | Transport | Clés | Usage |
|------|-----------|------|-------|
| `dstack` | Unix socket `/var/run/dstack.sock` | Dérivées par dstack KMS (liées à l'app-id) | Production (Phala Cloud) |
| `simulator` | HTTP `localhost:8090` | Dérivées par simulateur | Dev local avec Docker |
| `mock` | Aucun | Dérivées de `TEE_PRIVATE_KEY` via keccak256 | Hackathon / tests |

---

## Route — Polkadot → Arbitrum Sepolia → Hyperliquid Testnet

```
Polkadot Hub (source)  →  Arbitrum Sepolia (destination)  →  Hyperliquid Testnet (trading)
     [PrivacyPool +          [fill + settle]                    [Bridge2 + usdSend]
      IntentGateway]

T+0s    Lock USDC dans PrivacyPool sur Polkadot Hub
T+Xs    Privacy lock expire, TEE trigger withdraw
T+2s    TEE fill via fresh wallet sur Arbitrum Sepolia
T+3s    Fresh wallet bridge USDC2 vers Hyperliquid
T+4s    Fresh wallet usdSend vers destination
T+10s   TEE settlement (attestation TDX + releaseEscrow)
```

**USDC2** sur Arbitrum Sepolia : `0x1baAbB04529D43a73232B713C0FE471f7c7334d5`
Ce token est compatible avec le bridge officiel Hyperliquid Testnet. Minimum 5 USDC.

---

## Frontend — Flow Utilisateur

```
Step 1: Connecter wallet EVM (MetaMask, Rabby) sur Polkadot Hub Testnet
        → Si besoin, mint 10 USDC via le Faucet (fast polling, ~2-3s)

Step 2: Choisir le montant (6-10 USDC, nombres entiers uniquement)
        → Bouton MAX : sélectionne le solde du wallet (clampé 6-10)
        → Bouton MIN : sélectionne 6 USDC
        → Toast d'explication si montant invalide (< 6, > 10, décimal)

Step 3: Configurer le privacy lock (rouage)
        → Instant, 15s, 30s, 1 min, ou custom (jusqu'à 1h)

Step 4: (Optionnel) Entrer une adresse de destination différente
        → Pour une privacy maximale, utiliser un wallet séparé

Step 5: Cliquer "Bridge" → Approve USDC → Deposit dans PrivacyPool
        → Countdown de privacy lock affiché
        → Steps visuels : Approve → Deposit → Privacy Lock → Filler → Settlement

Step 6: Écran de completion
        → "Bridge Complete" avec checkmark vert
        → Montant envoyé et reçu (fees déduits, 2 décimales)
        → TX hashes avec liens : Withdraw TX, Deposit TX, HL Bridge TX
        → Fresh Wallet address avec bouton copier
        → TEE Settlement TX → lien Arbiscan
        → Escrow Release TX → lien Polkadot Blockscout
        → Section "TEE Trace" : badge vert "Verified by TEE (dstack)"
          avec Fill ID, Single-use Wallet, Attestation TX
```

---

## Fees & Distribution

```
Ordre de 10 USDC avec feeBps = 10 (0.1%)

Alice (User)                          TEE Filler
  │                                     │
  │  deposit 10 USDC → PrivacyPool     │
  │  ────────────────────►              │
  │  (via DepositRouter)                │
  │                                     │
  │  ~~ privacy lock ~~                │
  │                                     │
  │                                     │  TEE decrypt secret
  │                                     │  withdraw → createPrivateOrder
  │                                     │  TEE decrypt dest
  │                                     │  fillOrder via fresh wallet
  │                                     │  bridge to HL + usdSend
  │                                     │
  │  Bob reçoit ~9.99 USDC sur HL      │
  │  ◄────────────────────              │
  │  (montant tronqué à 2 décimales)   │
  │                                     │
  │  ~~ TEE settlement ~~              │
  │                                     │
  │                                     │  releaseEscrow()
  │                                     │  récupère 10 USDC sur Polkadot Hub
  │                                     │
  │  Profit filler : 0.01 USDC (fee)   │

Résultat :
  Alice : a déposé 10 USDC, Bob a reçu ~9.99 USDC sur Hyperliquid
  Filler : a immobilisé les fonds ~10s, gagné 0.01 USDC
  Privacy : aucun lien prouvable entre Alice et Bob
```

**Fee calculation (frontend) :**
```
feeAmount = (amountWei * feeBps) / 10000
rawReceive = amountWei - feeAmount
receiveAmount = truncate(rawReceive, 2 decimals)  // match HL usdSend precision
```

---

## Config Réseau

### Hackathon Demo (Testnet)

| Config | Valeur |
|--------|--------|
| **Source Chain** | Polkadot Hub Testnet (chain 420420417) |
| **Destination Chain** | Arbitrum Sepolia (chain 421614) |
| **Final Destination** | Hyperliquid Testnet |
| **TEE Mode** | `mock` (hackathon) / `simulator` (dev) / `dstack` (production) |
| **Relay** | Bot filler (appelle `markOrderFilled` sur source après détection du fill sur dest) |
| **Settlement** | TEE attestation via filler service (~5-10s) |
| **Privacy Pool** | PrivacyPool.sol sur Polkadot Hub (6-10 USDC, time-lock 0-3600s) |

---

## Structure du Projet

```
velora/
├── contracts/
│   ├── src/
│   │   ├── source/
│   │   │   ├── IntentGateway.sol          # Escrow source, createPrivateOrder, releaseEscrow
│   │   │   └── PrivacyPool.sol            # Mixing pool time-locked (6-10 USDC), deposit/withdraw
│   │   ├── destination/
│   │   │   ├── IntentSettler.sol           # Fill orders (fillId unlinkable), TEE settlement verification
│   │   │   └── FillerRegistry.sol         # Registre fillers, staking, réputation
│   │   ├── settlement/
│   │   │   └── TEEVerifier.sol            # Vérification attestations TEE (Phala dstack) + TDX quotes
│   │   ├── libs/
│   │   │   ├── OrderLib.sol               # Encoding/decoding ordres, hash, status transitions
│   │   │   └── Constants.sol              # Paramètres protocole, chain IDs, timeouts
│   │   └── interfaces/
│   │       ├── IIntentGateway.sol         # Interface escrow source
│   │       ├── IIntentSettler.sol         # Interface settlement destination
│   │       ├── IFillerRegistry.sol        # Interface registre fillers
│   │       └── ITEEVerifier.sol           # Interface TEE attestation
│   ├── test/
│   │   ├── IntentGateway.t.sol            # Tests escrow
│   │   ├── IntentSettler.t.sol            # Tests settlement
│   │   ├── PrivacyPool.t.sol              # Tests privacy pool
│   │   ├── TEEVerifier.t.sol              # Tests TEE attestation + TDX quotes
│   │   ├── FillerRegistry.t.sol           # Tests registre
│   │   ├── EndToEnd.t.sol                 # Tests E2E
│   │   └── mocks/
│   │       └── MockERC20.sol              # Mock ERC20 pour tests
│   ├── script/
│   │   ├── DeployAssetHub.s.sol           # Déploiement source (Polkadot Hub Testnet)
│   │   ├── DeployArbitrumSepolia.s.sol    # Déploiement destination (Arb Sepolia)
│   │   └── DeployTEEVerifier.s.sol        # Déploiement TEEVerifier
│   └── foundry.toml
│
├── filler/                                 # Service off-chain du filler TEE
│   ├── src/
│   │   ├── index.ts                       # Entry point, orchestration
│   │   ├── pool-watcher.ts               # Watch PrivacyDeposit events, decrypt secrets, trigger withdraw
│   │   ├── watcher.ts                     # Watch PrivateOrderPlaced events sur source chain
│   │   ├── executor.ts                    # Decrypt dest, fresh wallet, bridge HL, usdSend
│   │   ├── settler.ts                     # TEE attestation settlement + releaseEscrow
│   │   ├── relay.ts                       # Cross-chain relay (markOrderFilled)
│   │   ├── state.ts                       # Lifecycle tracking (DETECTED → RELEASED)
│   │   ├── tee.ts                         # Client TEE Phala dstack (3 clés, attestation, ECIES)
│   │   ├── api.ts                         # HTTP API (fillTxHash, freshWallet, settleTxHash, fillId)
│   │   └── config.ts                      # RPC, clés, paramètres multi-chain
│   ├── package.json
│   ├── tsconfig.json
│   ├── Dockerfile
│   └── docker-compose.yml
│
├── frontend/                               # Interface utilisateur
│   ├── src/
│   │   ├── App.jsx                        # Router principal, layout
│   │   ├── main.jsx                       # Entry point React
│   │   ├── components/
│   │   │   ├── BridgeWidget.jsx           # Widget bridge (state machine complète + validation toast + TEE trace)
│   │   │   ├── ConnectButton.jsx          # Connexion wallet EVM
│   │   │   ├── FaucetButton.jsx           # Mint 10 USDC (fast polling ~2-3s)
│   │   │   └── ...                        # Plasma, Menu, ProfileCard, etc.
│   │   └── config/
│   │       ├── contracts.js               # Adresses déployées, ABIs, chain configs
│   │       └── wagmi.js                   # Configuration wagmi (chains, transports)
│   └── package.json
│
├── README.md                               # Documentation principale (EN)
├── POLKADOT.md                             # Ce fichier — documentation technique détaillée (FR)
└── Velora.md                               # Documentation privacy design (FR)
```

---

## Tests

### Suite de Tests

```bash
# Lancer tous les tests (83 tests)
cd contracts && forge test -vvv

# Tests fuzz
forge test --match-test testFuzz -vvv

# Coverage
forge coverage
```

---

## Ce qui est implémenté

### Smart Contracts

| Contrat | État | Description |
|---------|------|-------------|
| PrivacyPool | Implémenté | Mixing pool time-locked, montants standards (6-10 USDC), encrypted secrets, TEE-only withdraw |
| DepositRouter | Implémenté | Privacy proxy — masque l'adresse user dans les events Transfer |
| IntentGateway | Implémenté | Escrow source, createPrivateOrder (ECIES encrypted dest), releaseEscrow (TEE attestation), TEE pubkey storage |
| IntentSettler | Implémenté | Fill avec fillId unlinkable, verifyTEESettlement, verifyTEESettlementWithQuote |
| TEEVerifier | Implémenté | Vérification attestations TEE + TDX quote recording on-chain |
| FillerRegistry | Implémenté | Registre fillers, staking, réputation, slash |
| OrderLib | Implémenté | Encoding/decoding, computePrivateOrderId, status transitions |
| Constants | Implémenté | Paramètres protocole |

### Filler Service

| Module | État | Description |
|--------|------|-------------|
| PoolWatcher | Implémenté | Détecte PrivacyDeposit, déchiffre secrets, trigger withdraw après time-lock |
| Watcher | Implémenté | Détecte PrivateOrderPlaced events sur source chain |
| Executor | Implémenté | Déchiffre destination, crée fresh wallet, bridge vers HL, usdSend vers dest |
| Settler | Implémenté | TEE attestation settlement dual-chain + releaseEscrow |
| Relay | Implémenté | Cross-chain relay (markOrderFilled sur source après fill sur dest) |
| State | Implémenté | Tracking complet : DETECTED → FILLING → FILLED → SETTLING → SETTLED → RELEASED |
| TEE | Implémenté | Client Phala dstack : 3 clés dérivées, attestation TDX, ECIES decrypt, fillId generation |
| API | Implémenté | HTTP API : fillTxHash, freshWalletAddress, settleTxHash, releaseTxHash, fillId |

### Frontend

| Feature | État | Description |
|---------|------|-------------|
| Bridge Widget | Implémenté | State machine complète : approve → deposit pool → privacy lock → fill → settle → complete |
| Fast Faucet | Implémenté | Mint 10 USDC avec fast polling (500ms, ~2-3s confirmation) et gas explicite |
| Max Button | Implémenté | Sélectionne le solde wallet (clampé 6-10 USDC) |
| Amount Validation | Implémenté | Toast bottom-right pour montants invalides (< 6, > 10, décimaux) |
| TEE Trace | Implémenté | Écran completion avec fresh wallet, settlement TX, fill ID, badge "Verified by TEE" |
| Track Tab | Implémenté | Monitoring d'ordres par ID avec polling live |
| Wallet Connect | Implémenté | Connexion wallet EVM (MetaMask, Rabby, etc.) |

---

## Sécurité & Risques

### Protections Implémentées

```
1. Privacy Pool mixing
   → Les fonds sont mélangés dans le pool avec d'autres dépôts du même montant
   → Time-lock configurable empêche le retrait immédiat
   → L'ordre est créé par le pool (pas l'utilisateur)

2. ECIES encryption (destination + secret)
   → Seul le TEE peut déchiffrer l'adresse de destination
   → Seul le TEE peut déchiffrer le secret de retrait
   → Les blobs on-chain sont opaques

3. Unlinkable fillId
   → keccak256(sourceOrderId, teeSecret)
   → Pas de lien on-chain entre source et destination

4. Fresh wallet single-use
   → Un wallet aléatoire est créé pour chaque fill
   → Les fonds transitent par ce wallet avant d'arriver à destination
   → Le wallet est jeté après usage — pas de pattern traçable

5. TEE attestation (Intel TDX)
   → Le filler prouve qu'il a exécuté correctement dans une enclave
   → TDX quote enregistré on-chain pour auditabilité
   → Wallet TEE dérivé déterministiquement (lié à l'app-id)

6. Double-fill protection
   → Un orderId ne peut être fill qu'une seule fois
   → fillOrder() revert si le fill existe déjà

7. Deadline enforcement
   → Après deadline : cancelOrder() possible
   → Avant deadline : annulation impossible

8. ReentrancyGuard
   → Toutes les fonctions mutatives sont protégées

9. Standardized amounts
   → Seulement 6, 7, 8, 9, 10 USDC enforced dans le contrat
   → Frontend affiche toast si montant invalide
```

---

## Dependencies

### Contracts (Solidity / Foundry)

| Package | Usage |
|---------|-------|
| OpenZeppelin 5.x | ERC-20, SafeERC20, ReentrancyGuard, Pausable, Ownable |
| forge-std | Testing framework, Script, console2 |

### Filler (Node.js / TypeScript)

| Package | Usage |
|---------|-------|
| ethers v6 | Interaction EVM (Polkadot Hub + Arbitrum Sepolia) |
| @phala/dstack-sdk | TEE client (TappdClient, deriveKey, tdxQuote) |
| eciesjs | ECIES encryption/decryption secp256k1 |

### Frontend (React / JavaScript)

| Package | Usage |
|---------|-------|
| react 19 | Framework UI |
| vite | Bundler + dev server |
| wagmi v3 + viem | Interaction EVM, contract reads/writes |
| @tanstack/react-query | Data fetching (wagmi dependency) |
| eciesjs | ECIES encryption (destination + secret) |
| motion/react | Animations (Framer Motion) |
| gsap + ogl | Background WebGL + menu animations |
| react-router-dom | Routing |

---

## Références

| Ressource | Lien |
|-----------|------|
| Phala dstack — Confidential VMs | `https://github.com/Phala-Network/dstack` |
| ERC-7683 — Cross-Chain Intents Standard | `https://eips.ethereum.org/EIPS/eip-7683` |
| Hyperbridge — Interoperability Protocol | `https://docs.hyperbridge.network` |
| ISMP — Interoperable State Machine Protocol | `https://docs.hyperbridge.network/protocol/ismp` |
| Polkadot BEEFY | `https://wiki.polkadot.network/docs/learn-beefy` |
| Hyperliquid — Documentation | `https://hyperliquid.gitbook.io/hyperliquid-docs` |
| Hyperliquid — Testnet Bridge | `https://app.hyperliquid-testnet.xyz` |
| OpenZeppelin Contracts 5.x | `https://docs.openzeppelin.com/contracts` |
| Foundry Book | `https://book.getfoundry.sh` |

---
