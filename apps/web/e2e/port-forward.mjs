/**
 * Forwards localhost:<port> inside the Playwright container to the same port on the HOST.
 *
 * WHY. The web bundle has the API's URL inlined at build time — locally that is
 * `http://localhost:9080`. A browser running in the container that loads the app from
 * `host.docker.internal:3100` still calls `localhost:9080` for every API request, and inside the
 * container localhost is the container. Every request failed, and the sign-in screen said the API
 * was unreachable while it was running fine on the host.
 *
 * Forwarding the ports instead means the browser in the container sees EXACTLY the origins a
 * browser on the host sees — same URLs, same CORS origin, same bundle — so the run tests what a
 * developer actually uses.
 *
 * Usage (run-docker.sh starts it in the background): node e2e/port-forward.mjs 3100 9080
 */
import net from 'node:net';

const HOST = process.env.E2E_FORWARD_HOST ?? 'host.docker.internal';
const ports = process.argv
  .slice(2)
  .map(Number)
  .filter((p) => Number.isInteger(p) && p > 0);

if (ports.length === 0) {
  console.error('usage: node port-forward.mjs <port> [port...]');
  process.exit(2);
}

for (const port of ports) {
  net
    .createServer((client) => {
      const upstream = net.connect(port, HOST);
      client.pipe(upstream).pipe(client);
      const close = () => {
        client.destroy();
        upstream.destroy();
      };
      client.on('error', close);
      upstream.on('error', close);
    })
    .on('error', (err) => {
      console.error(`port-forward: cannot listen on ${port}: ${err.message}`);
      process.exit(1);
    })
    .listen(port, '127.0.0.1', () => {
      console.error(`port-forward: localhost:${port} -> ${HOST}:${port}`);
    });
}
