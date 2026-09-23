import { createGatewayServer } from "./gateway";

const port = Number.parseInt(process.env.PORT ?? "8787", 10);
const host = process.env.HOST ?? "127.0.0.1";
const gateway = createGatewayServer();

gateway.listen(port, host).then((boundPort) => {
  console.log(`Comic Chat web gateway listening on http://${host}:${boundPort}`);
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void gateway.close().finally(() => process.exit());
  });
}
