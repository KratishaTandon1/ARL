import Fastify from 'fastify';
import { setupRoutes } from './routes';

export const buildServer = () => {
  const server = Fastify({ logger: true });

  server.register(setupRoutes);

  return server;
};

const start = async () => {
  // Only start listening if this file is run directly (not imported for testing)
  if (require.main === module) {
    const server = buildServer();
    try {
      await server.listen({ port: 3000, host: '0.0.0.0' });
      console.log('Server is running on port 3000');
    } catch (err) {
      server.log.error(err);
      process.exit(1);
    }
  }
};

start();
