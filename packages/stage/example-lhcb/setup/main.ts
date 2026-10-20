// The lhcb plugin's example: its detector needs tracks for its hits (step 2). A
// talk passes its event's own (lhc-opening's trajectories); here, a fan of
// straight ones from the collision, in LHCb metres.
import { setLhcbTracks } from '../../stage/plugins/lhcb.js'

const tracks = []
for (let i = 0; i < 24; i++) {
  const a = (i / 24) * Math.PI * 2, t = 0.04 + 0.12 * ((i * 7) % 5) / 5
  const pts = []
  for (let z = 0; z <= 19.5; z += 0.05) pts.push([Math.cos(a) * t * z, Math.sin(a) * t * z, z])
  tracks.push(pts)
}
export default () => { setLhcbTracks(tracks) }
