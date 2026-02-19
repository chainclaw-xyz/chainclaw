import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { AlertEngine } from "../alert.js";

vi.mock("@chainclaw/core", () => ({
  getLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

const mockGetTokenPrice = vi.fn();
vi.mock("../prices.js", () => ({
  getTokenPrice: (...args: any[]) => mockGetTokenPrice(...args),
}));

describe("AlertEngine", () => {
  let db: Database.Database;
  let engine: AlertEngine;

  beforeEach(() => {
    db = new Database(":memory:");
    engine = new AlertEngine(db);
    mockGetTokenPrice.mockReset();
  });

  afterEach(() => {
    engine.stop();
    db.close();
  });

  it("creates alerts table on construction", () => {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='alerts'").all();
    expect(tables).toHaveLength(1);
  });

  it("createAlert inserts alert and returns ID", () => {
    const id = engine.createAlert("user-1", "price_below", "ETH", 2000);
    expect(id).toBeGreaterThan(0);
  });

  it("getUserAlerts returns alerts for a user", () => {
    engine.createAlert("user-1", "price_below", "ETH", 2000);
    engine.createAlert("user-1", "price_above", "BTC", 100000);
    engine.createAlert("user-2", "price_below", "ETH", 1500);
    const alerts = engine.getUserAlerts("user-1");
    expect(alerts).toHaveLength(2);
  });

  it("deleteAlert removes alert by ID", () => {
    const id = engine.createAlert("user-1", "price_below", "ETH", 2000);
    const deleted = engine.deleteAlert(id, "user-1");
    expect(deleted).toBe(true);
    const alerts = engine.getUserAlerts("user-1");
    expect(alerts).toHaveLength(0);
  });

  it("deleteAlert returns false for wrong user", () => {
    const id = engine.createAlert("user-1", "price_below", "ETH", 2000);
    const deleted = engine.deleteAlert(id, "user-2");
    expect(deleted).toBe(false);
  });

  it("checkAlerts triggers price_above alert", async () => {
    mockGetTokenPrice.mockResolvedValue(3500);
    const notifier = vi.fn(async () => {});
    engine.setNotifier(notifier);
    engine.createAlert("user-1", "price_above", "ETH", 3000);

    await (engine as any).checkAlerts();

    expect(notifier).toHaveBeenCalledWith("user-1", expect.stringContaining("Alert Triggered"));
    expect(notifier).toHaveBeenCalledWith("user-1", expect.stringContaining("above"));
  });

  it("checkAlerts triggers price_below alert", async () => {
    mockGetTokenPrice.mockResolvedValue(1800);
    const notifier = vi.fn(async () => {});
    engine.setNotifier(notifier);
    engine.createAlert("user-1", "price_below", "ETH", 2000);

    await (engine as any).checkAlerts();

    expect(notifier).toHaveBeenCalledWith("user-1", expect.stringContaining("below"));
  });

  it("changes triggered alert status to 'triggered'", async () => {
    mockGetTokenPrice.mockResolvedValue(3500);
    engine.setNotifier(vi.fn(async () => {}));
    engine.createAlert("user-1", "price_above", "ETH", 3000);

    await (engine as any).checkAlerts();

    // getUserAlerts only returns active alerts
    const alerts = engine.getUserAlerts("user-1");
    expect(alerts).toHaveLength(0);

    // Verify it exists as triggered in the raw DB
    const all = db.prepare("SELECT * FROM alerts WHERE user_id = ?").all("user-1") as any[];
    expect(all[0].status).toBe("triggered");
  });

  it("does not trigger when price does not meet threshold", async () => {
    mockGetTokenPrice.mockResolvedValue(2500);
    const notifier = vi.fn(async () => {});
    engine.setNotifier(notifier);
    engine.createAlert("user-1", "price_above", "ETH", 3000);

    await (engine as any).checkAlerts();

    expect(notifier).not.toHaveBeenCalled();
    const alerts = engine.getUserAlerts("user-1");
    expect(alerts).toHaveLength(1); // still active
  });
});
