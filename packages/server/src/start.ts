import { createGnanaServer } from "./index.js";

const server = createGnanaServer({
  port: Number(process.env.PORT ?? 4000),
  database: process.env.DATABASE_URL!,
});

server.start();
