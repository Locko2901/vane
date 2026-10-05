import path from 'node:path'

export const config = {
  port: parseInt(process.env.PORT ?? '3000', 10),
  nodeEnv: process.env.NODE_ENV ?? 'production',

  ddnsConfigDir: process.env.DDNS_CONFIG_DIR ?? '/ddns-config',

  dataDir: process.env.DATA_DIR ?? '/data',

  ddnsContainer: process.env.DDNS_CONTAINER ?? 'cloudflare-ddns',

  ddnsUpdateCron: process.env.DDNS_UPDATE_CRON ?? '',

  dockerSocket: process.env.DOCKER_SOCKET ?? '/var/run/docker.sock',
} as const

export const paths = {
  ddnsEnvFile: () => path.join(config.ddnsConfigDir, 'ddns.env'),
  secretKeyFile: () => path.join(config.dataDir, 'secret.key'),
}
