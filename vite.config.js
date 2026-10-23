// Slidev merges a vite.config from every root: the theme, each addon, the deck
// (@slidev/cli resolveViteConfigs). A venue build (`slidev-videos venue` sets
// VIDEOS_VENUE_FILE=1) gets a deck that opens from file:// (venue/file.js);
// every other build is untouched. (Plain code: 'vite' does not resolve from a
// deck's install of the addon.)
import { venueFile } from './venue/file.js';

export default { plugins: process.env.VIDEOS_VENUE_FILE === '1' ? [venueFile()] : [] };
