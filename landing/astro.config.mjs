// @ts-check
import { defineConfig } from 'astro/config'

// Deployes til GitHub Pages under https://navikt.github.io/nda/
// `base` kan overstyres med BASE_PATH ved migrering til egen app på rot-domene
// (sett BASE_PATH=/ i et eventuelt nytt deploy-miljø).
// Alltid med etterfølgende skråstrek så import.meta.env.BASE_URL gir rene
// stier som `${BASE_URL}favicon.svg` (=> /nda/favicon.svg, eller /favicon.svg på rot).
const base = (process.env.BASE_PATH ?? '/nda').replace(/\/*$/, '/')

// https://astro.build/config
export default defineConfig({
  site: 'https://navikt.github.io',
  base,
  trailingSlash: 'ignore',
})
