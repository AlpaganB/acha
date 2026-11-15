export function navigate(path: string) {
  if (window.location.pathname + window.location.search === path && !window.location.hash) return
  window.history.pushState(null, '', path)
  window.dispatchEvent(new PopStateEvent('popstate'))
}
