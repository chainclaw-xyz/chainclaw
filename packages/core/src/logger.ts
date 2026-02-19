import pino from "pino";

export type Logger = pino.Logger;

let rootLogger: Logger | null = null;

export function createLogger(level: string = "info"): Logger {
  if (rootLogger) return rootLogger;

  rootLogger = pino({
    level,
    transport:
      process.env.NODE_ENV !== "production"
        ? { target: "pino/file", options: { destination: 1 } }
        : undefined,
    formatters: {
      level(label) {
        return { level: label };
      },
    },
    timestamp: pino.stdTimeFunctions.isoTime,
  });

  return rootLogger;
}

export function getLogger(name: string): Logger {
  const parent = rootLogger ?? createLogger();
  return parent.child({ component: name });
}
