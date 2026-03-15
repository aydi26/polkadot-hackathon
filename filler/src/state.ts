/// @title FillerState - Tracks order lifecycle for monitoring
export enum FillStatus {
  DETECTED = "detected",
  FILLING = "filling",
  FILLED = "filled",
  SETTLING = "settling",
  SETTLED = "settled",
  RELEASED = "released",
  FAILED = "failed",
}

export interface FillRecord {
  orderId: string;
  fillId: string; // fillId on destination (== orderId for public orders)
  destChain: number;
  status: FillStatus;
  amount: bigint;
  feeOffer: bigint;
  isPrivate: boolean;
  settlementMethod?: "beefy" | "tee";
  freshWalletAddress?: string;
  fillTxHash?: string;
  settleTxHash?: string;
  releaseTxHash?: string;
  error?: string;
  detectedAt: number;
  filledAt?: number;
  settledAt?: number;
  releasedAt?: number;
}

export class FillerState {
  private records: Map<string, FillRecord> = new Map();

  track(orderId: string, amount: bigint, feeOffer: bigint, destChain: number = 0, isPrivate: boolean = false): void {
    this.records.set(orderId, {
      orderId,
      fillId: orderId, // default: same as orderId, updated after fill for private orders
      destChain,
      status: FillStatus.DETECTED,
      amount,
      feeOffer,
      isPrivate,
      detectedAt: Date.now(),
    });
  }

  updateFillId(orderId: string, fillId: string): void {
    const record = this.records.get(orderId);
    if (record) record.fillId = fillId;
  }

  findByFillId(fillId: string): FillRecord | undefined {
    return Array.from(this.records.values()).find((r) => r.fillId === fillId);
  }

  getAllRecords(): FillRecord[] {
    return Array.from(this.records.values());
  }

  updateStatus(orderId: string, status: FillStatus, extra?: Partial<FillRecord>): void {
    const record = this.records.get(orderId);
    if (!record) return;
    record.status = status;
    if (extra) Object.assign(record, extra);
  }

  markFilled(orderId: string, txHash: string): void {
    this.updateStatus(orderId, FillStatus.FILLED, { fillTxHash: txHash, filledAt: Date.now() });
  }

  markSettled(orderId: string, txHash: string): void {
    this.updateStatus(orderId, FillStatus.SETTLED, { settleTxHash: txHash, settledAt: Date.now() });
  }

  markReleased(orderId: string, txHash: string): void {
    this.updateStatus(orderId, FillStatus.RELEASED, { releaseTxHash: txHash, releasedAt: Date.now() });
  }

  markFailed(orderId: string, error: string): void {
    this.updateStatus(orderId, FillStatus.FAILED, { error });
  }

  get(orderId: string): FillRecord | undefined {
    return this.records.get(orderId);
  }

  getByStatus(status: FillStatus): FillRecord[] {
    return Array.from(this.records.values()).filter((r) => r.status === status);
  }

  getStats(): { total: number; filled: number; settled: number; released: number; failed: number } {
    const all = Array.from(this.records.values());
    return {
      total: all.length,
      filled: all.filter((r) => r.status === FillStatus.FILLED).length,
      settled: all.filter((r) => r.status === FillStatus.SETTLED).length,
      released: all.filter((r) => r.status === FillStatus.RELEASED).length,
      failed: all.filter((r) => r.status === FillStatus.FAILED).length,
    };
  }
}
