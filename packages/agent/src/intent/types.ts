export type IntentAction =
  | "balance"
  | "swap"
  | "bridge"
  | "lend"
  | "borrow"
  | "alert"
  | "risk_check"
  | "dca"
  | "portfolio"
  | "backtest"
  | "agent"
  | "marketplace"
  | "help"
  | "settings"
  | "unknown";

export interface Intent {
  action: IntentAction;
  params: Record<string, unknown>;
  confidence: number;
  rawText: string;
}

export interface ParsedIntents {
  intents: Intent[];
  clarificationNeeded: boolean;
  clarificationQuestion?: string;
  conversationalReply?: string;
}
