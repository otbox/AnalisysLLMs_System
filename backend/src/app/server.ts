// app/server.ts
import Fastify from 'fastify';
import { buildContainer } from '../config/di-container';
import fastifyCors from "@fastify/cors";
import 'dotenv/config'


const app = Fastify({ logger: true });

app.register(fastifyCors, {
  origin: true, // ou "http://localhost:5173" se quiser travar
});

const { stepController } = buildContainer();



app.post('/sessions/:sessionId/steps', stepController.createHandler);

const PORT = Number(process.env.PORT) || 3000;

app
  .listen({ port: PORT, host: '0.0.0.0' })
  .then((address) => {
    console.log(`🚀 Fastify rodando em ${address}`);
  })
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });