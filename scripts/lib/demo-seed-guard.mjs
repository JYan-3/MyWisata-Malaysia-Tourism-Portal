export function remoteDemoSeedBlockReason(environment) {
  const appEnvironment = environment.MYLAWATAN_ENV ?? environment.MYWISATA_ENV;
  if (environment.REMOTE_DEMO_SEED !== '1') {
    return 'Refusing to seed a remote database without REMOTE_DEMO_SEED=1.';
  }
  if (environment.VERCEL_ENV === 'production'
    || appEnvironment === 'production'
    || environment.NODE_ENV === 'production') {
    return 'Remote demo seeding is disabled in production.';
  }
  if (appEnvironment !== 'staging') {
    return 'Remote demo seeding requires MYLAWATAN_ENV=staging.';
  }
  return null;
}
