export const settings = {
  containerName: 'cloudflare-ddns',
  refreshInterval: '300',
  theme: 'dark',
  deleteRecordsOnRemoval: 'false',
};

export const updateSchedule = {
  effective: null,
  source: 'default',
  setting: null,
  environment: null,
  readOnly: false,
  warnings: [],
};

export const dashboard = {
  containers: [
    {
      name: 'cloudflare-ddns-t1',
      tokenId: 1,
      tokenName: 'Personal',
      exists: true,
      state: 'running',
      status: 'Up 4 days',
    },
    {
      name: 'cloudflare-ddns-t2',
      tokenId: 2,
      tokenName: 'Homelab',
      exists: true,
      state: 'running',
      status: 'Up 4 days',
    },
  ],
  publicIPv4: '203.0.113.10',
  publicIPv6: null,
  domainCount: 2,
  banners: [{ level: 'ok', message: 'Everything healthy.' }],
  records: [
    {
      hostname: 'home.example.com',
      type: 'A',
      expected: '203.0.113.10',
      cloudflareValue: '203.0.113.10',
      updateNeeded: false,
    },
    {
      hostname: 'vpn.example.com',
      type: 'A',
      expected: '203.0.113.10',
      cloudflareValue: '198.51.100.42',
      updateNeeded: true,
    },
  ],
};

export const tokens = [
  {
    id: 1,
    name: 'Personal',
    masked: 'cfut_****************************a972',
    lastValid: true,
    lastChecked: '2026-05-28T09:55:00Z',
    hostCount: 1,
  },
  {
    id: 2,
    name: 'Homelab',
    masked: 'cfut_****************************4d2e',
    lastValid: true,
    lastChecked: '2026-05-28T09:55:00Z',
    hostCount: 1,
  },
];

export const hosts = [
  {
    id: 1,
    zone: 'example.com',
    hostname: 'home',
    fqdn: 'home.example.com',
    recordType: 'A',
    proxied: true,
    ttl: 1,
    description: 'Home dashboard',
    enabled: true,
    tokenId: 1,
    tokenName: 'Personal',
    tokenMasked: 'cfut_****a972',
  },
  {
    id: 2,
    zone: 'example.com',
    hostname: 'vpn',
    fqdn: 'vpn.example.com',
    recordType: 'A',
    proxied: false,
    ttl: 120,
    description: 'WireGuard endpoint',
    enabled: true,
    tokenId: 2,
    tokenName: 'Homelab',
    tokenMasked: 'cfut_****4d2e',
  },
];

function favoniaLog({ domain, proxied }) {
  return [
    '2026-05-28T09:50:18.039168576Z 🌟 Cloudflare DDNS (v1.16.2-0-g6754118)',
    '2026-05-28T09:50:18.039526379Z 📖 Reading settings . . .',
    '2026-05-28T09:50:18.039620651Z    🔸 Using default IP4_PROVIDER=cloudflare.trace',
    '2026-05-28T09:50:18.039624619Z    🔸 Using default UPDATE_CRON=@every 5m',
    '2026-05-28T09:50:18.039628286Z    🔸 Using default UPDATE_ON_START=true',
    '2026-05-28T09:50:18.040430761Z    🔸 Using default TTL=1',
    '2026-05-28T09:50:18.042102494Z 📖 Checking settings . . .',
    '2026-05-28T09:50:18.042115482Z 📖 Current settings:',
    '2026-05-28T09:50:18.042119245Z    🔧 Domains, IP providers, and WAF lists:',
    `2026-05-28T09:50:18.042122967Z       🔸 IPv4-enabled domains:        ${domain}`,
    '2026-05-28T09:50:18.042126539Z       🔸 IPv4 provider:               cloudflare.trace',
    '2026-05-28T09:50:18.042155833Z    🔧 DNS and WAF fallback values:',
    '2026-05-28T09:50:18.042159289Z       🔸 TTL:                         1 (auto)',
    `2026-05-28T09:50:18.042162823Z       🔸 Proxied domains:             ${proxied ? domain : '(none)'}`,
    `2026-05-28T09:50:18.042166366Z       🔸 Unproxied domains:           ${proxied ? '(none)' : domain}`,
    '2026-05-28T09:50:18.358201070Z ',
    '2026-05-28T09:50:18.410439313Z 🌐 Detected IPv4 address: 203.0.113.10',
    `2026-05-28T09:50:19.601208261Z 🐣 Added a new A record for ${domain} (ID: 9c61e62cceff2b4bc83878077a8984b2)`,
    '2026-05-28T09:50:19.608485987Z ⏰ Checking the IP addresses in about 4m58s . . .',
    '2026-05-28T09:55:18.025177630Z ',
    '2026-05-28T09:55:18.065916316Z 🌐 Detected IPv4 address: 203.0.113.10',
    `2026-05-28T09:55:18.065986967Z 🤷 The A records for ${domain} are already up to date (cached)`,
    '2026-05-28T09:55:18.066197008Z ⏰ Checking the IP addresses in about 5m0s . . .',
    '2026-05-28T10:00:18.060204120Z ',
    '2026-05-28T10:00:18.102470269Z 🌐 Detected IPv4 address: 203.0.113.10',
    `2026-05-28T10:00:18.102502241Z 🤷 The A records for ${domain} are already up to date (cached)`,
    '2026-05-28T10:00:18.102509725Z ⏰ Checking the IP addresses in about 5m0s . . .',
  ].join('\n');
}

const instanceLogs = {
  'cloudflare-ddns-t1': favoniaLog({ domain: 'home.example.com', proxied: true }),
  'cloudflare-ddns-t2': favoniaLog({ domain: 'vpn.example.com', proxied: false }),
};

export const logs = { logs: instanceLogs['cloudflare-ddns-t1'] };

export const logContainers = [
  { name: 'cloudflare-ddns-t1', tokenId: 1, tokenName: 'Personal', state: 'running' },
  { name: 'cloudflare-ddns-t2', tokenId: 2, tokenName: 'Homelab', state: 'running' },
];

export function resolve(pathname, searchParams) {
  if (pathname === '/api/settings') return settings;
  if (pathname === '/api/settings/update-schedule') return updateSchedule;
  if (pathname === '/api/dashboard') return dashboard;
  if (pathname === '/api/tokens') return tokens;
  if (pathname === '/api/hosts') return hosts;
  if (pathname === '/api/logs/containers') return logContainers;
  if (pathname.startsWith('/api/logs')) {
    const name = searchParams?.get('name');
    if (name && instanceLogs[name]) return { logs: instanceLogs[name] };
    return {
      logs: Object.entries(instanceLogs)
        .map(([n, l]) => `===== ${n} =====\n${l}`)
        .join('\n\n'),
    };
  }
  return undefined;
}
