# Velora — Privacy-First Cross-Chain Bridge

## Vue d'ensemble

Velora est un bridge cross-chain **privacy-first** basé sur les intents : **Polkadot Hub → Arbitrum Sepolia → Hyperliquid Testnet**. Tous les dépôts sont anonymes par défaut.

L'utilisateur lock des USDC sur Polkadot Hub. Un filler tournant dans un **TEE Phala dstack** (Confidential VM, Intel TDX) déchiffre la destination, fill l'ordre avec un identifiant unlinkable, et les fonds sont déposés sur Hyperliquid.

---

## Le Flow complet

### Étape 1 — L'utilisateur prépare son bridge (Frontend)

1. L'utilisateur connecte son wallet sur **Polkadot Hub Testnet** (chain ID 420420417)
2. Il choisit un **montant standardisé** : Min (5.005005), 6, 7, 8, 9 ou 10 USDC
3. Il peut configurer un **délai de livraison** via le rouage (Instant, 15 min, 30 min, 1 heure)
4. Il clique sur "Bridge"

### Étape 2 — Chiffrement ECIES (Frontend, côté navigateur)

Avant de soumettre la transaction, le frontend :

1. Lit la **clé publique du TEE** depuis le contrat IntentGateway (`teeEncryptionPubKey()` — 33 bytes secp256k1 compressé)
2. **Chiffre l'adresse de destination** avec ECIES secp256k1 → blob de ~117 bytes
3. Appelle `createPrivateOrder(token, amount, destChain, encryptedDest, feeOffer, deadline)`

**Ce qui est visible on-chain sur Polkadot Hub :**
- L'adresse de l'utilisateur (il signe la tx)
- Le montant et le token
- Le blob `encryptedDest` (illisible sans la clé privée du TEE)
- `destAddress = address(0)` dans le storage (caché)

**Ce qui est invisible :**
- L'adresse de destination réelle

### Étape 3 — Le countdown démarre (Frontend)

Dès que la transaction est confirmée :
- Le frontend extrait le `sourceOrderId` des logs
- Si un délai de livraison est configuré (ex: 15 min), le **countdown démarre immédiatement**
- Le timer s'affiche : "Anonymizing... Deposit in 14:32"
- Le fill et le settlement se font **en background** pendant le countdown

### Étape 4 — Le filler détecte l'ordre (Filler Service)

Le **Watcher** poll la source chain toutes les 4 secondes et détecte l'event `PrivateOrderPlaced` :

```
orderId:       0x3d469b42...
user:          0x9417...
amount:        7.0 USDC
encryptedDest: 0x04d8e78a... (blob ECIES)
```

Le filler :
1. **Pré-calcule le fillId** : `keccak256(sourceOrderId, teeSecret)` → `0xff6a48cd...`
2. Évalue la profitabilité (fee en bps vs seuil minimum)
3. Si profitable, passe à l'exécution

### Étape 5 — Déchiffrement + Fill (Inside TEE)

L'**Executor** dans le TEE :

1. **Déchiffre** l'adresse de destination avec la clé privée ECIES du TEE
   - Seule l'enclave possède cette clé → personne d'autre ne peut déchiffrer
2. **Appelle** `fillOrder(fillId, recipient, USDC2, amount)` sur IntentSettler (Arbitrum Sepolia)
   - `fillId` ≠ `sourceOrderId` → pas de lien on-chain entre les deux chaînes
   - `recipient` = l'adresse déchiffrée
   - Les USDC2 sont transférés du wallet TEE vers le recipient

**Ce qui est visible on-chain sur Arbitrum Sepolia :**
- `OrderFilled(fillId, filler, recipient, amount)`
- Le `fillId` (mais pas le `sourceOrderId`)
- L'adresse du recipient (visible, mais pas liée au sourceOrderId)

**Ce qui est invisible :**
- Le lien `fillId ↔ sourceOrderId` (connu uniquement dans le TEE)

### Étape 6 — Relay cross-chain (Filler Service)

Le **CrossChainRelay** :
1. Détecte l'event `OrderFilled(fillId)` sur Arbitrum Sepolia
2. Cherche le `sourceOrderId` correspondant via le state interne (`findByFillId`)
3. Appelle `markOrderFilled(sourceOrderId)` sur IntentGateway (Polkadot Hub)
4. Le status de l'ordre passe de `Pending` → `Filled`

### Étape 7 — Settlement TEE (Filler Service)

Le **SettlementMonitor** attend 5 secondes après le fill, puis :

**Attestation destination (fillId) :**
1. Signe une attestation TEE avec le `fillId` comme orderId
2. En mode dstack : génère un **TDX attestation quote** (preuve hardware Intel TDX)
3. Appelle `verifyTEESettlement(fillId, attestation, signature)` sur IntentSettler
4. Le TEEVerifier vérifie : signature ECDSA, enclave trusted, replay protection, fraîcheur
5. Si TDX quote : appelle `verifyTEESettlementWithQuote()` → émet `TDXQuoteRecorded`
6. Fill marqué comme `settled`

**Attestation source (sourceOrderId) :**
1. Signe une attestation TEE avec le `sourceOrderId`
2. Appelle `releaseEscrow(sourceOrderId, fillerAddress, attestation)` sur IntentGateway
3. Les USDC lockés en escrow sont libérés vers le wallet TEE (le filler)
4. Ordre marqué comme `Settled`

**Séparation critique :** Les deux attestations ne se référencent jamais mutuellement. Un observateur voit `fillId` settled sur Arbitrum et `sourceOrderId` settled sur Polkadot, mais ne peut pas prouver qu'ils correspondent.

### Étape 8 — Dépôt sur Hyperliquid (Frontend)

Quand **les deux conditions** sont remplies :
- Le countdown est terminé (ou délai = 0 pour instant)
- Le settlement est confirmé (`isOrderSettled = true`)

Le frontend :
1. Switch automatiquement sur le réseau Arbitrum Sepolia
2. Appelle `USDC2.transfer(HL_BRIDGE_ADDRESS, receiveAmount)` — dépôt vers le bridge officiel Hyperliquid
3. Les validateurs Hyperliquid créditent les fonds en < 1 minute
4. Affiche "Bridge Complete"

---

## Privacy — 5 couches de protection

| Couche | Mécanisme | Ce qu'elle protège |
|--------|-----------|-------------------|
| **1. Encrypted dest** | ECIES secp256k1 sur la source chain | L'adresse de destination est un blob illisible |
| **2. Unlinkable fillId** | `keccak256(sourceOrderId, teeSecret)` | Pas de lien on-chain entre les deux chaînes |
| **3. TEE anonymous wallet** | Wallet dérivé dans l'enclave dstack | Tous les fills passent par le même intermédiaire |
| **4. Montants standardisés** | Min, 6, 7, 8, 9, 10 USDC | Empêche la corrélation par montant |
| **5. Délai de livraison** | Countdown configurable (0 à 1h) | Casse la corrélation temporelle avec la source |

### Ce qu'un observateur voit

**Sur Polkadot Hub :**
```
PrivateOrderPlaced(
  sourceOrderId: 0x3d469b42...,
  user: 0x9417...,        ← visible (l'envoyeur)
  amount: 7 USDC,
  encryptedDest: 0x04d8e78a...  ← illisible
)
```

**Sur Arbitrum Sepolia :**
```
OrderFilled(
  fillId: 0xff6a48cd...,     ← ID différent, pas de lien
  filler: 0x9417...,         ← wallet TEE (même pour tous)
  recipient: 0xABCD...,      ← visible (le destinataire)
  amount: 7 USDC
)
```

**Conclusion :** L'observateur sait que *quelqu'un* a bridgé 7 USDC depuis Polkadot et que *quelqu'un* a reçu 7 USDC sur Arbitrum, mais il ne peut **pas prouver** que c'est la même personne. Les IDs sont différents, la destination est chiffrée sur la source, et le timing est configurable.

---

## Architecture technique

```
Source (Polkadot Hub)              TEE Filler (dstack CVM)            Destination (Arb Sepolia)
┌──────────────────┐               ┌──────────────────┐              ┌──────────────────┐
│ IntentGateway    │               │ Watcher          │              │ IntentSettler     │
│  createPrivateOrder()            │  Detect events   │              │  fillOrder(fillId)│
│  releaseEscrow() │  ◄───────────│ Executor         │─────────────►│  verifyTEESettlement()
│  teeEncryptionPubKey             │  ECIES decrypt   │              │                  │
│                  │               │  Fill with fillId│              │ TEEVerifier       │
│ OrderStore       │               │ Settler          │              │  verifyAttestation()
│  encryptedDest   │               │  Dual attestation│              │  TDX quote record │
│  isPrivateOrder  │               │ Relay            │              │                  │
└──────────────────┘               │  fillId→sourceId │              │ FillerRegistry    │
                                   │ TEEClient        │              └──────────────────┘
                                   │  deriveKey()     │                       │
                                   │  tdxQuote()      │              Hyperliquid Testnet
                                   │  decryptDest()   │              (via Bridge2 contract)
                                   │  computeFillId() │
                                   └──────────────────┘
```

## Contrats déployés

| Contrat | Adresse | Chaîne |
|---------|---------|--------|
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
- **Wallet** (`velora/filler/wallet`) → signer les tx + attestations
- **Encryption** (`velora/filler/encryption`) → clé publique ECIES (sur le contrat) + clé privée (déchiffrement dans l'enclave)
- **FillId secret** (`velora/filler/fillid-secret`) → `keccak256(sourceOrderId, secret)` = fillId unlinkable

## Stack technique

| Composant | Technologies |
|-----------|-------------|
| Contracts | Solidity 0.8.24, Foundry, OpenZeppelin 5.x |
| Filler | TypeScript, ethers v6, @phala/dstack-sdk, eciesjs |
| Frontend | React 19, Vite, wagmi, viem, motion/react, eciesjs |
| TEE | Phala dstack (Intel TDX), TappdClient SDK |
| Encryption | ECIES secp256k1 (eciesjs) |
