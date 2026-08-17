/**
 * Seed the local database with bogus tokens and hosts for UI/manual testing.
 *
 * Usage (from the vane/ folder, same env as `npm run dev`):
 *   DATA_DIR="$PWD/.data" DATABASE_URL="file:$PWD/.data/vane.db" \
 *     npm --prefix backend run seed:bogus
 *
 * Add --clear to remove previously seeded bogus data first:
 *   ... npm --prefix backend run seed:bogus -- --clear
 */
import { prisma } from '../db'
import { encrypt } from '../crypto'

const SEED_TAG = '[bogus]'

// Four zones, each paired with its own API token (token name === zone).
const ZONES = [
  { zone: 'example.com', tokenName: 'example.com' },
  { zone: 'example.net', tokenName: 'example.net' },
  { zone: 'example.org', tokenName: 'example.org' },
  { zone: 'homelab.example', tokenName: 'homelab.example' },
]

// A generous pool of realistic self-hosted service names.
const SERVICES = [
  'audiobookshelf', 'jellyfin', 'immich', 'kuma', 'n8n', 'ntfy', 'seerr',
  'shelfarr', 'status', 'clips', 'livesync', 'plex', 'sonarr', 'radarr',
  'bazarr', 'prowlarr', 'qbit', 'vaultwarden', 'grafana', 'prometheus',
  'nextcloud', 'gitea', 'paperless', 'homeassistant', 'pihole', 'adguard',
  'portainer', 'traefik', 'minio', 'photoprism',
]

const RECORD_TYPES = ['A', 'AAAA', 'BOTH'] as const

function fakeCfToken(seed: string): string {
  // Mimic a Cloudflare API token shape without being a real credential.
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-'
  let out = 'cfut_'
  let acc = 0
  for (const c of seed) acc = (acc * 31 + c.charCodeAt(0)) >>> 0
  for (let i = 0; i < 35; i++) {
    acc = (acc * 1103515245 + 12345) >>> 0
    out += chars[acc % chars.length]
  }
  return out
}

async function clearBogus() {
  const tokens = await prisma.apiToken.findMany({
    where: { name: { in: ZONES.map((z) => z.tokenName) } },
    select: { id: true },
  })
  const tokenIds = tokens.map((t) => t.id)
  const hosts = await prisma.host.deleteMany({ where: { description: { contains: SEED_TAG } } })
  const toks = await prisma.apiToken.deleteMany({ where: { id: { in: tokenIds } } })
  console.log(`Cleared ${hosts.count} bogus host(s) and ${toks.count} bogus token(s).`)
}

async function seed() {
  let tokenCount = 0
  let hostCount = 0

  for (let z = 0; z < ZONES.length; z++) {
    const { zone, tokenName } = ZONES[z]
    const token = await prisma.apiToken.upsert({
      where: { name: tokenName },
      update: {},
      create: {
        name: tokenName,
        ciphertext: encrypt(fakeCfToken(tokenName)),
        lastValid: z % 3 === 0 ? null : true,
        lastChecked: z % 3 === 0 ? null : new Date(),
      },
    })
    tokenCount++

    // 12 hosts per zone => ~48 hosts total, plus the zone apex.
    const services = SERVICES.slice(z * 3, z * 3 + 12)
    const entries = ['@', ...services]

    for (let i = 0; i < entries.length; i++) {
      const hostname = entries[i]
      const recordType = RECORD_TYPES[(z + i) % RECORD_TYPES.length]
      try {
        await prisma.host.create({
          data: {
            zone,
            hostname,
            recordType,
            proxied: i % 4 !== 0,
            ttl: i % 5 === 0 ? 300 : 1,
            description: i % 3 === 0 ? `${SEED_TAG} sample ${hostname} service` : SEED_TAG,
            enabled: i % 6 !== 0,
            tokenId: token.id,
          },
        })
        hostCount++
      } catch {
        // Unique [zone, hostname, recordType] already exists — skip.
      }
    }
  }

  console.log(`Seeded ${tokenCount} token(s) and ${hostCount} host(s) across ${ZONES.length} zones.`)
}

async function main() {
  const clear = process.argv.includes('--clear')
  if (clear) await clearBogus()
  await seed()
  await prisma.$disconnect()
}

main().catch(async (err) => {
  console.error(err)
  await prisma.$disconnect()
  process.exit(1)
})
