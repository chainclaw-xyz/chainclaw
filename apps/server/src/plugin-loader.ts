/**
 * Dynamic plugin loader.
 * Attempts to import known plugin packages at startup.
 * Missing packages are silently skipped (optional dependencies).
 */
import { getLogger, registerHook } from "@chainclaw/core";
import type { ServerPlugin, PluginContext, PluginHandle } from "./plugin.js";

const logger = getLogger("plugin-loader");

const KNOWN_PLUGINS = [
  "@chainclaw/cloud-plugin",
];

export async function loadPlugins(ctx: PluginContext): Promise<PluginHandle[]> {
  const handles: PluginHandle[] = [];

  for (const pkgName of KNOWN_PLUGINS) {
    try {
      const mod: Record<string, unknown> = await import(pkgName) as Record<string, unknown>;
      const plugin: ServerPlugin = (mod.default ?? mod.plugin) as ServerPlugin;

      if (!plugin?.name || !plugin?.init) {
        logger.warn({ pkg: pkgName }, "Plugin module missing name or init, skipping");
        continue;
      }

      logger.info({ plugin: plugin.name }, "Loading plugin");
      const handle = await plugin.init(ctx);
      handles.push(handle);

      // Register plugin hooks
      if (handle.hooks) {
        for (const { eventKey, handler } of handle.hooks) {
          registerHook(eventKey, handler);
          logger.debug({ plugin: plugin.name, eventKey }, "Plugin hook registered");
        }
      }

      logger.info({ plugin: plugin.name }, "Plugin loaded");
    } catch (err: unknown) {
      if (isModuleNotFoundError(err, pkgName)) {
        logger.debug({ pkg: pkgName }, "Optional plugin not installed, skipping");
      } else {
        logger.warn({ err, pkg: pkgName }, "Plugin failed to load");
      }
    }
  }

  return handles;
}

function isModuleNotFoundError(err: unknown, _pkgName: string): boolean {
  if (err && typeof err === "object" && "code" in err) {
    const code = (err as { code: string }).code;
    if (code === "ERR_MODULE_NOT_FOUND" || code === "MODULE_NOT_FOUND") {
      return true;
    }
  }
  // Node ESM sometimes throws without a code
  if (err instanceof Error && err.message.includes("Cannot find package")) {
    return true;
  }
  return false;
}
