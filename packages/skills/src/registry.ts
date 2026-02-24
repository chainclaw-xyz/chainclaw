import { getLogger, enqueueInLane, setLaneConcurrency, type SkillResult } from "@chainclaw/core";
import type { SkillDefinition, SkillExecutionContext } from "./types.js";

const logger = getLogger("skill-registry");

// Lane assignments: skill name → command queue lane
const LANE_MAP: Record<string, string> = {
  swap: "tx",
  bridge: "tx",
  lend: "tx",
  dca: "tx",
  balance: "query",
  portfolio: "query",
  history: "query",
  "risk-check": "query",
  backtest: "background",
  agent: "background",
};

const DEFAULT_LANE = "default";

export class SkillRegistry {
  private skills: Map<string, SkillDefinition> = new Map();
  private lanesConfigured = false;

  register(skill: SkillDefinition): void {
    if (this.skills.has(skill.name)) {
      logger.warn({ skill: skill.name }, "Overwriting existing skill");
    }
    this.skills.set(skill.name, skill);
    logger.info({ skill: skill.name }, "Skill registered");
  }

  get(name: string): SkillDefinition | undefined {
    return this.skills.get(name);
  }

  list(): SkillDefinition[] {
    return [...this.skills.values()];
  }

  has(name: string): boolean {
    return this.skills.has(name);
  }

  /**
   * Configure command queue lane concurrency. Call once at startup.
   */
  configureLanes(): void {
    if (this.lanesConfigured) return;
    setLaneConcurrency("tx", 1);
    setLaneConcurrency("query", 5);
    setLaneConcurrency("background", 3);
    setLaneConcurrency(DEFAULT_LANE, 3);
    this.lanesConfigured = true;
    logger.info("Command queue lanes configured");
  }

  /**
   * Execute a skill through the command queue with lane-based concurrency control.
   */
  async executeSkill(
    name: string,
    params: unknown,
    context: SkillExecutionContext,
  ): Promise<SkillResult> {
    const skill = this.skills.get(name);
    if (!skill) {
      return { success: false, message: `Unknown skill: ${name}` };
    }

    const lane = LANE_MAP[name] ?? DEFAULT_LANE;
    logger.debug({ skill: name, lane }, "Enqueuing skill execution");

    return enqueueInLane(lane, () => skill.execute(params ?? {}, context));
  }
}
