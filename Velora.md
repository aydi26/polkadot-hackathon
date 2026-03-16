# Velora — Privacy-First Cross-Chain Bridge

## Vue d'ensemble

Velora est un bridge cross-chain **privacy-first** basé sur les intents : **Polkadot Hub → Arbitrum Sepolia → Hyperliquid Testnet**. Tous les dépôts sont anonymes par défaut.

L'utilisateur dépose des USDC dans un **PrivacyPool** (contrat de mixing sur Polkadot Hub). Un filler tournant dans un **TEE dstack** (Confidential VM, Intel TDX) déchiffre le secret de retrait, trigger le withdraw automatiquement, déchiffre la destination, fill l'ordre avec un identifiant unlinkable, et dépose sur Hyperliquid via un **fresh wallet single-use** puis un `usdSend` vers l'adresse de destination.

**TEE-only** : Pas de fallback, pas de Classic Bridge. Le filler TEE est requis pour toutes les opérations. Settlement via attestation TDX (~5-10s).

---

## Le Flow complet

### Étape 1 — L'utilisateur prépare son bridge (Frontend)

1. L'utilisateur connecte son **wallet A** sur **Polkadot Hub Testnet** (chain ID 420420417)
2. Il peut mint 10 USDC via le **Faucet** (confirmation rapide ~2-3s grâce au fast polling)
3. Il choisit un **montant standardisé** : 6, 7, 8, 9 ou 10 USDC
   - Le bouton **MAX** sélectionne le solde du wallet (clampé entre 6 et 10 USDC)
   - Le bouton **MIN** sélectionne 6 USDC
   - Si un montant invalide est entré (< 6, > 10, ou décimal), un **toast d'explication** apparaît en bas à droite
4. Il peut entrer une **adresse de destination** différente (wallet B) pour une privacy maximale
5. Il configure un **délai de privacy lock** via le rouage (Instant, 15s, 30s, 1 min, ou custom jusqu'à 1h)
6. Il clique sur "Bridge"

### Étape 2 — Chiffrement + Dépôt dans le PrivacyPool (Frontend → DepositRouter → PrivacyPool)

Le frontend :

1. Génère un **secret** aléatoire (32 bytes) et calcule le `commitmentHash = keccak256(secret)`
2. Lit la **clé publique du TEE** depuis IntentGateway (`teeEncryptionPubKey()`)
3. **Chiffre** l'adresse de destination (ECIES secp256k1) → `encryptedDest`
4. **Chiffre** le secret (ECIES secp256k1) → `encryptedSecret`
5. Appelle `DepositRouter.deposit(amount, commitmentHash, encryptedDest, encryptedSecret, delaySeconds)`
   - Le DepositRouter fait proxy vers PrivacyPool pour masquer l'adresse de l'utilisateur dans les events Transfer
6. Stocke le secret en `localStorage` (backup pour récupération manuelle)

**Ce qui est visible on-chain :**
- L'event `PrivacyDeposit(commitmentHash, amount, delaySeconds, encryptedSecret)` — **pas d'adresse utilisateur**
- La tx montre `from: DepositRouter → PrivacyPool` (pas l'utilisateur directement)
- Le `encryptedDest` et `encryptedSecret` sont des blobs opaques

**Ce qui est invisible :**
- L'adresse de destination (chiffrée)
- Le secret de retrait (chiffré)
- Le lien entre le déposant et l'ordre qui sera créé

### Étape 3 — Privacy Lock (on-chain time-lock)

Les fonds restent lockés dans le PrivacyPool pendant le délai choisi :
- Le contrat enforce `block.timestamp >= releaseTime` avant tout retrait
- Pendant ce temps, les fonds se mélangent avec d'autres dépôts du même montant
- Le frontend affiche un countdown : "Privacy lock: 0:28"

### Étape 4 — Le filler TEE trigger le withdraw automatiquement

Le **PoolWatcher** dans le filler :

1. Détecte l'event `PrivacyDeposit` sur le PrivacyPool
2. Attend que `isReady(commitmentHash)` retourne `true` (time-lock expiré)
3. **Déchiffre le secret** dans le TEE avec la clé privée ECIES
4. Appelle `PrivacyPool.withdraw(secret, feeOffer, deadline)` **depuis le wallet TEE**

Le PrivacyPool :
1. Vérifie `keccak256(secret) == commitmentHash`
2. Approuve les USDC vers IntentGateway
3. Appelle `IntentGateway.createPrivateOrder()` — `msg.sender = PrivacyPool` (pas l'utilisateur !)

**On-chain :** La tx de withdraw montre `from: wallet_TEE → PrivacyPool`. L'event `PrivateOrderPlaced` montre `user = PrivacyPool`. Aucun lien avec l'utilisateur original.

### Étape 5 — Le filler fill sur Arbitrum Sepolia (Inside TEE)

L'**Executor** dans le TEE :

1. Détecte l'event `PrivateOrderPlaced` sur IntentGateway
2. **Déchiffre** l'adresse de destination avec la clé privée ECIES
3. **Génère un fillId unlinkable** : `keccak256(sourceOrderId, teeSecret)`
4. **Crée un fresh wallet single-use** (clé aléatoire, utilisé une seule fois puis jeté)
5. Transfère les USDC + ETH gas vers le fresh wallet
6. Le fresh wallet bridge les USDC vers Hyperliquid via `USDC2.transfer(HL_BRIDGE_ADDRESS, amount)`
7. Attend que le crédit arrive sur HL (~30-60s)
8. Exécute `usdSend` du fresh wallet vers l'adresse de destination déchiffrée
9. Vérifie que les fonds ont quitté le fresh wallet et sont arrivés à destination

**Résultat :** L'adresse de destination reçoit les USDC sur Hyperliquid. Le fresh wallet est jeté — aucun lien traçable.

### Étape 6 — Relay + Settlement TEE (Filler Service)

**Relay :**
1. Détecte `OrderFilled(fillId)` sur Arbitrum Sepolia
2. Mappe `fillId → sourceOrderId` via le state interne
3. Appelle `markOrderFilled(sourceOrderId)` sur IntentGateway

**Settlement (double attestation TEE) :**
1. Signe une attestation TEE avec `sourceOrderId` → `releaseEscrow(sourceOrderId)` sur IntentGateway (source)
2. Les attestations ne se référencent jamais mutuellement — unlinkable
3. Escrow libéré sur Polkadot Hub → filler remboursé

### Étape 7 — Écran de completion (Frontend)

Le frontend affiche :
- **Bridge Complete** avec checkmark vert
- Montant envoyé et reçu (avec fees déduits, 2 décimales)
- **Order ID** avec bouton copier
- **Withdraw TX** → lien vers Polkadot Blockscout
- **Deposit TX** → lien vers Polkadot Blockscout
- **HL Bridge TX** → lien vers Arbiscan
- **Fresh Wallet** → adresse du wallet single-use avec bouton copier
- **TEE Settlement TX** → lien vers Arbiscan (attestation on-chain)
- **Escrow Release TX** → lien vers Polkadot Blockscout

**Section TEE Trace :**
- Badge "Verified by TEE (dstack)" avec icône shield vert
- **Fill ID** (unlinkable, monospace) avec bouton copier
- **Single-use Wallet** adresse avec bouton copier
- **Attestation TX** lien vers Arbiscan

---

## Privacy — 6 couches de protection

| Couche | Mécanisme | Ce qu'elle protège |
|--------|-----------|-------------------|
| **1. PrivacyPool mixing** | Contrat de mixing avec time-lock sur Polkadot Hub | L'ordre est créé par le pool (user = PrivacyPool, pas l'utilisateur) |
| **2. Encrypted destination** | ECIES secp256k1 | L'adresse de destination est un blob illisible on-chain |
| **3. Encrypted secret** | ECIES secp256k1 | Le secret de retrait est chiffré — seul le TEE peut trigger le withdraw |
| **4. Unlinkable fillId** | `keccak256(sourceOrderId, teeSecret)` | Pas de lien on-chain entre les deux chaînes |
| **5. TEE anonymous wallet** | Wallet dérivé dans l'enclave dstack | Tous les fills + withdraws passent par le même intermédiaire |
| **6. Montants standardisés** | 6, 7, 8, 9, 10 USDC | Empêche la corrélation par montant unique |

### Ce qu'un observateur voit

**Sur Polkadot Hub :**
```
# Dépôt dans le pool (tx de l'utilisateur via DepositRouter)
Transfer(from: DepositRouter, to: PrivacyPool, 10 USDC)
PrivacyDeposit(commitmentHash: 0xABC..., amount: 10, delay: 30, encryptedSecret: 0x04fa...)
→ Pas d'adresse utilisateur dans l'event

# Withdraw (tx du filler TEE)
PrivacyWithdraw(commitmentHash: 0xABC...)
PrivateOrderPlaced(orderId: 0x3414..., user: PrivacyPool, encryptedDest: 0x04d8...)
→ user = PrivacyPool, pas Alice
→ La tx vient du wallet TEE, pas d'Alice
```

**Sur Arbitrum Sepolia :**
```
OrderFilled(
  fillId: 0xc034...,      ← ID différent de 0x3414 (unlinkable)
  filler: 0x9417...,      ← wallet TEE (même pour tous les fills)
  recipient: 0xBob...,    ← visible, mais pas lié à Alice
  amount: 10 USDC
)
```

**Sur Hyperliquid :**
```
usdSend(
  from: 0xFresh...,       ← fresh wallet single-use (jeté après)
  to: 0xBob...,           ← destination
  amount: 9.99 USDC       ← montant net (fees déduites, tronqué à 2 décimales)
)
```

**Conclusion :** Un observateur voit qu'Alice a déposé 10 USDC dans le pool, et que Bob a reçu ~9.99 USDC sur Hyperliquid. Mais il ne peut **pas prouver** que le dépôt d'Alice correspond au fill de Bob :
- Le dépôt n'a pas d'adresse dans l'event (DepositRouter masque Alice)
- L'ordre a été créé par le PrivacyPool (pas Alice)
- Le withdraw a été fait par le filler TEE (pas Alice)
- Le fillId ≠ sourceOrderId
- Le dépôt HL vient d'un fresh wallet single-use (pas le filler TEE)
- Avec d'autres dépôts de 10 USDC dans le pool, c'est impossible à corréler

---

## Architecture technique

```
Source (Polkadot Hub)              TEE Filler (dstack CVM)            Destination (Arb Sepolia)
┌──────────────────┐               ┌──────────────────┐              ┌──────────────────┐
│ DepositRouter    │               │ PoolWatcher      │              │ IntentSettler     │
│  deposit() proxy │               │  Decrypt secret  │              │  fillOrder(fillId)│
│                  │               │  Trigger withdraw │              │  verifyTEESettlement()
│ PrivacyPool      │               │                  │              │                  │
│  deposit()       │──event───────►│ Watcher          │              │ TEEVerifier       │
│  withdraw()      │◄──tx─────────│  Detect orders   │              │  verifyAttestation()
│                  │               │                  │              │  TDX quote record │
│ IntentGateway    │               │ Executor         │              │                  │
│  createPrivateOrder()            │  Decrypt dest    │─────────────►│ FillerRegistry    │
│  releaseEscrow() │  ◄───────────│  Fresh wallet    │              └──────────────────┘
│  teeEncryptionPubKey             │  Bridge to HL    │                       │
│                  │               │  usdSend to dest │              Hyperliquid Testnet
│                  │               │                  │              (Bridge2 + usdSend)
│                  │               │ Settler          │
│                  │               │  TEE attestation │
└──────────────────┘               │  releaseEscrow   │
                                   │ Relay            │
                                   │  fillId→sourceId │
                                   │ API              │
                                   │  /api/fill/:id   │
                                   │  freshWallet,    │
                                   │  settleTxHash,   │
                                   │  fillId          │
                                   └──────────────────┘
```

## Contrats déployés

| Contrat | Adresse | Chaîne |
|---------|---------|--------|
| PrivacyPool | `0x12569697a1A20a9e850Cce09F2D5e517CDB7a42F` | Polkadot Hub Testnet |
| IntentGateway | `0x10507B42691793b2E93179300D8008B849189665` | Polkadot Hub Testnet |
| IntentSettler | `0x821d957c3cBE99ED4144Ae675AE44fd80E32223d` | Arbitrum Sepolia |
| TEEVerifier | `0xC2DdC138A80136a30E0f5731954d765099ba270A` | Arbitrum Sepolia |
| FillerRegistry | `0xF1cdf11e0919dE9a2978dF58C621f4487Af24EdF` | Arbitrum Sepolia |
| USDC (source) | `0xb5C8B011f9EBDBB73cd9EF89aCdb05d64Cd972b2` | Polkadot Hub Testnet |
| USDC2 (dest) | `0x1baAbB04529D43a73232B713C0FE471f7c7334d5` | Arbitrum Sepolia |
| HL Bridge2 | `0x08cfc1B6b2dCF36A1480b99353A354AA8AC56f89` | Arbitrum Sepolia |

## TEE — 3 modes

| Mode | Transport | Clés | Usage |
|------|-----------|------|-------|
| `dstack` | Unix socket `/var/run/dstack.sock` | Dérivées par dstack KMS (liées à l'app-id) | Production (Phala Cloud) |
| `simulator` | HTTP `localhost:8090` | Dérivées par simulateur | Dev local avec Docker |
| `mock` | Aucun | Dérivées de `TEE_PRIVATE_KEY` via keccak256 | Hackathon / tests |

Chaque mode dérive 3 clés indépendantes :
- **Wallet** (`velora/filler/wallet`) → signer les tx, attestations, et trigger les withdraws
- **Encryption** (`velora/filler/encryption`) → clé publique ECIES (sur le contrat) + clé privée (déchiffrement dest + secret dans l'enclave)
- **FillId secret** (`velora/filler/fillid-secret`) → `keccak256(sourceOrderId, secret)` = fillId unlinkable

## Filler API

Le service filler expose une API HTTP (port 3001) :

| Endpoint | Description |
|----------|-------------|
| `GET /api/fill/:orderId` | Retourne les détails d'un fill : `fillTxHash`, `freshWalletAddress`, `settleTxHash`, `releaseTxHash`, `fillId`, `status`, `filledAt`, `settledAt` |
| `GET /api/fills` | Liste tous les fills avec leurs détails |

Le frontend utilise cette API pour afficher le TEE trace sur l'écran de completion.

## Comment vérifier la privacy d'un dépôt

1. **Polkadot Hub** — Cherche l'event `PrivacyDeposit` : il n'a PAS d'adresse utilisateur, juste un commitmentHash
2. **Polkadot Hub** — Cherche l'event `PrivateOrderPlaced` : le champ `user` = adresse du PrivacyPool (pas toi)
3. **Polkadot Hub** — La tx de withdraw vient du wallet TEE filler (pas de toi)
4. **Arbitrum Sepolia** — Le `fillId` dans `OrderFilled` est différent du `sourceOrderId` sur Polkadot
5. **Hyperliquid** — Le `usdSend` vient d'un fresh wallet single-use (pas le TEE wallet)
6. **Cross-chain** — Cherche le `sourceOrderId` sur Arbitrum : introuvable. Cherche le `fillId` sur Polkadot : introuvable.

## Stack technique

| Composant | Technologies |
|-----------|-------------|
| Contracts | Solidity 0.8.24, Foundry, OpenZeppelin 5.x |
| Filler | TypeScript, ethers v6, @phala/dstack-sdk, eciesjs |
| Frontend | React 19, Vite, wagmi v3, viem, motion/react, eciesjs |
| TEE | Phala dstack (Intel TDX), TappdClient SDK |
| Encryption | ECIES secp256k1 (eciesjs) |
| Mixing | PrivacyPool.sol (time-locked mixing pool on Polkadot Hub) |
| Bridge | Hyperliquid Bridge2 (USDC2 transfer) + usdSend API |
