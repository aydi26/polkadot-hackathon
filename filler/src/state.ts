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
  destChain: number;
  status: FillStatus;
  amount: bigint;
  feeOffer: bigint;
  settlementMethod?: "beefy" | "tee";
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

  track(orderId: string, amount: bigint, feeOffer: bigint, destChain: number = 0): void {
    this.records.set(orderId, {
      orderId,
      destChain,
      status: FillStatus.DETECTED,
      amount,
      feeOffer,
      detectedAt: Date.now(),
    });
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
