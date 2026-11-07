const canonical = 'https://freebietrail.com';
const aliases = new Set(['www.freebietrail.com', 'reward-radar.rewardradar42.workers.dev']);

export default {
  fetch(request, env) {
    const url = new URL(request.url);
    if (env.SITE_ORIGIN === canonical && (aliases.has(url.hostname) ||
        url.hostname === 'freebietrail.com' && url.protocol === 'http:')) {
      const destination = new URL(canonical);
      destination.pathname = url.pathname;
      destination.search = url.search;
      return Response.redirect(destination, 301);
    }
    if (/^\/(ja|en)$/.test(url.pathname)) {
      url.pathname += '/';
      return Response.redirect(url.href,308);
    }
    const result = env.ASSETS.fetch(request);
    if (!url.search) return result;
    const noindex = response => {
      const output = new Response(response.body,response);
      output.headers.set('X-Robots-Tag','noindex, follow');
      return output;
    };
    return result instanceof Promise ? result.then(noindex) : noindex(result);
  },
};
