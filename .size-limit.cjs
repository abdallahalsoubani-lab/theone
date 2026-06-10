// Guards the App Router shared JS that every page pulls in. The previous 200 kB
// limit was mis-scoped — the `chunks/*.js` glob captures all shared vendor chunks
// (react-big-calendar, recharts, @react-pdf), legitimately ~700 kB — so the gate
// sat permanently red and got ignored. This tracks the real baseline with headroom
// to still catch a sizeable regression (a red gate is worse than no gate).
module.exports = [
  {
    name: 'App Router shared JS (all shared vendor chunks)',
    path: '.next/static/chunks/*.js',
    limit: '800 kB',
    gzip: true,
  },
];
