// `slidev export --range 3-5` on a deck with `routerMode: hash`: the export
// loads `…/?print=true&range=3-5#print`, but Slidev reads the range once, from
// the route's own query (after the #), which is empty, so every slide was
// printed (and the stage's thirty print pages outran the browser). Once the
// router is ready, set the print range from the address.
import { useNav } from '@slidev/client'
import { rangeList } from '../stage/stills.js'

export default function setup({ app, router }: { app: any, router: any }) {
  if (typeof location === 'undefined') return
  const range = new URLSearchParams(location.search).get('range')
  if (!range) return
  router.isReady().then(() => app.runWithContext(() => {
    const nav = useNav()
    if (!nav?.printRange || router.currentRoute.value.query?.range) return
    const pages = rangeList(range, nav.slides.value.length)
    if (pages.length) nav.printRange.value = pages
  }))
}
