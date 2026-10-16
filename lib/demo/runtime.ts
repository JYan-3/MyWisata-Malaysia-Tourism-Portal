type DemoRuntimeEnvironment = Partial<Pick<
  NodeJS.ProcessEnv,
  | "MYLAWATAN_DEMO_TOOLS"
  | "MYLAWATAN_ENV"
  | "MYWISATA_DEMO_TOOLS"
  | "MYWISATA_ENV"
  | "NODE_ENV"
  | "VERCEL_ENV"
>>;

export function isDemoToolRuntimeEnabled(
  environment: DemoRuntimeEnvironment = process.env,
): boolean {
  const demoToolsEnabled = environment.MYLAWATAN_DEMO_TOOLS ?? environment.MYWISATA_DEMO_TOOLS;
  const appEnvironment = environment.MYLAWATAN_ENV ?? environment.MYWISATA_ENV;
  if (demoToolsEnabled !== "true") return false;
  if (environment.VERCEL_ENV === "production" || appEnvironment === "production") return false;

  if (environment.NODE_ENV === "production") {
    return environment.VERCEL_ENV === "preview" || appEnvironment === "staging";
  }

  return environment.NODE_ENV === "development" || environment.NODE_ENV === "test";
}
