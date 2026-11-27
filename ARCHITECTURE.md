# Velora — Architecture

## 1. Vue d'ensemble des composants

```mermaid
graph TB
    subgraph FE["🖥️ Frontend — React 19 / Vite / wagmi v3"]
        BW["BridgeWidget<br/>state machine : input → approve → deposit<br/>→ privacy lock → delivery → settled"]
        ECIES["eciesjs<br/>chiffre dest + secret<br/>avec la pubkey TEE"]
        TRACK["Track tab<br/>polling 2 chaînes"]
        BW --> ECIES
    end

    subgraph SRC["⛓️ Polkadot Asset Hub — Source (chainId 420420417)"]
        DR["DepositRouter<br/>proxy de confidentialité<br/>masque l'adresse user"]
        PP["PrivacyPool<br/>mixing time-lock 0–3600s<br/>montants std 6/7/8/9/10 USDC<br/>commitmentHash = keccak256 secret"]
        IG["IntentGateway<br/>escrow<br/>createPrivateOrder / markOrderFilled<br/>releaseEscrow / teeEncryptionPubKey"]
        USDC1["USDC source"]
        OS["OrderStore"]
        DR -->|forward| PP
        PP -->|approve + createPrivateOrder| IG
        IG --- OS
        PP --- USDC1
    end

    subgraph TEE["🔒 TEE Filler — Phala dstack CVM / Intel TDX"]
        subgraph KEYS["3 clés dérivées dans l'enclave"]
            K1["Wallet key<br/>signe TX + attestations"]
            K2["Encryption key<br/>déchiffre dest + secret ECIES"]
            K3["FillId secret<br/>keccak256 → fillId non-liable"]
        end
        PW["pool-watcher<br/>détecte PrivacyDeposit<br/>déchiffre le secret<br/>appelle withdraw()"]
        WA["watcher<br/>écoute PrivateOrderPlaced"]
        PR["pricing<br/>évalue la profitabilité"]
        EX["executor<br/>déchiffre la destination<br/>génère fillId<br/>fresh wallet → HL"]
        RE["relay<br/>fillId → sourceOrderId<br/>markOrderFilled()"]
        SE["settler<br/>tdxQuote + signature<br/>releaseEscrow()"]
        ST["state<br/>DETECTED → FILLING → FILLED<br/>→ SETTLING → SETTLED → RELEASED"]
        API["api :3001<br/>GET /api/fill/:orderId"]
        WA --> PR --> EX
        EX --> ST
        RE --> ST
        SE --> ST
        ST --> API
    end

    subgraph DST["⛓️ Arbitrum Sepolia — Destination"]
        IS["IntentSettler<br/>fillOrder(fillId, recipient, …)<br/>verifyTEESettlementWithQuote"]
        TV["TEEVerifier<br/>verifyAttestation<br/>enregistre le hash du TDX quote"]
        FR["FillerRegistry<br/>register / stake / slash<br/>réputation"]
        FS["FillStore"]
        USDC2["USDC2 dest"]
        FW["🔑 Fresh wallet<br/>single-use, jeté après"]
        IS --- FS
        IS --> TV
        IS --> FR
    end

    subgraph HL["⛓️ Hyperliquid Testnet"]
        B2["Bridge2 0x08cfc1B6…<br/>USDC2.transfer → crédit < 1 min"]
        L1["L1 API — usdSend<br/>transfert interne, sans gas"]
        DEST["👤 Adresse de destination"]
        B2 --> L1 --> DEST
    end

    BW -->|"deposit(amount, commitmentHash,<br/>encryptedDest, encryptedSecret, delay)"| DR
    BW -.->|"lit teeEncryptionPubKey()"| IG
    TRACK -.->|polling| API
    TRACK -.->|polling| IG

    PP -.->|"event PrivacyDeposit<br/>⚠️ sans adresse user"| PW
    IG -.->|"event PrivateOrderPlaced"| WA
    PW -->|"withdraw(secret, feeOffer, deadline)"| PP

    EX -->|"fillOrder(fillId, …)"| IS
    EX -->|"USDC2 + ETH gas"| FW
    FW -->|"transfer + usdSend"| B2
    IS -.->|"event OrderFilled(fillId)"| RE
    RE -->|markOrderFilled| IG
    SE -->|"verifyTEESettlementWithQuote"| IS
    SE -->|"releaseEscrow(orderId, filler, attestation)"| IG
    IG -->|USDC libéré au filler| K1

    K2 -.-> PW
    K2 -.-> EX
    K3 -.-> EX
    K1 -.-> SE

    classDef front fill:#1e293b,stroke:#60a5fa,color:#e2e8f0
    classDef src fill:#2a1033,stroke:#e6007a,color:#f8e8f2
    classDef tee fill:#0f2a1f,stroke:#34d399,color:#d1fae5
    classDef dst fill:#0c1f33,stroke:#38bdf8,color:#dbeafe
    classDef hl fill:#0d2824,stroke:#14b8a6,color:#ccfbf1
    class BW,ECIES,TRACK front
    class DR,PP,IG,USDC1,OS src
    class PW,WA,PR,EX,RE,SE,ST,API,K1,K2,K3 tee
    class IS,TV,FR,FS,USDC2,FW dst
    class B2,L1,DEST hl
```

---

## 2. Flux complet (séquence, 7 étapes)

```mermaid
sequenceDiagram
    autonumber
    actor U as 👤 User
    participant F as Frontend
    participant DR as DepositRouter
    participant PP as PrivacyPool
    participant IG as IntentGateway
    box rgba(16,185,129,0.12) TEE — Phala dstack (Intel TDX)
    participant PW as pool-watcher
    participant EX as executor
    participant RE as relay
    participant SE as settler
    end
    participant IS as IntentSettler
    participant FW as 🔑 Fresh wallet
    participant HL as Hyperliquid

    rect rgba(96,165,250,0.10)
    Note over U,F: Étape 1-2 — Préparation + dépôt
    U->>F: montant std (6-10 USDC), dest optionnelle, privacy lock
    F->>IG: teeEncryptionPubKey()
    F->>F: secret aléatoire 32B<br/>commitmentHash = keccak256(secret)<br/>ECIES(dest), ECIES(secret)
    F->>DR: deposit(amount, commitmentHash, encDest, encSecret, delay)
    DR->>PP: forward (Transfer from: DepositRouter)
    PP-->>PW: PrivacyDeposit(commitmentHash, amount, delay, encSecret)
    Note right of PP: ⚠️ aucune adresse user on-chain
    end

    rect rgba(230,0,122,0.10)
    Note over PP,PW: Étape 3-4 — Privacy lock puis withdraw auto
    PP->>PP: time-lock : block.timestamp >= releaseTime
    PW->>PP: isReady(commitmentHash) ?
    PW->>PW: déchiffre le secret dans l'enclave (ECIES)
    PW->>PP: withdraw(secret, feeOffer, deadline)
    PP->>IG: createPrivateOrder(…)  msg.sender = PrivacyPool
    IG-->>EX: PrivateOrderPlaced(orderId, encryptedDest)
    end

    rect rgba(16,185,129,0.10)
    Note over EX,HL: Étape 5 — Fill via wallet éphémère
    EX->>EX: déchiffre dest (ECIES)<br/>fillId = keccak256(sourceOrderId, teeSecret)
    EX->>FW: crée wallet aléatoire + envoie USDC2 + ETH gas
    EX->>IS: fillOrder(fillId, recipient, token, amount)
    IS-->>RE: OrderFilled(fillId)   fillId ≠ sourceOrderId
    FW->>HL: USDC2.transfer(Bridge2, amount)
    HL-->>FW: crédit (~30-60s)
    FW->>HL: usdSend → destination déchiffrée
    EX->>EX: vérifie l'arrivée, puis jette le wallet
    end

    rect rgba(56,189,248,0.10)
    Note over RE,IG: Étape 6 — Settlement TEE (~5-10s)
    RE->>IG: markOrderFilled(sourceOrderId)
    SE->>SE: dstack tdxQuote() + signature avec la clé wallet TEE
    SE->>IS: verifyTEESettlementWithQuote(orderId, attestation, sig, quote)
    SE->>IG: releaseEscrow(orderId, filler, attestation)
    IG->>SE: USDC escrow libéré au filler
    end

    rect rgba(96,165,250,0.10)
    Note over U,F: Étape 7 — Écran de complétion
    F->>EX: GET /api/fill/:orderId
    F->>U: TX hashes, fillId, fresh wallet, badge « Verified by TEE (dstack) »
    end
```

---

## 3. Modèle de confidentialité — 6 couches

```mermaid
graph LR
    subgraph L["Ce qu'un observateur ne peut pas relier"]
        A1["1. PrivacyPool mixing<br/>l'ordre est créé par le contrat<br/>+ DepositRouter masque le Transfer"]
        A2["2. Destination chiffrée<br/>ECIES secp256k1<br/>blob opaque on-chain"]
        A3["3. Secret chiffré<br/>seul le TEE peut déclencher withdraw<br/>adresse user absente de la TX"]
        A4["4. fillId non-liable<br/>keccak256(sourceOrderId, teeSecret)<br/>IDs différents sur les 2 chaînes"]
        A5["5. Fresh wallet single-use<br/>un wallet par fill, jeté après"]
        A6["6. Montants standardisés<br/>6/7/8/9/10 USDC indistinguables"]
    end
    U["👤 Dépôt user"] --> A1 --> A2 --> A3 --> A4 --> A5 --> A6 --> D["🎯 Destination<br/>non corrélable"]

    classDef layer fill:#2a1033,stroke:#e6007a,color:#f8e8f2
    class A1,A2,A3,A4,A5,A6 layer
```

---

## 4. Cycle de vie d'un ordre (`filler/src/state.ts`)

```mermaid
stateDiagram-v2
    [*] --> DETECTED : PrivateOrderPlaced
    DETECTED --> FILLING : pricing.shouldFill
    DETECTED --> FAILED : non profitable
    FILLING --> FILLED : fillOrder OK (+ freshWalletAddress)
    FILLING --> FAILED : échec après retries
    FILLED --> SETTLING : OrderFilled détecté → markOrderFilled
    SETTLING --> SETTLED : attestation TDX vérifiée
    SETTLED --> RELEASED : releaseEscrow sur IntentGateway
    RELEASED --> [*]
    FAILED --> [*]
```

---

## 5. Modes TEE

```mermaid
graph TB
    APP["TEEClient — filler/src/tee.ts"]
    APP --> M1["dstack<br/>socket /var/run/dstack.sock<br/>clés dérivées par le KMS (app-id)<br/>→ production Phala Cloud"]
    APP --> M2["simulator<br/>HTTP localhost:8090<br/>clés dérivées par le simulateur<br/>→ dev local Docker"]
    APP --> M3["mock<br/>keccak256(TEE_PRIVATE_KEY)<br/>→ hackathon / tests"]

    classDef tee fill:#0f2a1f,stroke:#34d399,color:#d1fae5
    class APP,M1,M2,M3 tee
```
