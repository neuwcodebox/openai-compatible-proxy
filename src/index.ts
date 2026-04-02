import { buildServer } from './server.js';

const port = Number.parseInt(process.env.PORT ?? '3000', 10);
const host = process.env.HOST ?? '0.0.0.0';

const server = buildServer();

try {
  await server.listen({ port, host });
  server.log.info({ host, port }, 'proxy server listening');
} catch (error) {
  server.log.error(error, 'failed to start proxy server');
  process.exitCode = 1;
}
