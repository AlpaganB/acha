export function navigate(path: string) {
  if (window.location.pathname === path && !window.location.hash) return
  window.history.pushState(null, '', path)
  window.dispatchEvent(new PopStateEvent('popstate'))
}
