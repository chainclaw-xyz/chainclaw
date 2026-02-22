import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { getLogger } from "@chainclaw/core";
import type { SkillRegistry } from "@chainclaw/skills";
import type { SkillDefinition } from "@chainclaw/skills";
import { skillManifestSchema, type SkillManifest, type PackagedSkill } from "./types.js";
import { SandboxedExecutor, type SandboxOptions } from "./sandbox.js";

const logger = getLogger("skill-loader");

export interface SkillLoaderOptions {
  sandbox?: SandboxOptions;
}

export interface LoadResult {
  loaded: string[];
  errors: Array<{ dir: string; error: string }>;
}

/**
 * Discovers and loads community skill packages from a filesystem directory.
 * Each subdirectory should contain a `chainclaw-skill.json` manifest and a `package.json`.
 * Loaded skills are automatically wrapped in a SandboxedExecutor.
 */
export class SkillLoader {
  private sandboxExecutor: SandboxedExecutor;

  constructor(options: SkillLoaderOptions = {}) {
    this.sandboxExecutor = new SandboxedExecutor(options.sandbox);
  }

  /**
   * Scan a directory for skill packages and register them.
   *
   * Each subdirectory must contain:
   *   - chainclaw-skill.json  (SkillManifest)
   *   - package.json with "main" pointing to the entry module
   *
   * The entry module must default-export a PackagedSkill or SkillDefinition.
   */
  async loadFromDirectory(skillsDir: string, registry: SkillRegistry): Promise<LoadResult> {
    const absDir = resolve(skillsDir);
    const loaded: string[] = [];
    const errors: Array<{ dir: string; error: string }> = [];

    if (!existsSync(absDir)) {
      logger.warn({ dir: absDir }, "Skills directory does not exist, skipping");
      return { loaded, errors };
    }

    const entries = readdirSync(absDir, { withFileTypes: true });
    const dirs = entries.filter((e) => e.isDirectory());

    for (const entry of dirs) {
      const skillDir = join(absDir, entry.name);
      try {
        const skill = await this.loadSingleSkill(skillDir);
        if (skill) {
          const sandboxed = this.sandboxExecutor.wrap(skill);
          registry.register(sandboxed);
          loaded.push(skill.name);
          logger.info({ skill: skill.name, dir: entry.name }, "Community skill loaded");
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        errors.push({ dir: entry.name, error: message });
        logger.error({ err, dir: entry.name }, "Failed to load community skill");
      }
    }

    return { loaded, errors };
  }

  private async loadSingleSkill(skillDir: string): Promise<SkillDefinition | null> {
    // 1. Read and validate manifest
    const manifestPath = join(skillDir, "chainclaw-skill.json");
    if (!existsSync(manifestPath)) {
      throw new Error(`No chainclaw-skill.json found in ${skillDir}`);
    }
    const rawManifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as unknown;
    const _manifest: SkillManifest = skillManifestSchema.parse(rawManifest);

    // 2. Resolve entry point from package.json
    const pkgPath = join(skillDir, "package.json");
    if (!existsSync(pkgPath)) {
      throw new Error(`No package.json found in ${skillDir}`);
    }
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as { main?: string };
    const entryFile = join(skillDir, pkg.main || "dist/index.js");
    const entryUrl = pathToFileURL(entryFile).href;

    // 3. Dynamic import
    const mod = (await import(entryUrl)) as Record<string, unknown>;
    const exported = (mod.default ?? mod) as Record<string, unknown>;

    // 4. Handle PackagedSkill or bare SkillDefinition
    if ("manifest" in exported && "factory" in exported) {
      const packaged = exported as unknown as PackagedSkill;
      return packaged.factory();
    } else if ("name" in exported && "execute" in exported) {
      return exported as unknown as SkillDefinition;
    }

    throw new Error(`Skill in ${skillDir} does not export a PackagedSkill or SkillDefinition`);
  }
}
