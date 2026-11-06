const canonical = 'https://freebietrail.com';
const aliases = new Set(['www.freebietrail.com', 'reward-radar.rewardradar42.workers.dev']);

export default {
  fetch(request, env) {
    const url = new URL(request.url);
    if (env.SITE_ORIGIN === canonical && aliases.has(url.hostname)) {
      const destination = new URL(canonical);
      destination.pathname = url.pathname;
      destination.search = url.search;
      return Response.redirect(destination, 301);
    }
    return env.ASSETS.fetch(request);
  },
};
