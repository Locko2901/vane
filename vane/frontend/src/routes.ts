export const routeImports: Record<string, () => Promise<unknown>> = {
  '/': () => import('./pages/Dashboard'),
  '/hosts': () => import('./pages/Hosts'),
  '/srv': () => import('./pages/Srv'),
  '/tokens': () => import('./pages/Tokens'),
  '/logs': () => import('./pages/Logs'),
  '/settings': () => import('./pages/Settings'),
  '/backup': () => import('./pages/Backup'),
}

export function prefetchRoute(path: string): void {
  void routeImports[path]?.()
}
