export const shouldSynchronizeDatabase = (
  nodeEnv: string | undefined,
  appRole: string | undefined,
) => nodeEnv !== 'production' || appRole === 'worker';
